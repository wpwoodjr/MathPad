#!/usr/bin/env node
/**
 * MathPad Test Harness
 *
 * Runs tests by comparing solved output against expected output.
 *
 * Usage: node tests/run-tests.js
 *
 * Test files:
 *   tests/input/*.txt    - MathPad export files (before solving)
 *   tests/expected/*.txt - Expected output (after solving)
 *
 * Creating tests:
 *   1. Create a formula in MathPad
 *   2. Export to tests/input/mytest.txt (before solving)
 *   3. Solve in MathPad
 *   4. Export to tests/expected/mytest.txt (after solving)
 */

const fs = require('fs');
const path = require('path');
const { formatVarStatus, injectVarStatusLines } = require('./var-status-utils.js');

// Path to docs/js modules
const jsPath = path.join(__dirname, '..', 'docs', 'js');

// Load modules in dependency order, making exports global
function loadModules() {
    // Parser (no dependencies)
    const parser = require(path.join(jsPath, 'parser.js'));
    global.VarType = parser.VarType;
    global.ClearBehavior = parser.ClearBehavior;
    global.TokenType = parser.TokenType;
    global.NodeType = parser.NodeType;
    global.Tokenizer = parser.Tokenizer;
    global.Parser = parser.Parser;
    global.ParseError = parser.ParseError;
    global.tokenize = parser.tokenize;
    global.parseExpression = parser.parseExpression;
    global.parseTokens = parser.parseTokens;
    global.findLineCommentStart = parser.findLineCommentStart;

    // Line Parser (depends on parser)
    const lineParser = require(path.join(jsPath, 'line-parser.js'));
    global.LineParser = lineParser.LineParser;
    global.getMarkerString = lineParser.getMarkerString;
    global.tokensToText = lineParser.tokensToText;

    // Evaluator (depends on parser for AST types)
    const evaluator = require(path.join(jsPath, 'evaluator.js'));
    global.EvalContext = evaluator.EvalContext;
    global.EvalError = evaluator.EvalError;
    global.evaluate = evaluator.evaluate;
    global.formatNumber = evaluator.formatNumber;
    global.addCommaGrouping = evaluator.addCommaGrouping;
    global.formatMoney = evaluator.formatMoney;
    global.currencyPlaces = evaluator.currencyPlaces;
    global.suffixCurrencies = evaluator.suffixCurrencies;
    global.formatPercent = evaluator.formatPercent;
    global.formatDegrees = evaluator.formatDegrees;
    global.parseDateText = evaluator.parseDateText;
    global.formatDateValue = evaluator.formatDateValue;
    global.parseDurationText = evaluator.parseDurationText;
    global.formatDuration = evaluator.formatDuration;
    global.toFixed = evaluator.toFixed;
    global.builtinFunctions = evaluator.builtinFunctions;
    global.checkBalance = evaluator.checkBalance;
    global.modNormalize = evaluator.modNormalize;
    global.modCheckBalance = evaluator.modCheckBalance;

    // Solver (depends on parser, evaluator)
    const solver = require(path.join(jsPath, 'solver.js'));
    global.SolverError = solver.SolverError;
    global.brent = solver.brent;
    global.solveEquation = solver.solveEquation;
    global.findVariablesInAST = solver.findVariablesInAST;
    global.isDefinitionEquation = solver.isDefinitionEquation;
    global.buildSubstitutionMap = solver.buildSubstitutionMap;
    global.substituteInAST = solver.substituteInAST;

    // Variables (depends on parser, evaluator)
    const variables = require(path.join(jsPath, 'variables.js'));
    global.computeLineOffsets = variables.computeLineOffsets;
    global.tokenOffset = variables.tokenOffset;
    // VarType and ClearBehavior are already set from parser.js above
    global.parseVariableLine = variables.parseVariableLine;
    global.parseAllVariables = variables.parseAllVariables;
    global.capturePreSolveValues = variables.capturePreSolveValues;
    global.clearVariables = variables.clearVariables;
    global.createEvalContext = variables.createEvalContext;
    global.parseConstantsRecord = variables.parseConstantsRecord;
    global.parseFunctionsRecord = variables.parseFunctionsRecord;
    global.discoverVariables = variables.discoverVariables;
    global.getInlineEvalFormat = variables.getInlineEvalFormat;
    global.formatVariableValue = variables.formatVariableValue;
    global.findExpressionOutputs = variables.findExpressionOutputs;
    global.findEquationsAndOutputs = variables.findEquationsAndOutputs;
    global.buildOutputLine = variables.buildOutputLine;
    global.findTableDefinitions = variables.findTableDefinitions;
    global.parseMarkedLine = variables.parseMarkedLine;
    global.expandInlineExprs = variables.expandInlineExprs;

    // Storage (minimal dependencies)
    const storage = require(path.join(jsPath, 'storage.js'));
    global.importFromText = storage.importFromText;
    global.exportToText = storage.exportToText;
    global.createDefaultData = storage.createDefaultData;
    global.isReferenceRecord = storage.isReferenceRecord;
    global.isReferenceTitle = storage.isReferenceTitle;
    global.stripStaleSections = storage.stripStaleSections;

    // Solve Engine (depends on all above)
    const solveEngine = require(path.join(jsPath, 'solve-engine.js'));
    global.solveRecord = solveEngine.solveRecord;
    global.solveRecordTwoPass = solveEngine.solveRecordTwoPass;
    global.solveEquations = solveEngine.solveEquations;
    global.formatOutput = solveEngine.formatOutput;
    global.appendTraceSection = solveEngine.appendTraceSection;

    return { parser, evaluator, solver, variables, storage, solveEngine };
}

/**
 * Normalize text for comparison:
 * - Trim whitespace from lines
 * - Normalize line endings
 * - Remove trailing empty lines
 */
function normalizeText(text) {
    return text
        .split('\n')
        .map(line => line.trimEnd())
        .join('\n')
        .replace(/\n+$/, '');
}

/**
 * Compare actual vs expected output (exact match)
 * Returns { match: boolean, diff: string }
 */
function compareOutput(actual, expected) {
    const actualLines = normalizeText(actual).split('\n');
    const expectedLines = normalizeText(expected).split('\n');

    const diffs = [];
    const maxLines = Math.max(actualLines.length, expectedLines.length);

    for (let i = 0; i < maxLines; i++) {
        const actualLine = actualLines[i] || '';
        const expectedLine = expectedLines[i] || '';

        if (actualLine !== expectedLine) {
            diffs.push({
                line: i + 1,
                expected: expectedLine,
                actual: actualLine
            });
        }
    }

    if (diffs.length === 0) {
        return { match: true, diff: '' };
    }

    const diffText = diffs.map(d =>
        `  Line ${d.line}:\n    Expected: ${d.expected}\n    Actual:   ${d.actual}`
    ).join('\n');

    return { match: false, diff: diffText };
}

/**
 * Solve all records in a data object
 */
function solveAllRecords(data, traceMode = false) {
    const records = data.records;

    // Pre-parse Constants and Functions records once (matches UI flow via getReferenceInfo)
    const constantsRecord = records.find(r => isReferenceRecord(r, 'Constants'));
    const functionsRecord = records.find(r => isReferenceRecord(r, 'Functions'));
    const constantsTokens = constantsRecord ? new Tokenizer(constantsRecord.text).tokenize() : null;
    const functionsTokens = functionsRecord ? new Tokenizer(functionsRecord.text).tokenize() : null;
    const parsedConstants = constantsRecord ? parseConstantsRecord(constantsRecord.text, constantsTokens) : null;
    const parsedFunctions = functionsRecord ? parseFunctionsRecord(functionsRecord.text, functionsTokens) : null;

    const varStatusByRecord = [];
    for (const record of records) {
        // Shared two-pass solve (solve-engine.js), same as the production worker.
        // Tests always include the table-outputs section so expected outputs can
        // verify its formatting (production defaults to off — Shift+Solve opts in).
        // traceMode enables the "--- Solve Trace ---" section (trace-tests.txt).
        const out = solveRecordTwoPass(record.text, record, parsedConstants, parsedFunctions, {
            traceMode,
            includeTableOutputs: true
        });
        record.text = out.text;

        // Store any errors/status in the record (match UI behavior)
        if (out.errors && out.errors.length > 0) {
            record.status = out.errors.join('\n');
            record.statusIsError = true;
        } else {
            record.status = out.solved > 0
                ? `Solved ${out.solved} equation${out.solved > 1 ? 's' : ''}`
                : 'Nothing to solve';
            record.statusIsError = false;
        }

        // Capture highlighting state for comparison against the expected
        // file's VarStatus line for this record.
        varStatusByRecord.push(formatVarStatus(out.equationVarStatus));
    }

    return { data, varStatusByRecord };
}

/**
 * Run a single test
 */
function runTest(inputPath, expectedPath) {
    const testName = path.basename(inputPath, '.txt');

    // Read input file
    let inputText;
    try {
        inputText = fs.readFileSync(inputPath, 'utf8');
    } catch (e) {
        return { name: testName, passed: false, error: `Cannot read input: ${e.message}` };
    }

    // Read expected file
    let expectedText;
    try {
        expectedText = fs.readFileSync(expectedPath, 'utf8');
    } catch (e) {
        return { name: testName, passed: false, error: `Cannot read expected: ${e.message}` };
    }

    // Import input
    let data;
    try {
        data = importFromText(inputText);
    } catch (e) {
        return { name: testName, passed: false, error: `Import failed: ${e.message}` };
    }

    // Solve all records — enable trace mode for the trace-tests file
    const traceMode = testName === 'trace-tests';
    let varStatusByRecord;
    try {
        ({ data, varStatusByRecord } = solveAllRecords(data, traceMode));
    } catch (e) {
        return { name: testName, passed: false, error: `Solve failed: ${e.message}` };
    }

    // Export result, then inject per-record VarStatus lines that capture
    // the highlighting state when it's non-default (any non-'solved' entry,
    // or empty on a record with equations). All-green and equation-less
    // records produce no VarStatus line.
    let actualText;
    try {
        const selectedRecordId = data.settings?.lastRecordId;
        actualText = injectVarStatusLines(
            exportToText(data, { selectedRecordId }),
            varStatusByRecord
        );
    } catch (e) {
        return { name: testName, passed: false, error: `Export failed: ${e.message}` };
    }

    // Compare
    const comparison = compareOutput(actualText, expectedText);

    if (comparison.match) {
        return { name: testName, passed: true };
    } else {
        return { name: testName, passed: false, error: `Output mismatch:\n${comparison.diff}` };
    }
}

/**
 * Given outputs: an output the user typed a value into is passed to the solve
 * as keepOutputLines (the panel tracks it; the record text can't say which
 * output was entered, so this can't be a fixture). The solve must keep that
 * value, derive the other outputs from it, and report status for it (as for
 * an input) but for no other output.
 */
function runGivenOutputTest() {
    const name = 'given-output (keepOutputLines)';
    const record = { places: 4, stripZeros: true, format: 'float', degreesMode: false };
    const text = 'inches = feet*12\nyards = feet/3\n\ninches->\nfeet-> 3\nyards->';
    const problems = [];
    const out = solveRecordTwoPass(text, record, null, null, { keepOutputLines: [5] });
    const expectedText = 'inches = feet*12\nyards = feet/3\n\ninches-> 36\nfeet-> 3\nyards-> 1';
    if (out.text !== expectedText) problems.push(`text:\n${out.text}\nexpected:\n${expectedText}`);
    if (out.errors.length) problems.push(`errors: ${out.errors.join('; ')}`);
    const status = [...(out.equationVarStatus || new Map())];
    if (JSON.stringify(status) !== JSON.stringify([['feet', 'solved']])) {
        problems.push(`status: ${JSON.stringify(status)} (expected only feet: solved)`);
    }
    // Without the kept line, every output is cleared — nothing to solve from
    const bare = solveRecordTwoPass(out.text, record, null, null, {});
    if (!bare.errors.some(e => /Too many unknowns/.test(e))) problems.push('a solve without keepOutputLines should have too many unknowns');
    // Two givens: both kept, the remaining output derived from them
    const two = solveRecordTwoPass('area = w*h\n\nw-> 2\nh-> 3\narea->', record, null, null, { keepOutputLines: [3, 4] });
    if (two.text !== 'area = w*h\n\nw-> 2\nh-> 3\narea-> 6') problems.push(`two givens text:\n${two.text}`);
    if (two.errors.length) problems.push(`two givens errors: ${two.errors.join('; ')}`);
    const twoStatus = [...(two.equationVarStatus || new Map())].map(([k, v]) => `${k}:${v}`).sort().join(',');
    if (twoStatus !== 'h:solved,w:solved') problems.push(`two givens status: ${twoStatus} (expected h, w solved)`);
    // A given named like a global constant: its entered value is used (a
    // given is flipped to INPUT in discovery, so it also shadows the constant)
    const consts = new Map([['g', { value: 9.8, comment: null }]]);
    const shadow = solveRecordTwoPass('f = m*g\n\nm-> 2\ng-> 10\nf->', record, consts, null, { keepOutputLines: [3, 4] });
    if (!/f-> 20$/.test(shadow.text)) problems.push(`given shadowing a constant:\n${shadow.text}`);
    return { name, passed: problems.length === 0, error: problems.join('\n') || null };
}

/**
 * Discover and run all tests
 */
function runAllTests() {
    const inputDir = path.join(__dirname, 'input');
    const expectedDir = path.join(__dirname, 'expected');

    // Check directories exist
    if (!fs.existsSync(inputDir)) {
        console.error(`Error: Input directory not found: ${inputDir}`);
        process.exit(1);
    }
    if (!fs.existsSync(expectedDir)) {
        console.error(`Error: Expected directory not found: ${expectedDir}`);
        process.exit(1);
    }

    // Find all .txt files in input directory
    const inputFiles = fs.readdirSync(inputDir)
        .filter(f => f.endsWith('.txt'))
        .sort();

    if (inputFiles.length === 0) {
        console.log('No test files found in tests/input/');
        console.log('\nTo create a test:');
        console.log('  1. Create a formula in MathPad');
        console.log('  2. Export to tests/input/mytest.txt (before solving)');
        console.log('  3. Solve in MathPad');
        console.log('  4. Export to tests/expected/mytest.txt (after solving)');
        return;
    }

    console.log(`Running ${inputFiles.length} test(s)...\n`);

    const results = [];

    for (const file of inputFiles) {
        const inputPath = path.join(inputDir, file);
        const expectedPath = path.join(expectedDir, file);

        // Check expected file exists
        if (!fs.existsSync(expectedPath)) {
            results.push({
                name: path.basename(file, '.txt'),
                passed: false,
                error: `Missing expected file: tests/expected/${file}`
            });
            continue;
        }

        const result = runTest(inputPath, expectedPath);
        results.push(result);
    }

    results.push(runGivenOutputTest());

    // Print results
    let passed = 0;
    let failed = 0;

    for (const result of results) {
        if (result.passed) {
            console.log(`PASS: ${result.name}`);
            passed++;
        } else {
            console.log(`FAIL: ${result.name}`);
            if (result.error) {
                console.log(result.error.split('\n').map(l => '  ' + l).join('\n'));
            }
            failed++;
        }
    }

    console.log(`\n${passed} passed, ${failed} failed`);

    // Exit with error code if any tests failed
    if (failed > 0) {
        process.exit(1);
    }
}

// Main
try {
    loadModules();
    runAllTests();
} catch (e) {
    console.error('Error:', e.message);
    if (e.stack) {
        console.error(e.stack);
    }
    process.exit(1);
}
