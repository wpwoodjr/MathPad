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
    global.stripComments = parser.stripComments;

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
    global.parseConstantsRecord = variables.parseConstantsRecord;
    global.parseVariableLine = variables.parseVariableLine;
    global.extractEquationFromLine = variables.extractEquationFromLine;

    // Editor (depends on parser, variables)
    const editor = require(path.join(jsPath, 'editor.js'));
    global.tokenizeMathPad = editor.tokenizeMathPad;

    return { parser, lineParser, evaluator, variables, editor };
}

/**
 * Get tokens for a line of text, optionally with preceding context lines
 * Returns array of { text, type } for each token on the target line
 * @param {string} line - The line to tokenize
 * @param {string} context - Optional preceding context lines
 * @param {Object} options - Optional tokenizer options (referenceConstants, referenceFunctions)
 */
function getTokens(line, context = '', options = {}) {
    const fullText = context ? context + '\n' + line : line;
    const lineStart = context ? context.length + 1 : 0;
    const lineEnd = lineStart + line.length;

    const tokens = tokenizeMathPad(fullText, options);
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
function runTest(name, line, assertions, context = '', options = {}) {
    const tokens = getTokens(line, context, options);
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
        },
        // Plain text with numbers should be comment, not extract numbers (including NaN/Infinity)
        {
            name: 'plain text with numbers as comment',
            line: '    these equations calculate the alveolar oxygen tension (which can range from 100mm on RA to 673mm on 100% oxygen NaN Infinity)',
            assertions: [
                ['    these equations calculate the alveolar oxygen tension (which can range from 100mm on RA to 673mm on 100% oxygen NaN Infinity)', 'comment']
            ]
        },
        // Equation with label text before and after
        {
            name: 'equation with labels (equation f(x4; c5; c4; c3; c2; c1; c0) = 0 end)',
            line: 'equation f(x4; c5; c4; c3; c2; c1; c0) = 0 end',
            assertions: [
                ['equation ', 'comment'],
                ['f', 'function'],
                ['(', 'paren'],
                ['x4', 'variable'],
                [';', 'punctuation'],
                ['c5', 'variable'],
                ['c4', 'variable'],
                ['c3', 'variable'],
                ['c2', 'variable'],
                ['c1', 'variable'],
                ['c0', 'variable'],
                [')', 'paren'],
                ['=', 'operator'],
                ['0', 'number'],
                [' end', 'comment']
            ]
        },
        // Variable output with limits and label text
        {
            name: 'variable with limits and labels (x4[2.5:3]->)',
            line: 'x4 between 2.5 and 3 is x4[2.5:3]->  - see that',
            assertions: [
                ['x4 between 2.5 and 3 is ', 'comment'],
                ['x4', 'variable-def'],
                ['[', 'bracket'],
                ['2.5', 'number'],
                [':', 'punctuation'],
                ['3', 'number'],
                [']', 'bracket'],
                ['->', 'punctuation'],
                ['- see that', 'comment']
            ]
        },
        // Money format variable with money limits
        {
            name: 'money format with money limits (fv2$[$0:$0.20]: $0.13)',
            line: 'future value fv2$[$0:$0.20]: $0.13',
            assertions: [
                ['future value ', 'comment'],
                ['fv2', 'variable-def'],
                ['$', 'variable-def'],
                ['[', 'bracket'],
                ['$0', 'number'],
                [':', 'punctuation'],
                ['$0.20', 'number'],
                [']', 'bracket'],
                [':', 'punctuation'],
                ['$0.13', 'number']
            ]
        },
        // Percent format variable with label
        {
            name: 'percent format with label (interest rate rate1%: 6)',
            line: 'interest rate rate1%: 6',
            assertions: [
                ['interest rate ', 'comment'],
                ['rate1', 'variable-def'],
                ['%', 'variable-def'],
                [':', 'punctuation'],
                ['6', 'number']
            ]
        },
        // Variable output with value
        {
            name: 'variable output with value (rate1-> 6)',
            line: 'rate1-> 6',
            assertions: [
                ['rate1', 'variable-def'],
                ['->', 'punctuation'],
                ['6', 'number']
            ]
        },
        // Percent format variable output with percent value
        {
            name: 'percent format output (rate1%-> 600%)',
            line: 'rate1%-> 600%',
            assertions: [
                ['rate1', 'variable-def'],
                ['%', 'variable-def'],
                ['->', 'punctuation'],
                ['600%', 'number']
            ]
        },
        // Percent format variable with expression value
        {
            name: 'percent format with expression (rate%: 6+6%)',
            line: 'rate%: 6+6%',
            assertions: [
                ['rate', 'variable-def'],
                ['%', 'variable-def'],
                [':', 'punctuation'],
                ['6', 'number'],
                ['+', 'operator'],
                ['6%', 'number']
            ]
        },
        // Percent format with limits, value, label, and quoted comment
        {
            name: 'percent format full (Enter yint%[0:5.1%]: 5% "annual interest rate %")',
            line: 'Enter yint%[0:5.1%]: 5% "annual interest rate %"',
            assertions: [
                ['Enter ', 'comment'],
                ['yint', 'variable-def'],
                ['%', 'variable-def'],
                ['[', 'bracket'],
                ['0', 'number'],
                [':', 'punctuation'],
                ['5.1%', 'number'],
                [']', 'bracket'],
                [':', 'punctuation'],
                ['5%', 'number'],
                ['"annual interest rate %"', 'comment']
            ]
        },
        // Single-line braced equation
        {
            name: 'single-line braced equation (TVM payment formula)',
            line: '{ pmt = -(pv + fv / (1 + mint)**n) * mint / (1 - (1 + mint)**-n) }',
            assertions: [
                ['{', 'brace'],
                ['pmt', 'variable'],
                ['=', 'operator'],
                ['pv', 'variable'],
                ['fv', 'variable'],
                ['mint', 'variable'],
                ['n', 'variable'],
                ['**', 'operator'],
                ['}', 'brace']
            ]
        },
        // Percent literal in expression with subtraction
        {
            name: 'percent in expression (wibble: 85%-2.8)',
            line: 'wibble: 85%-2.8',
            assertions: [
                ['wibble', 'variable-def'],
                [':', 'punctuation'],
                ['85%', 'number'],
                ['-', 'operator'],
                ['2.8', 'number']
            ]
        },
        // Variable output with negative value
        {
            name: 'output with negative value (wibble-> -1.95)',
            line: 'wibble-> -1.95',
            assertions: [
                ['wibble', 'variable-def'],
                ['->', 'punctuation'],
                ['-', 'operator'],
                ['1.95', 'number']
            ]
        },
        // Infinity expression with labels
        {
            name: 'Infinity expression with labels (Try Infinity/Infinity->)',
            line: "Try Infinity/Infinity-> wow that's not even a number!",
            assertions: [
                ['Try ', 'comment'],
                ['Infinity', 'number'],
                ['/', 'operator'],
                ['->', 'punctuation'],
                ["wow that's not even a number!", 'comment']
            ]
        },
        // Variable output with multiple parenthetical labels
        {
            name: 'variable with parenthetical labels (Result (%) (m/s) c->)',
            line: 'Result (%) (m/s) c-> speed of light',
            assertions: [
                ['Result (%) (m/s) ', 'comment'],
                ['c', 'variable-def'],
                ['->', 'punctuation'],
                ['speed of light', 'comment']
            ]
        },
        // Reference constant highlighted as builtin
        {
            name: 'reference constant as builtin (pi + e)',
            line: 'x: pi + e',
            options: { referenceConstants: new Set(['pi', 'e']) },
            assertions: [
                ['x', 'variable-def'],
                [':', 'punctuation'],
                ['pi', 'builtin'],
                ['+', 'operator'],
                ['e', 'builtin']
            ]
        },
        // Reference function highlighted as builtin
        {
            name: 'reference function as builtin (hypot(3;4))',
            line: 'x: hypot(3; 4)',
            options: { referenceFunctions: new Set(['hypot']) },
            assertions: [
                ['x', 'variable-def'],
                [':', 'punctuation'],
                ['hypot', 'builtin'],
                ['(', 'paren'],
                ['3', 'number'],
                [';', 'punctuation'],
                ['4', 'number'],
                [')', 'paren']
            ]
        },
        // Local function overrides reference function
        {
            name: 'local function overrides reference (hypot defined locally)',
            line: 'hypot(3; 4)->',
            context: 'hypot(a; b) = sqrt(a**2 + b**2)',
            options: { referenceFunctions: new Set(['hypot']) },
            assertions: [
                ['hypot', 'function'],  // local, not builtin
                ['(', 'paren'],
                ['3', 'number']
            ]
        },
        // Local variable shadows reference constant
        {
            name: 'local variable shadows reference constant (pi: 3.14)',
            line: 'p: pi + 2',
            context: 'pi: 3.14',
            options: { referenceConstants: new Set(['pi']) },
            assertions: [
                ['p', 'variable-def'],
                [':', 'punctuation'],
                ['pi', 'variable'],  // shadowed, not builtin
                ['+', 'operator'],
                ['2', 'number']
            ]
        },
        // Reference constant output (pi->)
        {
            name: 'reference constant output (pi->)',
            line: 'pi->',
            options: { referenceConstants: new Set(['pi']) },
            assertions: [
                ['pi', 'builtin'],
                ['->', 'punctuation']
            ]
        },
        // Output marker doesn't shadow reference constant (pi-> 3.1416)
        {
            name: 'output marker does not shadow reference (pi-> 3.1416)',
            line: 'pi-> 3.1416',
            options: { referenceConstants: new Set(['pi']) },
            assertions: [
                ['pi', 'builtin'],  // still builtin, -> doesn't define
                ['->', 'punctuation'],
                ['3.1416', 'number']
            ]
        },
        // With shadowConstants=true, output marker DOES shadow reference constant
        {
            name: 'shadowConstants=true: output marker shadows reference (pi->)',
            line: 'pi-> 3.1416',
            options: { referenceConstants: new Set(['pi']), shadowConstants: true },
            assertions: [
                ['pi', 'variable-def'],  // shadowed because shadowConstants is on
                ['->', 'punctuation'],
                ['3.1416', 'number']
            ]
        },
        // With shadowConstants=true, reference constant in expression (not a marker) stays builtin
        {
            name: 'shadowConstants=true: reference constant in expression stays builtin',
            line: 'x: pi + 1',
            options: { referenceConstants: new Set(['pi']), shadowConstants: true },
            assertions: [
                ['x', 'variable-def'],
                [':', 'punctuation'],
                ['pi', 'builtin'],  // no marker, so still builtin
                ['+', 'operator'],
                ['1', 'number']
            ]
        },
        // Reference constants are case-sensitive (G and c are constants, g and C are not)
        {
            name: 'wrong-case constant is variable-def, not builtin (g->>)',
            line: 'g->>',
            options: { referenceConstants: new Set(['G', 'c']) },
            assertions: [
                ['g', 'variable-def'],  // g != G, not a constant
                ['->>', 'punctuation']
            ]
        },
        {
            name: 'correct-case constant is builtin (G->> 0.000000000066743)',
            line: 'G->> 0.000000000066743',
            options: { referenceConstants: new Set(['G', 'c']) },
            assertions: [
                ['G', 'builtin'],
                ['->>', 'punctuation'],
                ['0.000000000066743', 'number']
            ]
        },
        {
            name: 'correct-case constant is builtin (c->> 299,792,458)',
            line: 'c->> 299,792,458',
            options: { referenceConstants: new Set(['G', 'c']) },
            assertions: [
                ['c', 'builtin'],
                ['->>', 'punctuation'],
                ['299,792,458', 'number']
            ]
        },
        {
            name: 'wrong-case constant is variable-def, not builtin (C->>)',
            line: 'C->>',
            options: { referenceConstants: new Set(['G', 'c']) },
            assertions: [
                ['C', 'variable-def'],  // C != c, not a constant
                ['->>', 'punctuation']
            ]
        },
        // Constant shadowing is position-aware (matches top-to-bottom evaluator)
        // c is a constant used before c-> shadows it, so c is still builtin on the a: c line
        {
            name: 'constant is builtin before shadow line (a: c before c->)',
            line: 'a: c',
            context: '',
            options: { referenceConstants: new Set(['c']), shadowConstants: true },
            assertions: [
                ['a', 'variable-def'],
                [':', 'punctuation'],
                ['c', 'builtin']  // not yet shadowed
            ]
        },
        {
            name: 'constant is variable-def on shadow line (c-> after a: c)',
            line: 'c->',
            context: 'a: c',
            options: { referenceConstants: new Set(['c']), shadowConstants: true },
            assertions: [
                ['c', 'variable-def']  // shadowed here
            ]
        },
        // Comparison operator with output marker
        {
            name: 'comparison operator with output marker (relE < relT-> 1)',
            line: 'relE < relT-> 1',
            context: 'relE: 0\nrelT: 7',
            assertions: [
                ['relE', 'variable'],
                ['<', 'operator'],
                ['relT', 'variable'],
                ['->', 'punctuation'],
                ['1', 'number']
            ]
        },
        // Function call with comparison and output marker
        {
            name: 'function call with comparison and output marker (abs(1) < jsEPSILON-> 1)',
            line: 'abs(1) < jsEPSILON-> 1',
            context: 'jsEPSILON: 7',
            assertions: [
                ['abs', 'builtin'],
                ['(', 'paren'],
                ['1', 'number'],
                [')', 'paren'],
                ['<', 'operator'],
                ['jsEPSILON', 'variable'],
                ['->', 'punctuation'],
                ['1', 'number']
            ]
        },
        // Unary minus after ** with full precision output
        {
            name: 'unary minus after ** with full precision output (0.5*10**-places->> 0.00005)',
            line: '0.5*10**-places->> 0.00005',
            context: 'places: 4',
            assertions: [
                ['0.5', 'number'],
                ['*', 'operator'],
                ['10', 'number'],
                ['**', 'operator'],
                ['-', 'operator'],
                ['places', 'variable'],
                ['->>', 'punctuation'],
                ['0.00005', 'number']
            ]
        },
        // Line comment tests
        {
            name: 'full line // comment',
            line: '// this is a comment',
            assertions: [
                ['// this is a comment', 'comment']
            ]
        },
        {
            name: 'variable declaration with // comment (x: 5 // input)',
            line: 'x: 5 // input value',
            assertions: [
                ['x', 'variable-def'],
                [':', 'punctuation'],
                ['5', 'number'],
                ['// input value', 'comment']
            ]
        },
        {
            name: 'expression output with // comment (a + b-> // sum)',
            line: 'a + b-> // sum',
            assertions: [
                ['a', 'variable'],
                ['+', 'operator'],
                ['b', 'variable'],
                ['->', 'punctuation'],
                ['// sum', 'comment']
            ]
        },
        {
            name: '// inside quoted string is NOT a line comment',
            line: '"quoted // not a line comment"',
            assertions: [
                ['"quoted // not a line comment"', 'comment']
            ]
        },
        {
            name: 'plain text before // comment is label (ccc // why blue?)',
            line: 'ccc // why blue?',
            assertions: [
                ['ccc', 'comment'],
                ['// why blue?', 'comment']
            ]
        },
        {
            name: 'plain text before quoted comment is label (ccc "test")',
            line: 'ccc "test"',
            assertions: [
                ['ccc', 'comment'],
                ['"test"', 'comment']
            ]
        },
        // Inline eval with money format suffix
        // Base format output value (4D#16 should be number, not comment)
        {
            name: 'base format output value (a#16-> 4D#16)',
            line: 'a#16-> 4D#16',
            context: 'a: 77',
            assertions: [
                ['a', 'variable-def'],
                ['#', 'variable-def'],
                ['16', 'variable-def'],
                ['->', 'punctuation'],
                ['4D#16', 'number']
            ]
        },
        // Inline eval with money format suffix
        {
            name: 'inline eval with money suffix (b = \\a$\\)',
            line: 'b = \\a$\\',
            context: 'a$: $10.994',
            assertions: [
                ['b', 'variable'],
                ['=', 'operator'],
                ['\\', 'inline-marker'],
                ['a', 'variable'],
                ['$', 'variable'],
            ]
        },
        {
            name: 'inline eval with percent suffix (b = \\a%\\)',
            line: 'b = \\a%\\',
            context: 'a%: 10%',
            assertions: [
                ['b', 'variable'],
                ['=', 'operator'],
                ['\\', 'inline-marker'],
                ['a', 'variable'],
                ['%', 'variable'],
            ]
        },
        // Inline eval with formatter then money literal expression
        {
            name: 'inline eval formatter then money literal (\\x$\\+$.01->)',
            line: '\\x$\\+$.01->',
            context: 'x$: $10',
            assertions: [
                ['\\', 'inline-marker'],
                ['x', 'variable'],
                ['$', 'variable'],
                ['\\', 'inline-marker'],
                ['+', 'operator'],
                ['$.01', 'number'],
                ['->', 'punctuation']
            ]
        },
        // Money literal expression output
        {
            name: 'money literal expression output ($99.99+$.01->)',
            line: '$99.99+$.01->',
            assertions: [
                ['$99.99', 'number'],
                ['+', 'operator'],
                ['$.01', 'number'],
                ['->', 'punctuation']
            ]
        },
        // Base literal expression output (both operands are base literals)
        {
            name: 'base literal expression output (f#16+f#32->)',
            line: 'f#16+f#32->',
            assertions: [
                ['f#16', 'number'],
                ['+', 'operator'],
                ['f#32', 'number'],
                ['->', 'punctuation']
            ]
        },
        // Formatter suffix in expression context is an error
        {
            name: 'money suffix in equation is error (y = x$)',
            line: 'y = x$',
            assertions: [
                ['y', 'variable'],
                ['=', 'operator'],
                ['x', 'variable'],
                ['$', 'error']
            ]
        },
        // Reference constant with base format output
        {
            name: 'reference constant with base-16 output (c#16-> 11DE784A#16)',
            line: 'c#16-> 11DE784A#16',
            options: { referenceConstants: new Set(['c']) },
            assertions: [
                ['c', 'builtin'],
                ['#', 'builtin'],
                ['16', 'builtin'],
                ['->', 'punctuation'],
                ['11DE784A#16', 'number']
            ]
        },
        {
            name: 'money suffix on declaration value is error (z: x$)',
            line: 'z: x$',
            context: 'x: 5',
            assertions: [
                ['z', 'variable-def'],
                [':', 'punctuation'],
                ['x', 'variable'],
                ['$', 'error']
            ]
        },
        {
            name: 'percent suffix in expression is error (q: x%)',
            line: 'q: x%',
            context: 'x: 5',
            assertions: [
                ['q', 'variable-def'],
                [':', 'punctuation'],
                ['x', 'variable'],
                ['%', 'error']
            ]
        }
    ];

    console.log(`Running ${tests.length} highlighting test(s)...\n`);

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        const result = runTest(test.name, test.line, test.assertions, test.context || '', test.options || {});
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
