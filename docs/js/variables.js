/**
 * MathPad Variables - Variable declaration handling and text manipulation
 */

/**
 * Variable declaration types
 */
const VarType = {
    STANDARD: 'standard',      // varname:
    INPUT: 'input',            // varname<-
    OUTPUT: 'output',          // varname-> or varname->>
    FULL_PRECISION: 'full'     // varname:: or varname->>
};

/**
 * Parse a single line to extract variable declaration
 * Returns declaration info or null if not a variable declaration
 */
function parseVariableLine(line) {
    // Remove comments (text in double quotes) and trim leading/trailing whitespace
    const cleanLine = line.replace(/"[^"]*"/g, '').trim();

    // Variable declaration patterns (order matters - check more specific patterns first)
    const patterns = [
        // With search limits: var[low:high]: value
        {
            regex: /^(\w+)\s*\[\s*([^\]]+)\s*:\s*([^\]]+)\s*\]\s*:\s*(.*)$/,
            handler: (m) => ({
                name: m[1],
                type: VarType.STANDARD,
                limits: { lowExpr: m[2].trim(), highExpr: m[3].trim() },
                valueText: m[4].trim(),
                base: 10,
                confirm: false,
                fullPrecision: false,
                marker: ':'
            })
        },
        // Input variable: var<-
        {
            regex: /^(\w+)\s*<-\s*(.*)$/,
            handler: (m) => ({
                name: m[1],
                type: VarType.INPUT,
                valueText: m[2].trim(),
                base: 10,
                confirm: false,
                fullPrecision: false,
                marker: '<-'
            })
        },
        // Full precision output: var->>
        {
            regex: /^(\w+)\s*->>\s*(.*)$/,
            handler: (m) => ({
                name: m[1],
                type: VarType.OUTPUT,
                valueText: m[2].trim(),
                base: 10,
                confirm: false,
                fullPrecision: true,
                marker: '->>'
            })
        },
        // Output variable: var->
        {
            regex: /^(\w+)\s*->\s*(.*)$/,
            handler: (m) => ({
                name: m[1],
                type: VarType.OUTPUT,
                valueText: m[2].trim(),
                base: 10,
                confirm: false,
                fullPrecision: false,
                marker: '->'
            })
        },
        // Full precision: var::
        {
            regex: /^(\w+)\s*::\s*(.*)$/,
            handler: (m) => ({
                name: m[1],
                type: VarType.STANDARD,
                valueText: m[2].trim(),
                base: 10,
                confirm: false,
                fullPrecision: true,
                marker: '::'
            })
        },
        // Confirmation: var?:
        {
            regex: /^(\w+)\s*\?\s*:\s*(.*)$/,
            handler: (m) => ({
                name: m[1],
                type: VarType.STANDARD,
                valueText: m[2].trim(),
                base: 10,
                confirm: true,
                fullPrecision: false,
                marker: '?:'
            })
        },
        // Integer base: var#base:
        {
            regex: /^(\w+)\s*#\s*(\d+)\s*:\s*(.*)$/,
            handler: (m) => ({
                name: m[1],
                type: VarType.STANDARD,
                valueText: m[3].trim(),
                base: parseInt(m[2]),
                confirm: false,
                fullPrecision: false,
                marker: `#${m[2]}:`
            })
        },
        // Standard: var:
        {
            regex: /^(\w+)\s*:\s*(.*)$/,
            handler: (m) => ({
                name: m[1],
                type: VarType.STANDARD,
                valueText: m[2].trim(),
                base: 10,
                confirm: false,
                fullPrecision: false,
                marker: ':'
            })
        }
    ];

    for (const pattern of patterns) {
        const match = cleanLine.match(pattern.regex);
        if (match) {
            return pattern.handler(match);
        }
    }

    return null;
}

/**
 * Parse all variable declarations from text
 * Returns map of variable name -> { declaration, lineIndex, value }
 */
function parseAllVariables(text) {
    const lines = text.split('\n');
    const variables = new Map();

    for (let i = 0; i < lines.length; i++) {
        const decl = parseVariableLine(lines[i]);
        if (decl) {
            // Try to parse the value
            let value = null;
            if (decl.valueText) {
                // Check if value is a simple number
                const numMatch = decl.valueText.match(/^-?[\d.]+(?:[eE][+-]?\d+)?$/);
                if (numMatch) {
                    value = parseFloat(decl.valueText);
                } else if (decl.valueText.match(/^0x[0-9a-fA-F]+$/)) {
                    value = parseInt(decl.valueText, 16);
                } else if (decl.valueText.match(/^0b[01]+$/)) {
                    value = parseInt(decl.valueText.slice(2), 2);
                } else if (decl.valueText.match(/^0o[0-7]+$/)) {
                    value = parseInt(decl.valueText.slice(2), 8);
                }
            }

            variables.set(decl.name, {
                declaration: decl,
                lineIndex: i,
                value: value
            });
        }
    }

    return variables;
}

/**
 * Insert or update a variable value in text
 * Returns the modified text
 */
function setVariableValue(text, varName, value, format = {}) {
    const lines = text.split('\n');
    const variables = parseAllVariables(text);

    if (!variables.has(varName)) {
        return text; // Variable not found
    }

    const varInfo = variables.get(varName);
    const decl = varInfo.declaration;
    const lineIndex = varInfo.lineIndex;
    const line = lines[lineIndex];

    // Format the value
    const places = format.places ?? 14;
    const stripZeros = format.stripZeros ?? true;
    const groupDigits = format.groupDigits ?? false;
    const numberFormat = format.format ?? 'float';
    const formattedValue = formatNumber(value, places, stripZeros, numberFormat, decl.base, groupDigits);

    // Find the position to insert the value (after the marker)
    const cleanLine = line.replace(/"[^"]*"/g, match => ' '.repeat(match.length));

    // Find where the value should go (after the declaration marker)
    let markerIndex;
    if (decl.limits) {
        // Find the closing bracket of limits and then the colon
        const bracketMatch = cleanLine.match(/\w+\s*\[[^\]]+\]\s*:/);
        if (bracketMatch) {
            markerIndex = bracketMatch.index + bracketMatch[0].length;
        }
    } else {
        // Find the marker
        const markerMatch = cleanLine.match(new RegExp(`${varName}\\s*(${escapeRegex(decl.marker)})`));
        if (markerMatch) {
            markerIndex = markerMatch.index + markerMatch[0].length;
        }
    }

    if (markerIndex === undefined) {
        return text;
    }

    // Preserve any trailing comment
    const afterMarker = line.substring(markerIndex);
    const commentMatch = afterMarker.match(/"[^"]*"$/);
    const comment = commentMatch ? commentMatch[0] : '';

    // Build the new line
    const beforeValue = line.substring(0, markerIndex);
    const newLine = beforeValue + ' ' + formattedValue + (comment ? ' ' + comment : '');

    lines[lineIndex] = newLine;
    return lines.join('\n');
}

/**
 * Clear variable values based on type
 * clearType: 'input' clears input variables (<-)
 *            'output' clears output variables (-> and ->>)
 *            'all' clears all variables
 */
function clearVariables(text, clearType = 'input') {
    const lines = text.split('\n');
    const variables = parseAllVariables(text);

    for (const [name, varInfo] of variables) {
        const decl = varInfo.declaration;
        const shouldClear =
            clearType === 'all' ||
            (clearType === 'input' && decl.type === VarType.INPUT) ||
            (clearType === 'output' && decl.type === VarType.OUTPUT);

        if (shouldClear && varInfo.value !== null) {
            const line = lines[varInfo.lineIndex];
            const cleanLine = line.replace(/"[^"]*"/g, match => ' '.repeat(match.length));

            // Find the marker and clear everything after it (preserving comments)
            let markerIndex;
            if (decl.limits) {
                const bracketMatch = cleanLine.match(/\w+\s*\[[^\]]+\]\s*:/);
                if (bracketMatch) {
                    markerIndex = bracketMatch.index + bracketMatch[0].length;
                }
            } else {
                const markerMatch = cleanLine.match(new RegExp(`${name}\\s*(${escapeRegex(decl.marker)})`));
                if (markerMatch) {
                    markerIndex = markerMatch.index + markerMatch[0].length;
                }
            }

            if (markerIndex !== undefined) {
                const afterMarker = line.substring(markerIndex);
                const commentMatch = afterMarker.match(/"[^"]*"$/);
                const comment = commentMatch ? commentMatch[0] : '';

                const beforeValue = line.substring(0, markerIndex);
                lines[varInfo.lineIndex] = beforeValue + (comment ? ' ' + comment : '');
            }
        }
    }

    return lines.join('\n');
}

/**
 * Find equations in text (lines or blocks with = that are not variable declarations)
 */
function findEquations(text) {
    const lines = text.split('\n');
    const equations = [];
    let inBrace = false;
    let braceStart = -1;
    let braceContent = [];
    let braceStartCol = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const cleanLine = line.replace(/"[^"]*"/g, ' '); // Replace comments with spaces

        // Handle braced equations
        const braceOpenIdx = cleanLine.indexOf('{');
        if (braceOpenIdx !== -1 && !inBrace) {
            inBrace = true;
            braceStart = i;
            braceStartCol = braceOpenIdx;
            braceContent = [];

            const afterBrace = cleanLine.substring(braceOpenIdx + 1);
            const braceCloseIdx = afterBrace.indexOf('}');

            if (braceCloseIdx !== -1) {
                // Single-line braced equation
                equations.push({
                    text: afterBrace.substring(0, braceCloseIdx).trim(),
                    startLine: i,
                    endLine: i,
                    isBraced: true,
                    startCol: braceOpenIdx,
                    endCol: braceOpenIdx + 1 + braceCloseIdx + 1
                });
                inBrace = false;
            } else {
                braceContent.push(afterBrace);
            }
            continue;
        }

        if (inBrace) {
            const braceCloseIdx = cleanLine.indexOf('}');
            if (braceCloseIdx !== -1) {
                braceContent.push(cleanLine.substring(0, braceCloseIdx));
                equations.push({
                    text: braceContent.join(' ').trim(),
                    startLine: braceStart,
                    endLine: i,
                    isBraced: true,
                    startCol: braceStartCol,
                    endCol: braceCloseIdx + 1
                });
                inBrace = false;
            } else {
                braceContent.push(cleanLine);
            }
            continue;
        }

        // Check for regular equation line
        // It's an equation if:
        // 1. Contains = (but not ==, !=, <=, >=)
        // 2. Not a variable declaration (no : before the =, and no <- or ->)
        const eqIdx = cleanLine.indexOf('=');
        if (eqIdx !== -1) {
            // Check it's not a comparison operator
            const prevChar = eqIdx > 0 ? cleanLine[eqIdx - 1] : '';
            const nextChar = eqIdx < cleanLine.length - 1 ? cleanLine[eqIdx + 1] : '';

            if (prevChar !== '=' && prevChar !== '!' && prevChar !== '<' && prevChar !== '>' &&
                nextChar !== '=') {
                // Check it's not a variable declaration
                const colonIdx = cleanLine.indexOf(':');
                const arrowInIdx = cleanLine.indexOf('<-');
                const arrowOutIdx = cleanLine.indexOf('->');

                // It's an equation if = comes before any declaration marker
                if ((colonIdx === -1 || eqIdx < colonIdx) &&
                    (arrowInIdx === -1 || eqIdx < arrowInIdx) &&
                    (arrowOutIdx === -1 || eqIdx < arrowOutIdx)) {
                    equations.push({
                        text: cleanLine.trim(),
                        startLine: i,
                        endLine: i,
                        isBraced: false,
                        startCol: 0,
                        endCol: line.length
                    });
                }
            }
        }
    }

    return equations;
}

/**
 * Find inline evaluations: \ expression \
 */
function findInlineEvaluations(text) {
    const results = [];
    const regex = /\\([^\\]+)\\/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        // Calculate line and column
        const before = text.substring(0, match.index);
        const lines = before.split('\n');
        const line = lines.length - 1;
        const col = lines[lines.length - 1].length;

        results.push({
            fullMatch: match[0],
            expression: match[1].trim(),
            start: match.index,
            end: match.index + match[0].length,
            line: line,
            col: col
        });
    }

    return results;
}

/**
 * Replace inline evaluation with result
 */
function replaceInlineEvaluation(text, evalInfo, result) {
    const formattedResult = typeof result === 'number' ?
        formatNumber(result, 14, true, 'float', 10) : String(result);

    return text.substring(0, evalInfo.start) +
           '\\' + formattedResult + '\\' +
           text.substring(evalInfo.end);
}

/**
 * Parse the Constants record
 * Returns a map of constant name -> value
 */
function parseConstantsRecord(text) {
    const constants = new Map();
    const lines = text.split('\n');

    for (const line of lines) {
        const decl = parseVariableLine(line);
        if (decl && decl.valueText) {
            const value = parseFloat(decl.valueText);
            if (!isNaN(value)) {
                constants.set(decl.name, value);
            }
        }
    }

    return constants;
}

/**
 * Parse the Functions record
 * Returns a map of function name -> { params: [], bodyText: string }
 */
function parseFunctionsRecord(text) {
    const functions = new Map();
    const lines = text.split('\n');

    for (const line of lines) {
        // Remove comments
        const cleanLine = line.replace(/"[^"]*"/g, '').trim();
        if (!cleanLine) continue;

        // Pattern: funcname(arg1;arg2;...) = expression
        const match = cleanLine.match(/^(\w+)\s*\(\s*([^)]*)\s*\)\s*=\s*(.+)$/);
        if (match) {
            const name = match[1].toLowerCase();
            const paramsText = match[2].trim();
            const bodyText = match[3].trim();

            const params = paramsText ?
                paramsText.split(';').map(p => p.trim()) : [];

            functions.set(name, { params, bodyText });
        }
    }

    return functions;
}

/**
 * Helper: escape special regex characters
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Reference to formatNumber from evaluator.js (will be available globally)
// This is declared here for reference, actual function is in evaluator.js

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        VarType, parseVariableLine, parseAllVariables,
        setVariableValue, clearVariables, findEquations,
        findInlineEvaluations, replaceInlineEvaluation,
        parseConstantsRecord, parseFunctionsRecord
    };
}
