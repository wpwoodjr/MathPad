#!/usr/bin/env node
/**
 * Compare old regex-based parseMarkedLine with new grammar-based parser
 */

const path = require('path');
const jsPath = path.join(__dirname, '..', 'docs', 'js');

// Load modules
const parser = require(path.join(jsPath, 'parser.js'));
global.TokenType = parser.TokenType;
global.Tokenizer = parser.Tokenizer;
global.parseExpression = parser.parseExpression;

// Load variables.js globals needed by line-parser
global.VarType = { STANDARD: 'standard', INPUT: 'input', OUTPUT: 'output', FULL_PRECISION: 'full' };
global.ClearBehavior = { NONE: 'none', ON_CLEAR: 'onClear', ON_SOLVE: 'onSolve' };

const lineParser = require(path.join(jsPath, 'line-parser.js'));
global.LineParser = lineParser.LineParser;
global.parseMarkedLineNew = lineParser.parseMarkedLineNew;

const variables = require(path.join(jsPath, 'variables.js'));

// Test cases from the test files
const testCases = [
    'pi: 3.14159265358979',
    'e: 2.71828182845905',
    'c: 299792458 "speed of light m/s"',
    'x: 10',
    'y->',
    'a: 3',
    'a + b + pi->',
    'Enter x<- 7',
    'Enter y: 3',
    'Result x+y: 8',
    'Result x+y-> 8',
    'pmt$: -$607.61 "monthly payment"',
    'yint%: 6.12% "annual interest rate %"',
    'yint%[0:0.5]: "annual interest rate %"',
    'Enter height (in)    ht<-62.5',
    'Enter weight (lb)    wt<-139.5',
    'Input (test) a<- 5',
    'Value (m/s) b: 10',
    'Result (%) c->',
    'sqrt(a)->',
    'a + b->',
    '(a * b)->',
    "Output a-> 5 that's a",
    "result sqrt(a)-> that's sqrt(a)",
    'result: (a * b)-> should be 50',
    'PAO2-> 275 mm Hg',
    'BSA-> m2',
    'x->>',
    'x:: 10',
    'h/w = 16/9',
    'Label: { x + 5 = y }',
];

// Compare semantically important fields
function semanticCompare(oldResult, newResult) {
    if (oldResult === null && newResult === null) return { match: true };
    if (oldResult === null || newResult === null) return { match: false, field: 'null', oldValue: oldResult, newValue: newResult };

    // Compare only semantically important fields
    const fields = ['kind', 'name', 'type', 'clearBehavior', 'valueText', 'base', 'fullPrecision', 'marker', 'format', 'comment', 'expression', 'recalculates'];

    for (const field of fields) {
        if (oldResult[field] !== newResult[field]) {
            return { match: false, field, oldValue: oldResult[field], newValue: newResult[field] };
        }
    }

    // Check limits if present in either result
    const oldLimits = oldResult.limits;
    const newLimits = newResult.limits;
    if (oldLimits && newLimits) {
        if (oldLimits.lowExpr !== newLimits.lowExpr) {
            return { match: false, field: 'limits.lowExpr', oldValue: oldLimits.lowExpr, newValue: newLimits.lowExpr };
        }
        if (oldLimits.highExpr !== newLimits.highExpr) {
            return { match: false, field: 'limits.highExpr', oldValue: oldLimits.highExpr, newValue: newLimits.highExpr };
        }
    } else if (oldLimits || newLimits) {
        return { match: false, field: 'limits', oldValue: oldLimits, newValue: newLimits };
    }

    return { match: true };
}

console.log('Comparing old and new parsers (semantic comparison):\n');

let matches = 0;
let mismatches = 0;

for (const testCase of testCases) {
    // Use the legacy regex parser for comparison
    const oldResult = variables.parseMarkedLineLegacy(testCase);
    // parseMarkedLine now uses LineParser, same as parseMarkedLineNew
    const newResult = parseMarkedLineNew(testCase);

    const result = semanticCompare(oldResult, newResult);
    if (result.match) {
        matches++;
    } else {
        mismatches++;
        console.log('MISMATCH: ' + testCase);
        console.log('  Field:', result.field);
        console.log('  Old value:', result.oldValue);
        console.log('  New value:', result.newValue);
        console.log();
    }
}

console.log('\nResults: ' + matches + ' semantic matches, ' + mismatches + ' mismatches');
process.exit(mismatches > 0 ? 1 : 0);
