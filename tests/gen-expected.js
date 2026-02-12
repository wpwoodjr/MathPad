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

const testName = process.argv[2];
if (!testName) { console.error("Usage: node tests/gen-expected.js TESTNAME"); process.exit(1); }

const input = fs.readFileSync(path.join(__dirname, "input", testName + ".txt"), "utf8");
const data = importFromText(input);
for (const record of data.records) {
    const context = createEvalContext(data.records, record, record.text);
    const result = solveRecord(record.text, context, record);
    record.text = result.text;
    if (result.errors && result.errors.length > 0) {
        record.status = "Solved with errors: " + result.errors[0];
        record.statusIsError = true;
    } else {
        record.status = result.solved > 0 ? "Solved " + result.solved + " equation" + (result.solved > 1 ? "s" : "") : "Nothing to solve";
        record.statusIsError = false;
    }
}
const output = exportToText(data, { selectedRecordId: data.settings?.lastRecordId });
fs.writeFileSync(path.join(__dirname, "expected", testName + ".txt"), output);
console.log("Generated expected output for " + testName);
