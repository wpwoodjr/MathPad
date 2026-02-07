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

// Path to docs/js modules
const jsPath = path.join(__dirname, '..', 'docs', 'js');

// Load modules in dependency order, making exports global
function loadModules() {
    // Parser (no dependencies)
    const parser = require(path.join(jsPath, 'parser.js'));
    global.TokenType = parser.TokenType;
    global.NodeType = parser.NodeType;
    global.Tokenizer = parser.Tokenizer;
    global.Parser = parser.Parser;
    global.ParseError = parser.ParseError;
    global.tokenize = parser.tokenize;
    global.parseExpression = parser.parseExpression;
    global.findLineCommentStart = parser.findLineCommentStart;

    // Line Parser (depends on parser)
    const lineParser = require(path.join(jsPath, 'line-parser.js'));
    global.LineType = lineParser.LineType;
    global.LineParser = lineParser.LineParser;
    global.parseMarkedLineNew = lineParser.parseMarkedLineNew;
    global.isMarkerToken = lineParser.isMarkerToken;
    global.getMarkerString = lineParser.getMarkerString;

    // Evaluator (depends on parser for AST types)
    const evaluator = require(path.join(jsPath, 'evaluator.js'));
    global.EvalContext = evaluator.EvalContext;
    global.EvalError = evaluator.EvalError;
    global.evaluate = evaluator.evaluate;
    global.formatNumber = evaluator.formatNumber;
    global.builtinFunctions = evaluator.builtinFunctions;
    global.checkBalance = evaluator.checkBalance;

    // Solver (depends on parser, evaluator)
    const solver = require(path.join(jsPath, 'solver.js'));
    global.SolverError = solver.SolverError;
    global.brent = solver.brent;
    global.solveEquation = solver.solveEquation;
    global.isDefinitionEquation = solver.isDefinitionEquation;
    global.deriveSubstitution = solver.deriveSubstitution;
    global.buildSubstitutionMap = solver.buildSubstitutionMap;
    global.substituteInAST = solver.substituteInAST;

    // Variables (depends on parser, evaluator)
    const variables = require(path.join(jsPath, 'variables.js'));
    global.VarType = variables.VarType;
    global.ClearBehavior = variables.ClearBehavior;
    global.expandLiterals = variables.expandLiterals;
    global.expandLineLiterals = variables.expandLineLiterals;
    global.parseVariableLine = variables.parseVariableLine;
    global.parseAllVariables = variables.parseAllVariables;
    global.setVariableValue = variables.setVariableValue;
    global.clearVariables = variables.clearVariables;
    global.findEquations = variables.findEquations;
    global.createEvalContext = variables.createEvalContext;
    global.parseConstantsRecord = variables.parseConstantsRecord;
    global.parseFunctionsRecord = variables.parseFunctionsRecord;
    global.discoverVariables = variables.discoverVariables;
    global.getInlineEvalFormat = variables.getInlineEvalFormat;
    global.formatVariableValue = variables.formatVariableValue;
    global.findExpressionOutputs = variables.findExpressionOutputs;
    global.clearExpressionOutputs = variables.clearExpressionOutputs;
    global.buildOutputLine = variables.buildOutputLine;

    // Storage (minimal dependencies)
    const storage = require(path.join(jsPath, 'storage.js'));
    global.importFromText = storage.importFromText;
    global.exportToText = storage.exportToText;
    global.createDefaultData = storage.createDefaultData;

    // Solve Engine (depends on all above)
    const solveEngine = require(path.join(jsPath, 'solve-engine.js'));
    global.solveRecord = solveEngine.solveRecord;
    global.solveEquations = solveEngine.solveEquations;
    global.formatOutput = solveEngine.formatOutput;

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
function solveAllRecords(data) {
    const records = data.records;

    for (const record of records) {
        // Create eval context with constants and functions
        const context = createEvalContext(records, record, record.text);

        // Clear output variables before solving
        record.text = clearVariables(record.text, 'output');

        // Solve
        const result = solveRecord(record.text, context, record);
        record.text = result.text;

        // Store any errors in the record (match UI behavior: prefix + first error only)
        if (result.errors && result.errors.length > 0) {
            record.status = 'Solved with errors: ' + result.errors[0];
            record.statusIsError = true;
        } else {
            record.status = result.solved > 0
                ? `Solved ${result.solved} equation${result.solved > 1 ? 's' : ''}`
                : 'Nothing to solve';
            record.statusIsError = false;
        }
    }

    return data;
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

    // Solve all records
    try {
        data = solveAllRecords(data);
    } catch (e) {
        return { name: testName, passed: false, error: `Solve failed: ${e.message}` };
    }

    // Export result
    let actualText;
    try {
        // Get selected record ID from settings (set during import from Selected = 1 flag)
        const selectedRecordId = data.settings?.lastRecordId;
        actualText = exportToText(data, { selectedRecordId });
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
