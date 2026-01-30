#!/usr/bin/env node
/**
 * Validate the grammar-based LineParser parses test cases correctly
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

// Test cases with expected results
const testCases = [
    // Simple declarations
    { input: 'pi: 3.14159265358979', expected: { kind: 'declaration', name: 'pi', marker: ':' } },
    { input: 'x: 10', expected: { kind: 'declaration', name: 'x', marker: ':' } },
    { input: 'y->', expected: { kind: 'declaration', name: 'y', marker: '->' } },
    { input: 'x->>', expected: { kind: 'declaration', name: 'x', marker: '->>' } },
    { input: 'x:: 10', expected: { kind: 'declaration', name: 'x', marker: '::' } },

    // Input declarations
    { input: 'Enter x<- 7', expected: { kind: 'declaration', name: 'x', marker: '<-', type: 'input' } },
    { input: 'Enter height (in)    ht<-62.5', expected: { kind: 'declaration', name: 'ht', marker: '<-' } },
    { input: 'Input (test) a<- 5', expected: { kind: 'declaration', name: 'a', marker: '<-' } },

    // Format suffixes
    { input: 'pmt$: -$607.61 "monthly payment"', expected: { kind: 'declaration', name: 'pmt', format: 'money' } },
    { input: 'yint%: 6.12% "annual interest rate %"', expected: { kind: 'declaration', name: 'yint', format: 'percent' } },

    // Limits
    { input: 'yint%[0:0.5]: "annual interest rate %"', expected: { kind: 'declaration', name: 'yint', limits: { lowExpr: '0', highExpr: '0.5' } } },

    // Label text with parentheses (should be declarations)
    { input: 'Value (m/s) b: 10', expected: { kind: 'declaration', name: 'b' } },
    { input: 'Result (%) c->', expected: { kind: 'declaration', name: 'c' } },

    // Expression outputs
    { input: 'sqrt(a)->', expected: { kind: 'expression-output', expression: 'sqrt(a)' } },
    { input: 'a + b->', expected: { kind: 'expression-output', expression: 'a + b' } },
    { input: '(a * b)->', expected: { kind: 'expression-output', expression: '(a * b)' } },
    { input: 'a + b + pi->', expected: { kind: 'expression-output', expression: 'a + b + pi' } },
    { input: 'Result x+y: 8', expected: { kind: 'expression-output', expression: 'x+y' } },
    { input: 'Result x+y-> 8', expected: { kind: 'expression-output', expression: 'x+y' } },
    { input: 'result: (a * b)-> should be 50', expected: { kind: 'expression-output', expression: '(a * b)' } },

    // With comments
    { input: 'c: 299792458 "speed of light m/s"', expected: { kind: 'declaration', name: 'c', comment: 'speed of light m/s' } },
    { input: 'PAO2-> 275 mm Hg', expected: { kind: 'declaration', name: 'PAO2', comment: 'mm Hg', commentUnquoted: true } },
    { input: 'BSA-> m2', expected: { kind: 'declaration', name: 'BSA', comment: 'm2', commentUnquoted: true } },

    // Not declarations or expression outputs (should return null)
    { input: 'h/w = 16/9', expected: null },
    { input: 'Label: { x + 5 = y }', expected: null },
];

console.log('Validating LineParser:\n');

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
    const result = parseMarkedLineNew(testCase.input);

    // Check expected fields match
    let match = true;
    let mismatchDetails = [];

    if (testCase.expected === null) {
        if (result !== null) {
            match = false;
            mismatchDetails.push(`expected null, got ${result.kind}`);
        }
    } else if (result === null) {
        match = false;
        mismatchDetails.push(`expected ${testCase.expected.kind}, got null`);
    } else {
        for (const [key, expectedValue] of Object.entries(testCase.expected)) {
            const actualValue = result[key];
            if (typeof expectedValue === 'object' && expectedValue !== null) {
                // Deep compare for objects like limits
                for (const [subKey, subExpected] of Object.entries(expectedValue)) {
                    if (actualValue?.[subKey] !== subExpected) {
                        match = false;
                        mismatchDetails.push(`${key}.${subKey}: expected "${subExpected}", got "${actualValue?.[subKey]}"`);
                    }
                }
            } else if (actualValue !== expectedValue) {
                match = false;
                mismatchDetails.push(`${key}: expected "${expectedValue}", got "${actualValue}"`);
            }
        }
    }

    if (match) {
        passed++;
    } else {
        failed++;
        console.log('FAIL: ' + testCase.input);
        for (const detail of mismatchDetails) {
            console.log('  ' + detail);
        }
        console.log();
    }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
