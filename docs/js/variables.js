/**
 * MathPad Variables - Variable declaration handling and text manipulation
 */

/**
 * Clear behavior for variable declarations
 * Determines when a variable's value is cleared
 */
const ClearBehavior = {
    NONE: 'none',       // : or :: (persistent, never cleared)
    ON_CLEAR: 'onClear', // <- (cleared by Clear button)
    ON_SOLVE: 'onSolve'  // -> or ->> (cleared by Clear button AND before solving)
};

/**
 * Legacy VarType enum - kept for backwards compatibility
 * Maps to ClearBehavior:
 *   STANDARD -> ClearBehavior.NONE
 *   INPUT -> ClearBehavior.ON_CLEAR
 *   OUTPUT -> ClearBehavior.ON_SOLVE
 *   FULL_PRECISION -> depends on marker (:: -> NONE, ->> -> ON_SOLVE)
 */
const VarType = {
    STANDARD: 'standard',      // varname:
    INPUT: 'input',            // varname<-
    OUTPUT: 'output',          // varname-> or varname->>
    FULL_PRECISION: 'full'     // varname:: or varname->>
};

/**
 * Extract base variable name and format from a name that may have $ or % suffix
 * e.g., "pmt$" -> { baseName: "pmt", format: "money" }
 *       "rate%" -> { baseName: "rate", format: "percent" }
 *       "x" -> { baseName: "x", format: null }
 */
function parseVarNameAndFormat(nameWithSuffix) {
    if (nameWithSuffix.endsWith('$')) {
        return { baseName: nameWithSuffix.slice(0, -1), format: 'money' };
    }
    if (nameWithSuffix.endsWith('%')) {
        return { baseName: nameWithSuffix.slice(0, -1), format: 'percent' };
    }
    return { baseName: nameWithSuffix, format: null };
}

/**
 * Parse a single line to extract variable declaration
 * Returns declaration info or null if not a variable declaration
 */
function parseVariableLine(line) {
    // Remove comments (text in double quotes) and trim leading/trailing whitespace
    const cleanLine = line.replace(/"[^"]*"/g, '').trim();

    // Variable declaration patterns (order matters - check more specific patterns first)
    // Note: \w+[$%]? allows optional $ or % suffix for money/percentage variables
    // The suffix is stripped from the name and stored in format
    const patterns = [
        // With search limits: var[low:high]: value
        {
            regex: /^(\w+[$%]?)\s*\[\s*([^\]]+)\s*:\s*([^\]]+)\s*\]\s*:\s*(.*)$/,
            handler: (m) => {
                const { baseName, format } = parseVarNameAndFormat(m[1]);
                return {
                    name: baseName,
                    type: VarType.STANDARD,
                    clearBehavior: ClearBehavior.NONE,
                    limits: { lowExpr: m[2].trim(), highExpr: m[3].trim() },
                    valueText: m[4].trim(),
                    base: 10,
                    fullPrecision: false,
                    marker: ':',
                    format
                };
            }
        },
        // Input variable: var<-
        {
            regex: /^(\w+[$%]?)\s*<-\s*(.*)$/,
            handler: (m) => {
                const { baseName, format } = parseVarNameAndFormat(m[1]);
                return {
                    name: baseName,
                    type: VarType.INPUT,
                    clearBehavior: ClearBehavior.ON_CLEAR,
                    valueText: m[2].trim(),
                    base: 10,
                    fullPrecision: false,
                    marker: '<-',
                    format
                };
            }
        },
        // Full precision output: var->>
        {
            regex: /^(\w+[$%]?)\s*->>\s*(.*)$/,
            handler: (m) => {
                const { baseName, format } = parseVarNameAndFormat(m[1]);
                return {
                    name: baseName,
                    type: VarType.OUTPUT,
                    clearBehavior: ClearBehavior.ON_SOLVE,
                    valueText: m[2].trim(),
                    base: 10,
                    fullPrecision: true,
                    marker: '->>',
                    format
                };
            }
        },
        // Output variable: var->
        {
            regex: /^(\w+[$%]?)\s*->\s*(.*)$/,
            handler: (m) => {
                const { baseName, format } = parseVarNameAndFormat(m[1]);
                return {
                    name: baseName,
                    type: VarType.OUTPUT,
                    clearBehavior: ClearBehavior.ON_SOLVE,
                    valueText: m[2].trim(),
                    base: 10,
                    fullPrecision: false,
                    marker: '->',
                    format
                };
            }
        },
        // Full precision: var::
        {
            regex: /^(\w+[$%]?)\s*::\s*(.*)$/,
            handler: (m) => {
                const { baseName, format } = parseVarNameAndFormat(m[1]);
                return {
                    name: baseName,
                    type: VarType.STANDARD,
                    clearBehavior: ClearBehavior.NONE,
                    valueText: m[2].trim(),
                    base: 10,
                    fullPrecision: true,
                    marker: '::',
                    format
                };
            }
        },
        // Integer base: var#base:
        {
            regex: /^(\w+[$%]?)\s*#\s*(\d+)\s*:\s*(.*)$/,
            handler: (m) => {
                const { baseName, format } = parseVarNameAndFormat(m[1]);
                return {
                    name: baseName,
                    type: VarType.STANDARD,
                    clearBehavior: ClearBehavior.NONE,
                    valueText: m[3].trim(),
                    base: parseInt(m[2]),
                    fullPrecision: false,
                    marker: `#${m[2]}:`,
                    format
                };
            }
        },
        // Standard: var:
        {
            regex: /^(\w+[$%]?)\s*:\s*(.*)$/,
            handler: (m) => {
                const { baseName, format } = parseVarNameAndFormat(m[1]);
                return {
                    name: baseName,
                    type: VarType.STANDARD,
                    clearBehavior: ClearBehavior.NONE,
                    valueText: m[2].trim(),
                    base: 10,
                    fullPrecision: false,
                    marker: ':',
                    format
                };
            }
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
 * Find all variable names in an AST expression
 * Used to detect if an expression is a constant (no variables)
 */
function findVariablesInExpression(node) {
    const vars = new Set();

    function walk(n) {
        if (!n) return;
        switch (n.type) {
            case 'VARIABLE':
                vars.add(n.name);
                break;
            case 'BINARY_OP':
                walk(n.left);
                walk(n.right);
                break;
            case 'UNARY_OP':
                walk(n.operand);
                break;
            case 'FUNCTION_CALL':
                n.args.forEach(walk);
                break;
        }
    }

    walk(node);
    return vars;
}

/**
 * Parse all variable declarations from text
 * Returns map of variable name -> { declaration, lineIndex, value }
 */
function parseAllVariables(text) {
    const lines = text.split('\n');
    const declarations = [];

    for (let i = 0; i < lines.length; i++) {
        const decl = parseVariableLine(lines[i]);
        if (decl) {
            // Parse numeric literals only (no expression evaluation)
            // Expressions stay as valueText for display
            let value = null;
            if (decl.valueText) {
                value = parseNumericValue(decl.valueText, decl.format);
            }

            declarations.push({
                name: decl.name,
                declaration: decl,
                lineIndex: i,
                value: value,
                valueText: decl.valueText
            });
        }
    }

    return declarations;
}

/**
 * Parse a numeric value from text (handles $, %, hex, etc.)
 * Returns null if the text is an expression (not a simple numeric literal)
 * @param {string} valueText - The text to parse
 * @param {string} varFormat - 'money', 'percent', or null
 */
function parseNumericValue(valueText, varFormat = null) {
    let textToParse = valueText;

    // Handle money format: $1,234.56 or -$1,234.56
    const moneyMatch = textToParse.match(/^(-?)\$(.+)$/);
    if (moneyMatch) {
        textToParse = moneyMatch[1] + moneyMatch[2];
    }

    // Handle percentage format: 7.5% becomes 0.075 (divide by 100)
    // Also treat as percent if variable format is percent
    let isPercent = varFormat === 'percent';
    const percentMatch = textToParse.match(/^(.+)%$/);
    if (percentMatch) {
        textToParse = percentMatch[1];
        isPercent = true;
    }

    // Remove commas (digit grouping)
    textToParse = textToParse.replace(/,/g, '');

    let value = null;

    // Check if value is a simple number
    const numMatch = textToParse.match(/^-?\d+\.?\d*(?:[eE][+-]?\d+)?$/);
    if (numMatch) {
        value = parseFloat(textToParse);
    } else if (textToParse.match(/^0x[0-9a-fA-F]+$/)) {
        value = parseInt(textToParse, 16);
    } else if (textToParse.match(/^0b[01]+$/)) {
        value = parseInt(textToParse.slice(2), 2);
    } else if (textToParse.match(/^0o[0-7]+$/)) {
        value = parseInt(textToParse.slice(2), 8);
    }
    // If not a numeric literal, return null (it's an expression)

    // Convert percentage display value to decimal (7.5% -> 0.075)
    if (isPercent && value !== null) {
        value = value / 100;
    }

    return value;
}

/**
 * Format a variable value for display
 * Handles full precision $/% formatting
 * @param {number} value - The numeric value
 * @param {string} varFormat - 'money', 'percent', or null
 * @param {boolean} fullPrecision - Whether to use full precision (for ->> and ::)
 * @param {object} format - Format options: { places, stripZeros, numberFormat, base, groupDigits }
 * @returns {string} Formatted value string
 */
function formatVariableValue(value, varFormat, fullPrecision, format = {}) {
    const places = fullPrecision ? 15 : (format.places ?? 4);
    const stripZeros = format.stripZeros !== false;
    const numberFormat = format.numberFormat || 'float';
    const base = format.base || 10;
    const groupDigits = format.groupDigits || false;

    // Handle money format
    if (varFormat === 'money') {
        const absValue = Math.abs(value);
        if (fullPrecision) {
            const formatted = formatNumber(absValue, places, stripZeros, numberFormat, 10, groupDigits, null);
            return value < 0 ? '-$' + formatted : '$' + formatted;
        } else {
            // Use 2 decimal places for money by default
            const formatted = absValue.toFixed(2);
            const parts = formatted.split('.');
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
            const result = parts.join('.');
            return value < 0 ? '-$' + result : '$' + result;
        }
    }

    // Handle percent format
    if (varFormat === 'percent') {
        const percent = value * 100;
        if (fullPrecision) {
            const formatted = formatNumber(percent, places, stripZeros, numberFormat, 10, false, null);
            return formatted + '%';
        } else {
            // Use 2 decimal places for percent, strip trailing zeros
            const formatted = percent.toFixed(2).replace(/\.?0+$/, '');
            return formatted + '%';
        }
    }

    // Regular number formatting
    return formatNumber(value, places, stripZeros, numberFormat, base, groupDigits, null);
}

/**
 * Insert or update a variable value in text
 * Fills ALL empty declarations of the variable
 * Returns the modified text
 */
function setVariableValue(text, varName, value, format = {}) {
    const lines = text.split('\n');
    let modified = false;

    // Format defaults
    const regularPlaces = format.places ?? 2;
    const stripZeros = format.stripZeros ?? true;
    const groupDigits = format.groupDigits ?? false;
    const numberFormat = format.format ?? 'float';

    // Process each line looking for declarations of this variable
    for (let i = 0; i < lines.length; i++) {
        const decl = parseVariableLine(lines[i]);
        if (!decl || decl.name !== varName) continue;

        // Skip if already has a value
        if (decl.valueText) continue;

        const line = lines[i];
        const formattedValue = formatVariableValue(value, decl.format, decl.fullPrecision, {
            places: regularPlaces,
            stripZeros,
            numberFormat,
            base: decl.base,
            groupDigits
        });

        // Find the position to insert the value (after the marker)
        const cleanLine = line.replace(/"[^"]*"/g, match => ' '.repeat(match.length));

        // Find where the value should go (after the declaration marker)
        let markerIndex;
        if (decl.limits) {
            // Find the closing bracket of limits and then the colon
            const bracketMatch = cleanLine.match(/\w+[$%]?\s*\[[^\]]+\]\s*:/);
            if (bracketMatch) {
                markerIndex = bracketMatch.index + bracketMatch[0].length;
            }
        } else {
            // Find the marker (escape varName since it may contain $ or %)
            const markerMatch = cleanLine.match(new RegExp(`${escapeRegex(varName)}\\s*(${escapeRegex(decl.marker)})`));
            if (markerMatch) {
                markerIndex = markerMatch.index + markerMatch[0].length;
            }
        }

        if (markerIndex === undefined) continue;

        // Preserve any trailing comment
        const afterMarker = line.substring(markerIndex);
        const commentMatch = afterMarker.match(/"[^"]*"$/);
        const comment = commentMatch ? commentMatch[0] : '';

        // Build the new line
        const beforeValue = line.substring(0, markerIndex);
        lines[i] = beforeValue + ' ' + formattedValue + (comment ? ' ' + comment : '');
        modified = true;
    }

    return modified ? lines.join('\n') : text;
}

/**
 * Clear variable values based on type
 * Clears ALL matching declarations, not just one per variable
 * clearType: 'input' clears input variables (<-) and output variables (-> and ->>)
 *            'output' clears output variables only (-> and ->>)
 *            'all' clears all variables
 */
function clearVariables(text, clearType = 'input') {
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const decl = parseVariableLine(lines[i]);
        if (!decl) continue;

        // Use ClearBehavior for logic, with VarType fallback for compatibility
        const clearBehavior = decl.clearBehavior || (
            decl.type === VarType.INPUT ? ClearBehavior.ON_CLEAR :
            decl.type === VarType.OUTPUT ? ClearBehavior.ON_SOLVE :
            ClearBehavior.NONE
        );

        const shouldClear =
            clearType === 'all' ||
            (clearType === 'input' && (clearBehavior === ClearBehavior.ON_CLEAR || clearBehavior === ClearBehavior.ON_SOLVE)) ||
            (clearType === 'output' && clearBehavior === ClearBehavior.ON_SOLVE);

        if (shouldClear && decl.valueText) {
            const line = lines[i];
            const cleanLine = line.replace(/"[^"]*"/g, match => ' '.repeat(match.length));

            // Find the marker and clear everything after it (preserving comments)
            let markerIndex;
            if (decl.limits) {
                const bracketMatch = cleanLine.match(/\w+[$%]?\s*\[[^\]]+\]\s*:/);
                if (bracketMatch) {
                    markerIndex = bracketMatch.index + bracketMatch[0].length;
                }
            } else {
                // Escape decl.name since it may contain $ or %
                const markerMatch = cleanLine.match(new RegExp(`${escapeRegex(decl.name)}\\s*(${escapeRegex(decl.marker)})`));
                if (markerMatch) {
                    markerIndex = markerMatch.index + markerMatch[0].length;
                }
            }

            if (markerIndex !== undefined) {
                const afterMarker = line.substring(markerIndex);
                const commentMatch = afterMarker.match(/"[^"]*"$/);
                const comment = commentMatch ? commentMatch[0] : '';

                const beforeValue = line.substring(0, markerIndex);
                lines[i] = beforeValue + (comment ? ' ' + comment : '');
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
 * Create an EvalContext with constants and user functions loaded
 * @param {Array} records - Array of all records (to find Constants and Functions records)
 * @param {Object} settings - Settings object with degreesMode
 * @param {string} localText - Optional text of current record for local function definitions
 * @returns {EvalContext} Configured evaluation context
 */
function createEvalContext(records, settings, localText = null) {
    const context = new EvalContext();
    context.degreesMode = settings?.degreesMode || false;

    // Load constants from Constants record
    const constantsRecord = records.find(r => r.title === 'Constants');
    if (constantsRecord) {
        const constants = parseConstantsRecord(constantsRecord.text);
        for (const [name, value] of constants) {
            context.setConstant(name, value);
        }
    }

    // Load user functions from Functions record
    const functionsRecord = records.find(r => r.title === 'Functions');
    if (functionsRecord) {
        const functions = parseFunctionsRecord(functionsRecord.text);
        for (const [name, { params, bodyText }] of functions) {
            try {
                const bodyAST = parseExpression(bodyText);
                context.setUserFunction(name, params, bodyAST);
            } catch (e) {
                console.warn(`Error parsing function ${name}:`, e);
            }
        }
    }

    // Also load functions defined in the current record (overrides Functions record)
    if (localText) {
        const localFunctions = parseFunctionsRecord(localText);
        for (const [name, { params, bodyText }] of localFunctions) {
            try {
                const bodyAST = parseExpression(bodyText);
                context.setUserFunction(name, params, bodyAST);
            } catch (e) {
                console.warn(`Error parsing local function ${name}:`, e);
            }
        }
    }

    return context;
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
        VarType, ClearBehavior, parseVariableLine, parseAllVariables,
        setVariableValue, clearVariables, findEquations,
        findInlineEvaluations, replaceInlineEvaluation,
        parseConstantsRecord, parseFunctionsRecord, createEvalContext
    };
}
