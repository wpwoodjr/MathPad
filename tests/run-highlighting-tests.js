#!/usr/bin/env node
/**
 * MathPad Syntax Highlighting Tests
 *
 * Tests the tokenizeMathPad function to verify correct syntax highlighting.
 *
 * Usage: node tests/run-highlighting-tests.js
 */

const fs = require('fs');
const path = require('path');

// Path to docs/js modules
const jsPath = path.join(__dirname, '..', 'docs', 'js');

// Load modules in dependency order
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

    // Line Parser (depends on parser)
    const lineParser = require(path.join(jsPath, 'line-parser.js'));
    global.LineType = lineParser.LineType;
    global.LineParser = lineParser.LineParser;
    global.parseMarkedLineNew = lineParser.parseMarkedLineNew;
    global.isMarkerToken = lineParser.isMarkerToken;
    global.getMarkerString = lineParser.getMarkerString;

    // Evaluator (depends on parser)
    const evaluator = require(path.join(jsPath, 'evaluator.js'));
    global.EvalContext = evaluator.EvalContext;
    global.formatNumber = evaluator.formatNumber;
    global.builtinFunctions = evaluator.builtinFunctions;

    // Variables (depends on parser, evaluator)
    const variables = require(path.join(jsPath, 'variables.js'));
    global.VarType = variables.VarType;
    global.ClearBehavior = variables.ClearBehavior;
    global.parseFunctionsRecord = variables.parseFunctionsRecord;
    global.extractEquationFromLine = variables.extractEquationFromLine;

    // Editor (depends on parser, variables)
    const editor = require(path.join(jsPath, 'editor.js'));
    global.tokenizeMathPad = editor.tokenizeMathPad;

    return { parser, lineParser, evaluator, variables, editor };
}

/**
 * Get tokens for a line of text, optionally with preceding context lines
 * Returns array of { text, type } for each token on the target line
 */
function getTokens(line, context = '') {
    const fullText = context ? context + '\n' + line : line;
    const lineStart = context ? context.length + 1 : 0;
    const lineEnd = lineStart + line.length;

    const tokens = tokenizeMathPad(fullText);
    return tokens
        .filter(t => t.from >= lineStart && t.from < lineEnd)
        .map(t => ({
            text: line.slice(t.from - lineStart, t.to - lineStart),
            type: t.type
        }));
}

/**
 * Find token by text content
 */
function findToken(tokens, text) {
    return tokens.find(t => t.text === text);
}

/**
 * Assert a token has expected type
 */
function assertTokenType(tokens, text, expectedType, testName) {
    const token = findToken(tokens, text);
    if (!token) {
        return { passed: false, error: `Token '${text}' not found` };
    }
    if (token.type !== expectedType) {
        return { passed: false, error: `Token '${text}' has type '${token.type}', expected '${expectedType}'` };
    }
    return { passed: true };
}

/**
 * Run a single highlighting test
 */
function runTest(name, line, assertions, context = '') {
    const tokens = getTokens(line, context);
    const errors = [];

    for (const [text, expectedType] of assertions) {
        const result = assertTokenType(tokens, text, expectedType, name);
        if (!result.passed) {
            errors.push(result.error);
        }
    }

    if (errors.length === 0) {
        return { name, passed: true };
    } else {
        return { name, passed: false, error: errors.join('\n') };
    }
}

/**
 * Define and run all highlighting tests
 */
function runAllTests() {
    const tests = [
        // Base literal highlighting tests
        {
            name: 'base literal as value (ff#16)',
            line: 'ff: ff#16',
            assertions: [
                ['ff', 'variable-def'],
                [':', 'punctuation'],
                ['ff#16', 'number']
            ]
        },
        {
            name: 'variable with base format suffix (ff#16->)',
            line: 'ff#16->',
            assertions: [
                ['ff', 'variable-def'],
                ['#', 'variable-def'],
                ['16', 'variable-def'],
                ['->', 'punctuation']
            ]
        },
        {
            name: 'variable output (ff->)',
            line: 'ff->',
            assertions: [
                ['ff', 'variable-def'],
                ['->', 'punctuation']
            ]
        },
        {
            name: 'different var name with base literal value (xx: ff#16)',
            line: 'xx: ff#16',
            assertions: [
                ['xx', 'variable-def'],
                [':', 'punctuation'],
                ['ff#16', 'number']
            ]
        },
        {
            name: 'variable with base format (xx#16->)',
            line: 'xx#16->',
            assertions: [
                ['xx', 'variable-def'],
                ['#', 'variable-def'],
                ['16', 'variable-def'],
                ['->', 'punctuation']
            ]
        },
        {
            name: 'digit-start base literal always literal (7v#32->)',
            line: '7v#32->',
            assertions: [
                ['7v#32', 'number'],
                ['->', 'punctuation']
            ]
        },
        {
            name: 'base literal in equation (y = ff#16)',
            line: 'y = ff#16',
            assertions: [
                ['y', 'variable'],
                ['=', 'operator'],
                ['ff#16', 'number']
            ]
        },
        // Hex literals
        {
            name: 'hex literal (0xFF)',
            line: 'x: 0xFF',
            assertions: [
                ['x', 'variable-def'],
                ['0xFF', 'number']
            ]
        },
        // Money format
        {
            name: 'money literal ($100)',
            line: 'price: $100',
            assertions: [
                ['price', 'variable-def'],
                ['$100', 'number']
            ]
        },
        {
            name: 'negative money literal (-$50)',
            line: 'cost: -$50',
            assertions: [
                ['cost', 'variable-def'],
                ['-$50', 'number']
            ]
        },
        // Percent format
        {
            name: 'percent literal (5%)',
            line: 'rate: 5%',
            assertions: [
                ['rate', 'variable-def'],
                ['5%', 'number']
            ]
        },
        // Special values
        {
            name: 'NaN as number',
            line: 'x: NaN',
            assertions: [
                ['x', 'variable-def'],
                ['NaN', 'number']
            ]
        },
        {
            name: 'Infinity as number',
            line: 'x: Infinity',
            assertions: [
                ['x', 'variable-def'],
                ['Infinity', 'number']
            ]
        },
        // Variable declarations with different markers
        {
            name: 'input marker (<-)',
            line: 'x<- 5',
            assertions: [
                ['x', 'variable-def'],
                ['<-', 'punctuation'],
                ['5', 'number']
            ]
        },
        {
            name: 'full precision output (->>)',
            line: 'x->>',
            assertions: [
                ['x', 'variable-def'],
                ['->>', 'punctuation']
            ]
        },
        {
            name: 'full precision input (::)',
            line: 'x:: 3.14159',
            assertions: [
                ['x', 'variable-def'],
                ['::', 'punctuation'],
                ['3.14159', 'number']
            ]
        },
        // Format suffixes
        {
            name: 'money suffix (price$:)',
            line: 'price$: 100',
            assertions: [
                ['price', 'variable-def'],
                ['$', 'variable-def'],
                [':', 'punctuation'],
                ['100', 'number']
            ]
        },
        {
            name: 'percent suffix (rate%:)',
            line: 'rate%: 5',
            assertions: [
                ['rate', 'variable-def'],
                ['%', 'variable-def'],
                [':', 'punctuation'],
                ['5', 'number']
            ]
        },
        // Functions
        {
            name: 'builtin function in expression',
            line: 'x: sqrt(4)',
            assertions: [
                ['x', 'variable-def'],
                [':', 'punctuation'],
                ['sqrt', 'builtin'],
                ['(', 'paren'],
                ['4', 'number'],
                [')', 'paren']
            ]
        },
        // User-defined function definition
        {
            name: 'user-defined function definition',
            line: 'mod(a; b) = a + b',
            assertions: [
                ['mod', 'function'],
                ['(', 'paren'],
                ['a', 'variable'],
                [';', 'punctuation'],
                ['b', 'variable'],
                [')', 'paren'],
                ['=', 'operator'],
            ]
        },
        // User-defined function call (with context)
        {
            name: 'user-defined function call',
            line: 'mod(3; 4)->',
            context: 'mod(a; b) = a + b',
            assertions: [
                ['mod', 'function'],
                ['(', 'paren'],
                ['3', 'number'],
                [';', 'punctuation'],
                ['4', 'number'],
                [')', 'paren'],
                ['->', 'punctuation']
            ]
        },
        // User-defined function shadows builtin - with label text (no output value)
        {
            name: 'user-defined function with labels (so mod(a; b)-> the value of a+b)',
            line: 'so mod(a; b)-> the value of a+b',
            context: 'mod(a; b) = a + b',
            assertions: [
                ['so ', 'comment'],           // label text before
                ['mod', 'function'],          // user-defined, not builtin
                ['(', 'paren'],
                ['a', 'variable'],
                [';', 'punctuation'],
                ['b', 'variable'],
                [')', 'paren'],
                ['->', 'punctuation'],
                ['the value of a+b', 'comment']  // label text after
            ]
        },
        // User-defined function shadows builtin - with label text and output value
        {
            name: 'user-defined function with labels (so mod(a; b)-> 8 the value of a+b)',
            line: 'so mod(a; b)-> 8 the value of a+b',
            context: 'mod(a; b) = a + b\nEnter a: 5 "a"\nEnter b: 3 "b"',
            assertions: [
                ['so ', 'comment'],           // label text before
                ['mod', 'function'],          // user-defined, not builtin
                ['(', 'paren'],
                ['a', 'variable'],
                [';', 'punctuation'],
                ['b', 'variable'],
                [')', 'paren'],
                ['->', 'punctuation'],
                ['8', 'number'],              // output value
                ['the value of a+b', 'comment']  // label text after
            ]
        },
        // Variable with comment
        {
            name: 'variable with trailing comment',
            line: 'Enter a: 5 "a value"',
            assertions: [
                ['a', 'variable-def'],
                [':', 'punctuation'],
                ['5', 'number'],
                ['"a value"', 'comment']
            ]
        },
        // Variable with no value, just comment
        {
            name: 'variable with no value (Enter a: "a")',
            line: 'Enter a: "a"',
            assertions: [
                ['Enter ', 'comment'],        // label text
                ['a', 'variable-def'],
                [':', 'punctuation'],
                ['"a"', 'comment']            // quoted comment
            ]
        },
        // Comments
        {
            name: 'quoted comment',
            line: '"This is a comment"',
            assertions: [
                ['"This is a comment"', 'comment']
            ]
        },
        // Multi-line quoted comment
        {
            name: 'multi-line quoted comment',
            line: '"line 1\nline 2\nline 3"',
            assertions: [
                ['"line 1\nline 2\nline 3"', 'comment']
            ]
        },
        // Multi-line braced equation (first line)
        {
            name: 'braced equation start (This is a fn: { xmin(a;b) =)',
            line: 'This is a fn: { xmin(a;b) = ',
            assertions: [
                ['This is a fn: ', 'comment'],  // everything before { is label
                ['{', 'brace'],
                ['xmin', 'function'],
                ['(', 'paren'],
                ['a', 'variable'],
                [';', 'punctuation'],
                ['b', 'variable'],
                [')', 'paren'],
                ['=', 'operator']
            ]
        },
        // Multi-line braced equation (continuation with if)
        {
            name: 'braced equation continuation (if(a<b; a; b))',
            line: '  if(a<b; a; b)',
            context: 'This is a fn: { xmin(a;b) = ',
            assertions: [
                ['if', 'builtin'],
                ['(', 'paren'],
                ['a', 'variable'],
                ['<', 'operator'],
                ['b', 'variable'],
                [';', 'punctuation'],
                [')', 'paren']
            ]
        },
        // Multi-line braced equation (end with trailing text)
        {
            name: 'braced equation end (* 3 } hi there)',
            line: '  * 3 } hi there',
            context: 'This is a fn: { xmin(a;b) = \n  if(a<b; a; b)',
            assertions: [
                ['*', 'operator'],
                ['3', 'number'],
                ['}', 'brace'],
                [' hi there', 'comment']  // includes leading space
            ]
        },
        // Expression output - all variables in expression stay as 'variable'
        {
            name: 'expression output (a + b->)',
            line: 'a + b->',
            assertions: [
                ['a', 'variable'],
                ['+', 'operator'],
                ['b', 'variable'],
                ['->', 'punctuation']
            ]
        },
        // Simple variable output - variable before marker is variable-def
        {
            name: 'simple variable output (b->)',
            line: 'b->',
            assertions: [
                ['b', 'variable-def'],
                ['->', 'punctuation']
            ]
        }
    ];

    console.log(`Running ${tests.length} highlighting test(s)...\n`);

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        const result = runTest(test.name, test.line, test.assertions, test.context || '');
        if (result.passed) {
            console.log(`PASS: ${result.name}`);
            passed++;
        } else {
            console.log(`FAIL: ${result.name}`);
            console.log(`  Line: ${test.line}`);
            console.log(`  ${result.error.split('\n').join('\n  ')}`);
            failed++;
        }
    }

    console.log(`\n${passed} passed, ${failed} failed`);

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
