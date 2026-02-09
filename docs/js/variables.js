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
 * Extract base variable name, format, and numeric base from a name that may have suffixes
 * e.g., "pmt$" -> { baseName: "pmt", format: "money", base: 10 }
 *       "rate%" -> { baseName: "rate", format: "percent", base: 10 }
 *       "hex#16" -> { baseName: "hex", format: null, base: 16 }
 *       "x" -> { baseName: "x", format: null, base: 10 }
 */
function parseVarNameAndFormat(nameWithSuffix) {
    // Check for #base suffix: var#16
    const baseMatch = nameWithSuffix.match(/^(\w+)#(\d+)$/);
    if (baseMatch) {
        return { baseName: baseMatch[1], format: null, base: parseInt(baseMatch[2]) };
    }
    // Check for $ suffix
    if (nameWithSuffix.endsWith('$')) {
        return { baseName: nameWithSuffix.slice(0, -1), format: 'money', base: 10 };
    }
    // Check for % suffix
    if (nameWithSuffix.endsWith('%')) {
        return { baseName: nameWithSuffix.slice(0, -1), format: 'percent', base: 10 };
    }
    return { baseName: nameWithSuffix, format: null, base: 10 };
}

/**
 * Replace the value portion of a variable declaration line
 * @param {string} line - The line of text
 * @param {string} varName - Variable name (without $ or % suffix)
 * @param {string} marker - The declaration marker (: <- -> ->> ::)
 * @param {boolean} hasLimits - Whether the declaration has limits [low:high]
 * @param {string} newValue - The new value to insert (empty string to clear)
 * @returns {string|null} The modified line, or null if marker not found
 */
/**
 * Build an output line by replacing the value after the marker
 * Used by both variable outputs and expression outputs
 * @param {string} line - The original line
 * @param {number} markerEndIndex - Position after the marker (where value starts)
 * @param {string} newValue - The new value to insert (or empty to clear)
 * @param {object} commentInfo - { comment, commentUnquoted } or null
 * @returns {string} The rebuilt line
 */
function buildOutputLine(line, markerEndIndex, newValue, commentInfo = null) {
    // Extract // line comment from original line and re-append at end
    const { stripped, lineComment } = stripComments(line);
    const lineCommentSuffix = lineComment ? ' ' + lineComment.trimEnd() : '';
    line = lineComment ? stripped.trimEnd() : line;

    // Determine trailing comment/unit text
    let trailingPart = '';
    if (commentInfo && commentInfo.comment) {
        // Use provided comment info from parsing
        if (commentInfo.commentUnquoted) {
            trailingPart = ' ' + commentInfo.comment;
        } else {
            trailingPart = ' "' + commentInfo.comment + '"';
        }
    } else {
        // Fall back to extracting quoted comment from line (for backwards compatibility)
        const afterMarker = line.substring(markerEndIndex);
        const quotedCommentMatch = afterMarker.match(/"[^"]*"\s*$/);
        if (quotedCommentMatch) {
            trailingPart = ' ' + quotedCommentMatch[0].trim();
        }
    }

    const beforeValue = line.substring(0, markerEndIndex);
    const valuePart = newValue ? ' ' + newValue : '';

    return beforeValue + valuePart + trailingPart + lineCommentSuffix;
}

function replaceValueOnLine(line, varName, marker, hasLimits, newValue, commentInfo = null) {
    const { clean: cleanLine } = stripComments(line);

    let markerIndex;
    if (hasLimits) {
        // Match variable with limits and any marker type (longer markers first)
        const bracketMatch = cleanLine.match(new RegExp(`\\w+(?:[$%]|#\\d+)?\\s*\\[[^\\]]+\\]\\s*${escapeRegex(marker)}`));
        if (bracketMatch) {
            markerIndex = bracketMatch.index + bracketMatch[0].length;
        }
    } else {
        // varName doesn't include $, %, or #base suffix, but text may have it
        const markerMatch = cleanLine.match(new RegExp(`${escapeRegex(varName)}(?:[$%]|#\\d+)?\\s*(${escapeRegex(marker)})`));
        if (markerMatch) {
            markerIndex = markerMatch.index + markerMatch[0].length;
        }
    }

    if (markerIndex === undefined) return null;

    return buildOutputLine(line, markerIndex, newValue, commentInfo);
}

/**
 * Extract numeric value and trailing unit text from output value
 * For output variables, trailing text like "mm Hg" is treated as a unit comment
 * @param {string} rhs - The right-hand side text after the marker
 * @returns {{ valueText: string, unitComment: string|null }}
 */
function extractValueAndUnit(rhs) {
    return splitValueAndComment(rhs);
}

/**
 * Parse a line with a marker (:, ::, ->, ->>, <-)
 * Returns { kind: 'declaration' | 'expression-output', ... } or null
 *
 * Unified model:
 * - <-: always declaration (input variable, requires single variable LHS)
 * - :, :: with single variable LHS: declaration
 * - ->, ->> with single variable LHS: output variable declaration
 * - :, ::, ->, ->> with expression LHS: expression output
 *
 * This function delegates to the grammar-based LineParser in line-parser.js.
 * The LineParser uses tokenization for more reliable parsing than regex.
 */
function parseMarkedLine(line) {
    // Use the grammar-based parser from line-parser.js
    const parser = new LineParser(line);
    return parser.parse();
}

/**
 * Parse a single line to extract variable declaration
 * Returns declaration info or null if not a variable declaration
 * (Wrapper around parseMarkedLine for backwards compatibility)
 */
function parseVariableLine(line) {
    const result = parseMarkedLine(line);
    if (result && result.kind === 'declaration') {
        // Remove 'kind' field for backwards compatibility
        const { kind, ...declaration } = result;
        return declaration;
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
 * Parse all variable declarations from text (simple parse, no evaluation)
 * Returns array of { name, declaration, lineIndex, value, valueText }
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
                try {
                    const ast = parseExpression(decl.valueText);
                    if (ast && ast.type === NodeType.NUMBER) {
                        value = ast.value;
                    }
                } catch (e) {
                    // Not a simple literal - leave for solve phase
                }
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
 * Discover variables with inline expression evaluation
 * Processes text line by line, evaluating \expr\ and parsing declarations
 * @param {string} text - The formula text
 * @param {EvalContext} context - Context with constants and functions loaded
 * @param {object} record - Record settings for formatting
 * @returns {{ text: string, declarations: Array, errors: Array }}
 */
function discoverVariables(text, context, record) {
    const lines = text.split('\n');
    const declarations = [];
    const errors = [];
    const definedVars = new Set();

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Evaluate any \expr\ in this line
        const inlineRegex = /\\([^\\]+)\\/g;
        let match;
        let lineModified = false;

        // Process inline expressions from right to left to preserve positions
        const inlineMatches = [];
        while ((match = inlineRegex.exec(line)) !== null) {
            inlineMatches.push({
                fullMatch: match[0],
                expression: match[1].trim(),
                start: match.index,
                end: match.index + match[0].length
            });
        }

        // Filter out inline matches inside // or "..." comments
        const { stripped, lineComment } = stripComments(line);
        const filteredMatches = inlineMatches.filter(m => {
            if (lineComment && m.start >= stripped.length) return false;
            let inQuote = false;
            for (let k = 0; k < m.start; k++) {
                if (line[k] === '"') inQuote = !inQuote;
            }
            return !inQuote;
        });

        for (let j = filteredMatches.length - 1; j >= 0; j--) {
            const evalInfo = filteredMatches[j];
            try {
                // Strip format suffix ($, %, or #base) before parsing - it's used for output formatting only
                let exprToParse = evalInfo.expression;
                if (exprToParse.endsWith('$') || exprToParse.endsWith('%')) {
                    exprToParse = exprToParse.slice(0, -1);
                } else {
                    // Strip #base suffix only for identifier#digits (e.g., \a#16\)
                    // Don't strip for digit-start literals (e.g., \4D#16\ = 77)
                    const baseMatch = exprToParse.match(/^([a-zA-Z_]\w*)#(\d+)$/);
                    if (baseMatch) {
                        exprToParse = baseMatch[1];
                    }
                }
                const ast = parseExpression(exprToParse);
                const value = evaluate(ast, context);
                const format = getInlineEvalFormat(evalInfo.expression, record, null);
                const formatted = formatVariableValue(value, format.varFormat, false, format);
                line = line.substring(0, evalInfo.start) + formatted + line.substring(evalInfo.end);
                lineModified = true;
            } catch (e) {
                errors.push(`Line ${i + 1}: Cannot evaluate \\${evalInfo.expression}\\ - ${e.message}`);
            }
        }

        if (lineModified) {
            lines[i] = line;
        }

        // Parse variable declaration from this line
        const decl = parseVariableLine(line);
        if (decl) {
            const name = decl.name;
            const isOutput = decl.clearBehavior === ClearBehavior.ON_SOLVE || decl.type === VarType.OUTPUT;

            // Check if shadowing a constant
            if (context.constants.has(name)) {
                if (record.shadowConstants) {
                    // Shadow the constant
                    context.shadowConstant(name);
                } else if (!isOutput) {
                    // Input declarations conflict with constants (unless shadowConstants enabled)
                    // Shadow the constant and report error, but continue processing so value is used
                    context.shadowConstant(name);
                    errors.push(`Line ${i + 1}: Variable "${name}" conflicts with a constant`);
                }
                // Output declarations can output constant values without conflict
            }

            // Check for duplicate input declarations
            if (!isOutput) {
                if (definedVars.has(name)) {
                    errors.push(`Line ${i + 1}: Variable "${name}" is already defined`);
                    continue;
                }
                if (context.variables.has(name)) {
                    errors.push(`Line ${i + 1}: Variable "${name}" is already defined`);
                    continue;
                }
                definedVars.add(name);
            }

            // Track that this variable is declared (even if no value yet)
            context.declareVariable(name);

            // Evaluate the value if present
            let value = null;
            let valueText = decl.valueText;

            if (valueText && !isOutput) {
                try {
                    const ast = parseExpression(valueText);
                    value = evaluate(ast, context);
                } catch (e) {
                    errors.push(`Line ${i + 1}: Cannot evaluate "${valueText}" - ${e.message}`);
                }

                // Add to context for subsequent lines
                if (value !== null) {
                    context.setVariable(name, value);
                }
            }

            declarations.push({
                name: name,
                declaration: decl,
                lineIndex: i,
                value: value,
                valueText: valueText
            });
        }
    }

    return {
        text: lines.join('\n'),
        declarations: declarations,
        errors: errors
    };
}

/**
 * Get format settings for an inline evaluation expression
 * Looks up variable's format property for $ (money) and % (percentage) formatting
 */
function getInlineEvalFormat(expression, record, variables = null) {
    const trimmed = expression.trim();
    let varFormat = null;

    // Check if expression ends with format suffix ($, %, or #base)
    let baseName = trimmed;
    let base = 10;
    if (trimmed.endsWith('$')) {
        baseName = trimmed.slice(0, -1);
        varFormat = 'money';
    } else if (trimmed.endsWith('%')) {
        baseName = trimmed.slice(0, -1);
        varFormat = 'percent';
    } else {
        // Check for #base suffix on identifier (e.g., a#16)
        const baseMatch = trimmed.match(/^([a-zA-Z_]\w*)#(\d+)$/);
        if (baseMatch) {
            baseName = baseMatch[1];
            base = parseInt(baseMatch[2]);
        }
    }

    // If expression is a simple variable name, look up its format from the variables map
    if (variables && /^[a-zA-Z_]\w*$/.test(baseName)) {
        const varInfo = variables.get(baseName);
        if (varInfo && varInfo.declaration && varInfo.declaration.format) {
            // Variable has a format property - use it (overrides suffix if present)
            varFormat = varInfo.declaration.format;
        }
    }

    return {
        places: record.places != null ? record.places : 4,
        stripZeros: record.stripZeros !== false,
        groupDigits: record.groupDigits || false,
        numberFormat: record.format || 'float',
        varFormat: varFormat,
        base: base
    };
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
    const places = fullPrecision ? 15 : (format.places != null ? format.places : 4);
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
    const regularPlaces = format.places != null ? format.places : 2;
    const stripZeros = format.stripZeros != null ? format.stripZeros : true;
    const groupDigits = format.groupDigits != null ? format.groupDigits : false;
    const numberFormat = format.format != null ? format.format : 'float';

    // Process each line looking for declarations of this variable
    for (let i = 0; i < lines.length; i++) {
        const decl = parseVariableLine(lines[i]);
        if (!decl || decl.name !== varName) continue;

        // Skip if already has a value
        if (decl.valueText) continue;

        const formattedValue = formatVariableValue(value, decl.format, decl.fullPrecision, {
            places: regularPlaces,
            stripZeros,
            numberFormat,
            base: decl.base,
            groupDigits
        });

        const commentInfo = { comment: decl.comment, commentUnquoted: decl.commentUnquoted };
        const newLine = replaceValueOnLine(lines[i], varName, decl.marker, !!decl.limits, formattedValue, commentInfo);
        if (newLine !== null) {
            lines[i] = newLine;
            modified = true;
        }
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
            const commentInfo = { comment: decl.comment, commentUnquoted: decl.commentUnquoted };
            const newLine = replaceValueOnLine(lines[i], decl.name, decl.marker, !!decl.limits, '', commentInfo);
            if (newLine !== null) {
                lines[i] = newLine;
            }
        }
    }

    let result = lines.join('\n');

    // Also clear expression outputs (expr-> and expr->>) when clearing output or input types
    if (clearType === 'output' || clearType === 'input' || clearType === 'all') {
        result = clearExpressionOutputs(result);
    }

    return result;
}

/**
 * Find expression outputs in text: expr:, expr::, expr->, expr->>
 * These are expressions (not simple variable names) followed by output markers
 * Returns array of { text, marker, startLine, fullPrecision, recalculates, existingValue }
 * (Wrapper around parseMarkedLine for backwards compatibility)
 */
function findExpressionOutputs(text) {
    const lines = text.split('\n');
    const outputs = [];

    for (let i = 0; i < lines.length; i++) {
        const result = parseMarkedLine(lines[i]);
        if (result && result.kind === 'expression-output') {
            outputs.push({
                text: result.expression,
                marker: result.marker,
                startLine: i,
                fullPrecision: result.fullPrecision,
                recalculates: result.recalculates,
                existingValue: result.valueText,
                comment: result.comment,
                commentUnquoted: result.commentUnquoted
            });
        }
    }

    return outputs;
}

/**
 * Clear expression output values for recalculating outputs (-> and ->>)
 */
function clearExpressionOutputs(text) {
    const lines = text.split('\n');
    const outputs = findExpressionOutputs(text);

    for (const output of outputs) {
        if (output.recalculates && output.existingValue) {
            // Clear the value portion for -> and ->> outputs
            const line = lines[output.startLine];

            // Strip // line comment before processing, re-append later
            const { clean: cleanLine, stripped: lineNoLC, lineComment } = stripComments(line);
            const lineCommentSuffix = lineComment ? ' ' + lineComment.trimEnd() : '';

            // Find the marker position and clear everything after it (except comments)
            const markerIdx = cleanLine.lastIndexOf(output.marker);
            if (markerIdx !== -1) {
                const beforeMarker = lineNoLC.substring(0, markerIdx + output.marker.length);
                // Use parsed comment info
                let trailingText = '';
                if (output.comment) {
                    if (output.commentUnquoted) {
                        trailingText = ' ' + output.comment;
                    } else {
                        trailingText = ' "' + output.comment + '"';
                    }
                }
                lines[output.startLine] = beforeMarker + trailingText + lineCommentSuffix;
            }
        }
    }

    return lines.join('\n');
}

/**
 * Try to extract a valid equation from a line that may have label text before/after.
 * For example: "equation c = a + b test" -> "c = a + b"
 * Returns the extracted equation text, or the original if it parses fine or can't be fixed.
 */
function extractEquationFromLine(lineText) {
    // Handle braced equations: { expr = expr }
    // The braces are part of the equation syntax, not label text
    const trimmed = lineText.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        // Extract content inside braces, process it, then add braces back
        const innerContent = trimmed.slice(1, -1).trim();
        const innerExtracted = extractEquationFromLineInner(innerContent);
        // Find original brace positions to preserve whitespace
        const openBrace = lineText.indexOf('{');
        const closeBrace = lineText.lastIndexOf('}');
        return lineText.slice(0, openBrace + 1) + ' ' + innerExtracted + ' ' + lineText.slice(closeBrace);
    }

    return extractEquationFromLineInner(lineText);
}

function extractEquationFromLineInner(lineText) {
    // First, check if the line parses correctly as-is
    const eqMatch = lineText.match(/^(.+?)=(.+)$/);
    if (!eqMatch) return lineText;

    const leftText = eqMatch[1].trim();
    const rightText = eqMatch[2].trim();

    // Try parsing both sides
    let leftOk = false, rightOk = false;
    try {
        parseExpression(leftText);
        leftOk = true;
    } catch (e) {}
    try {
        parseExpression(rightText);
        rightOk = true;
    } catch (e) {}

    // If both sides parse, no extraction needed
    if (leftOk && rightOk) return lineText;

    // Try to extract the actual equation
    // For LHS: find the last identifier (possibly with function call) before =
    // For RHS: find where the valid expression ends
    let extractedLeft = leftText;
    let extractedRight = rightText;

    if (!leftOk) {
        // Find start of LHS: look for last identifier or function call start
        // Pattern: identifier (possibly with $ or %) followed by optional function call
        const lhsMatch = leftText.match(/([a-zA-Z_][\w$%]*(?:\s*\([^)]*\))?)\s*$/);
        if (lhsMatch) {
            extractedLeft = lhsMatch[1];
        }
    }

    if (!rightOk) {
        // Find end of RHS: try to parse incrementally and find where it breaks
        // Simple approach: look for trailing word that's not part of expression
        const tokens = rightText.split(/\s+/);
        for (let i = tokens.length; i > 0; i--) {
            const candidate = tokens.slice(0, i).join(' ');
            try {
                parseExpression(candidate);
                extractedRight = candidate;
                break;
            } catch (e) {
                // Try shorter
            }
        }
    }

    // Verify the extracted equation parses
    const extracted = extractedLeft + ' = ' + extractedRight;
    try {
        const finalMatch = extracted.match(/^(.+?)=(.+)$/);
        if (finalMatch) {
            parseExpression(finalMatch[1].trim());
            parseExpression(finalMatch[2].trim());
            return extracted;
        }
    } catch (e) {}

    // Couldn't extract a valid equation, return original
    return lineText;
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
        const { clean: cleanLine } = stripComments(line);

        // Handle braced equations (state machine for multi-line braces)
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

        // Check for regular equation line using parseMarkedLine
        // If parseMarkedLine returns a result, it's a declaration or expression-output, not an equation
        const markedResult = parseMarkedLine(line);
        if (markedResult) {
            // Line is a declaration or expression output - skip
            continue;
        }

        // Check for equation: line with = that's not a comparison operator
        const eqIdx = cleanLine.indexOf('=');
        if (eqIdx !== -1) {
            // Check it's not a comparison operator (==, !=, <=, >=)
            const prevChar = eqIdx > 0 ? cleanLine[eqIdx - 1] : '';
            const nextChar = eqIdx < cleanLine.length - 1 ? cleanLine[eqIdx + 1] : '';

            if (prevChar !== '=' && prevChar !== '!' && prevChar !== '<' && prevChar !== '>' &&
                nextChar !== '=') {
                // Extract the equation, handling lines with label text before/after
                const eqText = extractEquationFromLine(cleanLine.trim());
                equations.push({
                    text: eqText,
                    startLine: i,
                    endLine: i,
                    isBraced: false,
                    startCol: 0,
                    endCol: line.length
                });
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
                constants.set(decl.name, { value, comment: decl.comment });
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

    // Helper to extract function definition from text
    function extractFunction(content, sourceText) {
        // Normalize whitespace (multi-line braces may have newlines)
        content = content.replace(/\s+/g, ' ').trim();
        // Pattern: funcname(arg1;arg2;...) = expression
        const match = content.match(/(\w+)\s*\(\s*([^)]*)\s*\)\s*=\s*(.+)$/);
        if (match) {
            const name = match[1].toLowerCase();
            const paramsText = match[2].trim();
            const bodyText = match[3].trim();

            // Don't redefine an existing function - that's an equation, not a definition
            // e.g., if f(x) = x**2 exists, then f(z) = 0 is an equation to solve
            if (functions.has(name)) return;

            const params = paramsText ?
                paramsText.split(';').map(p => p.trim()) : [];

            functions.set(name, { params, bodyText, sourceText });
        }
    }

    let inBrace = false;
    let braceContent = [];
    let braceSourceLines = [];

    for (const line of lines) {
        // Remove comments for parsing
        const { stripped } = stripComments(line);
        const cleanLine = stripped.replace(/"[^"]*"/g, '').trim();

        if (inBrace) {
            const closeIdx = cleanLine.indexOf('}');
            if (closeIdx !== -1) {
                braceContent.push(cleanLine.substring(0, closeIdx));
                braceSourceLines.push(line);
                extractFunction(braceContent.join(' '), braceSourceLines.join('\n').trim());
                inBrace = false;
                braceContent = [];
                braceSourceLines = [];
            } else {
                braceContent.push(cleanLine);
                braceSourceLines.push(line);
            }
            continue;
        }

        if (!cleanLine) continue;

        const openIdx = cleanLine.indexOf('{');
        if (openIdx !== -1) {
            const afterBrace = cleanLine.substring(openIdx + 1);
            const closeIdx = afterBrace.indexOf('}');
            if (closeIdx !== -1) {
                // Single-line braced content
                extractFunction(afterBrace.substring(0, closeIdx).trim(), line.trim());
            } else {
                // Multi-line brace starts
                inBrace = true;
                braceContent = [afterBrace];
                braceSourceLines = [line];
            }
        } else {
            // Try matching function definition at start of line
            extractFunction(cleanLine, line.trim());
        }
    }

    return functions;
}

/**
 * Create an EvalContext with constants and user functions loaded
 * @param {Array} records - Array of all records (to find Constants and Functions records)
 * @param {Object} record - Current record (uses record.degreesMode)
 * @param {string} localText - Optional text of current record for local function definitions
 * @returns {EvalContext} Configured evaluation context
 */
function createEvalContext(records, record, localText = null) {
    const context = new EvalContext();
    context.degreesMode = (record && record.degreesMode) || false;

    // Load constants from Constants record
    const constantsRecord = records.find(r => isReferenceRecord(r, 'Constants'));
    if (constantsRecord) {
        const constants = parseConstantsRecord(constantsRecord.text);
        for (const [name, { value, comment }] of constants) {
            context.setConstant(name, value, comment);
        }
    }

    // Load user functions from Functions record
    const functionsRecord = records.find(r => isReferenceRecord(r, 'Functions'));
    if (functionsRecord) {
        const functions = parseFunctionsRecord(functionsRecord.text);
        for (const [name, { params, bodyText, sourceText }] of functions) {
            try {
                const bodyAST = parseExpression(bodyText);
                context.setUserFunction(name, params, bodyAST, sourceText);
            } catch (e) {
                console.warn(`Error parsing function ${name}:`, e);
            }
        }
    }

    // Also load functions defined in the current record (overrides Functions record)
    // These are local functions, not from the Functions record, so don't track them
    if (localText) {
        // Strip any existing references section before parsing local functions
        // This prevents function definitions in the references section from being treated as local
        const strippedText = localText.replace(/\n*"--- Reference Constants and Functions ---"[\s\S]*$/, '');
        const localFunctions = parseFunctionsRecord(strippedText);
        for (const [name, { params, bodyText, sourceText }] of localFunctions) {
            try {
                const bodyAST = parseExpression(bodyText);
                // Pass null for sourceText to indicate local function (shouldn't be shown in references)
                context.setUserFunction(name, params, bodyAST, null);
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
        VarType, ClearBehavior,
        parseVarNameAndFormat, parseMarkedLine, parseVariableLine, parseAllVariables,
        discoverVariables, getInlineEvalFormat, formatVariableValue,
        buildOutputLine, setVariableValue, clearVariables, findEquations,
        findExpressionOutputs, clearExpressionOutputs,
        findInlineEvaluations, replaceInlineEvaluation,
        parseConstantsRecord, parseFunctionsRecord, createEvalContext,
        extractEquationFromLine
    };
}
