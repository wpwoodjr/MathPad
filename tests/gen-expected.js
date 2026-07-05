#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
const jsPath = path.join(__dirname, "..", "docs", "js");
Object.assign(global, require(path.join(jsPath, "parser.js")));
Object.assign(global, require(path.join(jsPath, "line-parser.js")));
Object.assign(global, require(path.join(jsPath, "evaluator.js")));
Object.assign(global, require(path.join(jsPath, "solver.js")));
Object.assign(global, require(path.join(jsPath, "variables.js")));
Object.assign(global, require(path.join(jsPath, "storage.js")));
Object.assign(global, require(path.join(jsPath, "solve-engine.js")));
const { formatVarStatus, injectVarStatusLines } = require("./var-status-utils.js");

const testName = process.argv[2];
if (!testName) { console.error("Usage: node tests/gen-expected.js TESTNAME"); process.exit(1); }

const input = fs.readFileSync(path.join(__dirname, "input", testName + ".txt"), "utf8");
const data = importFromText(input);
const constantsRecord = data.records.find(r => isReferenceRecord(r, 'Constants'));
const functionsRecord = data.records.find(r => isReferenceRecord(r, 'Functions'));
const constantsTokens = constantsRecord ? new Tokenizer(constantsRecord.text).tokenize() : null;
const functionsTokens = functionsRecord ? new Tokenizer(functionsRecord.text).tokenize() : null;
const parsedConstants = constantsRecord ? parseConstantsRecord(constantsRecord.text, constantsTokens) : null;
const parsedFunctions = functionsRecord ? parseFunctionsRecord(functionsRecord.text, functionsTokens) : null;
const traceMode = testName === 'trace-tests';
const varStatusByRecord = [];
for (const record of data.records) {
    // Shared two-pass solve (solve-engine.js), same as the production worker and
    // run-tests.js. Tests always include the table-outputs section (production
    // defaults to off — opt-in via Shift+Solve).
    const out = solveRecordTwoPass(record.text, record, parsedConstants, parsedFunctions, {
        traceMode,
        includeTableOutputs: true
    });
    record.text = out.text;

    if (out.errors && out.errors.length > 0) {
        record.status = out.errors.join('\n');
        record.statusIsError = true;
    } else {
        record.status = out.solved > 0 ? "Solved " + out.solved + " equation" + (out.solved > 1 ? "s" : "") : "Nothing to solve";
        record.statusIsError = false;
    }

    // Capture highlighting state for the expected file (one line per
    // record, see var-status-utils.js).
    varStatusByRecord.push(formatVarStatus(out.equationVarStatus));
}
const rawOutput = exportToText(data, { selectedRecordId: data.settings?.lastRecordId });
const output = injectVarStatusLines(rawOutput, varStatusByRecord);
fs.writeFileSync(path.join(__dirname, "expected", testName + ".txt"), output);
console.log("Generated expected output for " + testName);
