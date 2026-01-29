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
 * Expand literal notations to decimal values in text
 * Handles: $num (money), num% (percent), 0x/0b/0o (base prefix), value#base (base suffix)
 * @param {string} text - Text to expand
 * @returns {string} Text with literals expanded to decimal
 */
function expandLiterals(text) {
    // Expand 0x, 0b, 0o prefix notation
    text = text.replace(/\b0x([0-9a-fA-F]+)\b/g, (_, v) => parseInt(v, 16));
    text = text.replace(/\b0b([01]+)\b/g, (_, v) => parseInt(v, 2));
    text = text.replace(/\b0o([0-7]+)\b/g, (_, v) => parseInt(v, 8));
    // Expand value#base suffix notation (e.g., ff#16 -> 255, 101#2 -> 5)
    text = text.replace(/\b([0-9a-zA-Z]+)#(\d+)\b/g, (m, v, b) => {
        const base = parseInt(b);
        if (base < 2 || base > 36) {
            throw new Error(`Invalid base in "${m}" - base must be between 2 and 36`);
        }
        const parsed = parseInt(v, base);
        if (isNaN(parsed)) {
            throw new Error(`Invalid constant "${m}" - "${v}" is not valid in base ${base}`);
        }
        return parsed;
    });
    // Expand $num money literals (e.g., $100 -> 100, $1,000.50 -> 1000.50)
    text = text.replace(/\$([0-9,]+\.?[0-9]*)\b/g, (_, v) => v.replace(/,/g, ''));
    // Expand num% percent literals (e.g., 5% -> 0.05, 7.5% -> 0.075)
    text = text.replace(/\b([0-9]+\.?[0-9]*)%/g, (_, v) => parseFloat(v) / 100);
    return text;
}

/**
 * Expand literals in a single line, handling declarations specially
 * For declarations: only expand in the value portion (after the marker)
 * For equations/expressions: expand entire line
 * @param {string} line - Line to expand
 * @returns {string} Line with literals expanded
 */
function expandLineLiterals(line) {
    // Check if line is a declaration (has marker like :, ::, <-, ->, ->>)
    // Pattern captures: varName (with optional $, %, or #base suffix), marker, value portion
    const declMatch = line.match(/^(\w+(?:[$%]|#\d+)?)\s*(:|::|<-|->|->>) *(.*)$/);
    if (declMatch) {
        // Only expand in value portion (group 3)
        const [, varPart, marker, valuePart] = declMatch;
        const expandedValue = expandLiterals(valuePart);
        // Preserve spacing after marker
        const spacing = valuePart.length > 0 && expandedValue.length > 0 ? ' ' : '';
        return varPart + marker + spacing + expandedValue;
    }
    // Also check for declarations with limits: var[low:high]: value
    const limitsMatch = line.match(/^(\w+[$%]?\s*\[[^\]]+\])\s*:\s*(.*)$/);
    if (limitsMatch) {
        const [, varPart, valuePart] = limitsMatch;
        const expandedValue = expandLiterals(valuePart);
        const spacing = valuePart.length > 0 && expandedValue.length > 0 ? ' ' : '';
        return varPart + ':' + spacing + expandedValue;
    }
    // Not a declaration - expand entire line
    return expandLiterals(line);
}

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
function replaceValueOnLine(line, varName, marker, hasLimits, newValue) {
    const cleanLine = line.replace(/"[^"]*"/g, match => ' '.repeat(match.length));

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

    // Preserve any trailing comment (allow trailing whitespace after comment)
    const afterMarker = line.substring(markerIndex);
    const commentMatch = afterMarker.match(/"[^"]*"\s*$/);
    const comment = commentMatch ? commentMatch[0].trim() : '';

    const beforeValue = line.substring(0, markerIndex);
    const valuePart = newValue ? ' ' + newValue : '';
    const commentPart = comment ? ' ' + comment : '';

    return beforeValue + valuePart + commentPart;
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
 */
function parseMarkedLine(line) {
    // Extract trailing comment (text in double quotes at end of line) before cleaning
    const trailingCommentMatch = line.match(/"([^"]*)"\s*$/);
    const comment = trailingCommentMatch ? trailingCommentMatch[1] : null;

    // Remove comments (text in double quotes) and trim leading/trailing whitespace
    const cleanLine = line.replace(/"[^"]*"/g, '').trim();
    if (!cleanLine) return null;

    // Handle variables with limits specially: var[low:high]<marker> value
    // The colon inside brackets must not be matched as a marker
    // Supports all markers: :, ::, ->, ->>, <-
    const limitsMatch = cleanLine.match(/^(\w+(?:[$%]|#\d+)?)\s*\[\s*([^\]]+)\s*:\s*([^\]]+)\s*\]\s*(->>|->|::|:|<-)\s*(.*)$/);
    if (limitsMatch) {
        const { baseName, format, base } = parseVarNameAndFormat(limitsMatch[1]);
        const limits = { lowExpr: limitsMatch[2].trim(), highExpr: limitsMatch[3].trim() };
        const marker = limitsMatch[4];
        const rhs = limitsMatch[5].trim();

        // Determine type and behavior based on marker
        let type, clearBehavior, fullPrecision;
        if (marker === '->' || marker === '->>') {
            type = VarType.OUTPUT;
            clearBehavior = ClearBehavior.ON_SOLVE;
            fullPrecision = marker === '->>';
        } else if (marker === '<-') {
            type = VarType.INPUT;
            clearBehavior = ClearBehavior.ON_CLEAR;
            fullPrecision = false;
        } else {
            type = VarType.STANDARD;
            clearBehavior = ClearBehavior.NONE;
            fullPrecision = marker === '::';
        }

        return {
            kind: 'declaration',
            name: baseName,
            type,
            clearBehavior,
            limits,
            valueText: rhs,
            base,
            fullPrecision,
            marker,
            format,
            comment
        };
    }

    // Match markers (check longer markers first to avoid partial matches)
    const markerPatterns = [
        { regex: /^(.+?)(->>) *(.*)$/, marker: '->>', fullPrecision: true, recalculates: true },
        { regex: /^(.+?)(->) *(.*)$/, marker: '->', fullPrecision: false, recalculates: true },
        { regex: /^(.+?)(::) *(.*)$/, marker: '::', fullPrecision: true, recalculates: false },
        { regex: /^(.+?)(<-) *(.*)$/, marker: '<-', fullPrecision: false, recalculates: false },
        { regex: /^(.+?)(:) *(.*)$/, marker: ':', fullPrecision: false, recalculates: false }
    ];

    for (const pattern of markerPatterns) {
        const match = cleanLine.match(pattern.regex);
        if (!match) continue;

        const lhs = match[1].trim();
        const marker = pattern.marker;
        const rhs = match[3].trim();

        // Skip if RHS starts with { (braced equation label like "Label: { x = y }")
        if (rhs.startsWith('{')) continue;

        // Check if LHS is a single variable (possibly with label text before it)
        // Single variable: word chars, optionally ending with $, %, or #digits
        // May have optional [limits] for declarations
        // Allow label text before (e.g., "Enter x<-")
        // Match the variable at the END of the LHS (after any label text)
        const varMatch = lhs.match(/\b(\w+(?:[$%]|#\d+)?)(\s*\[\s*([^\]]+)\s*:\s*([^\]]+)\s*\])?$/);
        const hasOperators = /[+\-*\/\(\)\^]/.test(lhs);
        const isSingleVar = varMatch && !hasOperators;

        if (marker === '<-') {
            // Input variable - MUST be single variable
            if (!isSingleVar) return null;

            const { baseName, format, base } = parseVarNameAndFormat(varMatch[1]);
            return {
                kind: 'declaration',
                name: baseName,
                type: VarType.INPUT,
                clearBehavior: ClearBehavior.ON_CLEAR,
                valueText: rhs,
                base,
                fullPrecision: false,
                marker: '<-',
                format,
                comment
            };
        }

        if (isSingleVar) {
            // Declaration (single variable LHS)
            const { baseName, format, base } = parseVarNameAndFormat(varMatch[1]);
            const hasLimits = varMatch[2];
            const limits = hasLimits ? { lowExpr: varMatch[3].trim(), highExpr: varMatch[4].trim() } : null;

            // Determine type based on marker
            let type, clearBehavior;
            if (marker === '->' || marker === '->>') {
                type = VarType.OUTPUT;
                clearBehavior = ClearBehavior.ON_SOLVE;
            } else {
                type = VarType.STANDARD;
                clearBehavior = ClearBehavior.NONE;
            }

            return {
                kind: 'declaration',
                name: baseName,
                type,
                clearBehavior,
                limits,
                valueText: rhs,
                base,
                fullPrecision: pattern.fullPrecision,
                marker,
                format,
                comment
            };
        } else {
            // Expression output (expression LHS)
            // Extract just the expression part if there's label text before it
            // Find the first operator to locate where the expression starts
            const operatorMatch = lhs.match(/[+\-*\/\(\)\^]/);
            let expression = lhs;
            if (operatorMatch) {
                const opIdx = operatorMatch.index;
                // Look back from the operator to find the start of the expression
                // (the identifier or number immediately before the operator)
                const beforeOp = lhs.substring(0, opIdx);
                const tokenMatch = beforeOp.match(/(\w+(?:[$%]|#\d+)?|\d+\.?\d*)\s*$/);
                if (tokenMatch) {
                    const exprStart = beforeOp.length - tokenMatch[0].length;
                    expression = lhs.substring(exprStart).trim();
                }
            }
            return {
                kind: 'expression-output',
                expression: expression,
                marker,
                valueText: rhs,
                fullPrecision: pattern.fullPrecision,
                recalculates: pattern.recalculates,
                comment
            };
        }
    }

    return null;
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
                // Note: We don't expand literals here - this is just for UI display
                // The solve phase will expand and report errors
                value = parseNumericValue(decl.valueText);
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

        for (let j = inlineMatches.length - 1; j >= 0; j--) {
            const evalInfo = inlineMatches[j];
            try {
                // Strip format suffix ($ or %) before parsing - it's used for output formatting only
                let exprToParse = evalInfo.expression;
                if (exprToParse.endsWith('$') || exprToParse.endsWith('%')) {
                    exprToParse = exprToParse.slice(0, -1);
                }
                // Expand literals ($num, num%, 0x, 0b, 0o, value#base) before parsing
                exprToParse = expandLiterals(exprToParse);
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
                    // Shadow the constant (it remains available for output if no computed value)
                    context.shadowConstant(name);
                } else if (!isOutput) {
                    // Input declarations conflict with constants (unless shadowConstants enabled)
                    errors.push(`Line ${i + 1}: Variable "${name}" conflicts with a constant`);
                    continue;
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

            // Evaluate the value if present
            let value = null;
            let valueText = decl.valueText;

            if (valueText && !isOutput) {
                try {
                    // Expand literals ($num, num%, 0x, 0b, 0o, value#base) before parsing
                    const expandedValue = expandLiterals(valueText);

                    // Try to parse as numeric literal first
                    value = parseNumericValue(expandedValue);

                    // If not a numeric literal, try to evaluate as expression
                    if (value === null) {
                        const ast = parseExpression(expandedValue);
                        value = evaluate(ast, context);
                    }
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
 * Parse a numeric value from text
 * Returns null if the text is an expression (not a simple numeric literal)
 * Note: Assumes literals ($num, num%, 0x, 0b, 0o, value#base) have already been
 * expanded by expandLiterals() before calling this function.
 * @param {string} valueText - The text to parse (already expanded)
 */
function parseNumericValue(valueText) {
    // Remove commas (digit grouping)
    const textToParse = valueText.replace(/,/g, '');

    // Check if value is a simple number (decimal, with optional scientific notation)
    const numMatch = textToParse.match(/^-?\d+\.?\d*(?:[eE][+-]?\d+)?$/);
    if (numMatch) {
        return parseFloat(textToParse);
    }

    // Not a numeric literal (it's an expression)
    return null;
}

/**
 * Get format settings for an inline evaluation expression
 * Looks up variable's format property for $ (money) and % (percentage) formatting
 */
function getInlineEvalFormat(expression, record, variables = null) {
    const trimmed = expression.trim();
    let varFormat = null;

    // Check if expression ends with $ or % (format suffix)
    let baseName = trimmed;
    if (trimmed.endsWith('$')) {
        baseName = trimmed.slice(0, -1);
        varFormat = 'money';
    } else if (trimmed.endsWith('%')) {
        baseName = trimmed.slice(0, -1);
        varFormat = 'percent';
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
        places: record.places ?? 4,
        stripZeros: record.stripZeros !== false,
        groupDigits: record.groupDigits || false,
        numberFormat: record.format || 'float',
        varFormat: varFormat
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

        const formattedValue = formatVariableValue(value, decl.format, decl.fullPrecision, {
            places: regularPlaces,
            stripZeros,
            numberFormat,
            base: decl.base,
            groupDigits
        });

        const newLine = replaceValueOnLine(lines[i], varName, decl.marker, !!decl.limits, formattedValue);
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
            const newLine = replaceValueOnLine(lines[i], decl.name, decl.marker, !!decl.limits, '');
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
                existingValue: result.valueText
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
            const cleanLine = line.replace(/"[^"]*"/g, match => ' '.repeat(match.length));

            // Find the marker position and clear everything after it (except comments)
            const markerIdx = cleanLine.lastIndexOf(output.marker);
            if (markerIdx !== -1) {
                const beforeMarker = line.substring(0, markerIdx + output.marker.length);
                // Preserve trailing comment if any
                const afterMarker = line.substring(markerIdx + output.marker.length);
                const commentMatch = afterMarker.match(/"[^"]*"\s*$/);
                const comment = commentMatch ? ' ' + commentMatch[0].trim() : '';
                lines[output.startLine] = beforeMarker + comment;
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
        const cleanLine = line.replace(/"[^"]*"/g, '').trim();

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
    context.degreesMode = record?.degreesMode || false;

    // Load constants from Constants record
    const constantsRecord = records.find(r => r.title === 'Constants');
    if (constantsRecord) {
        const constants = parseConstantsRecord(constantsRecord.text);
        for (const [name, { value, comment }] of constants) {
            context.setConstant(name, value, comment);
        }
    }

    // Load user functions from Functions record
    const functionsRecord = records.find(r => r.title === 'Functions');
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
        VarType, ClearBehavior, expandLiterals, expandLineLiterals,
        parseVarNameAndFormat, parseMarkedLine, parseVariableLine, parseAllVariables,
        discoverVariables, getInlineEvalFormat, formatVariableValue,
        setVariableValue, clearVariables, findEquations,
        findExpressionOutputs, clearExpressionOutputs,
        findInlineEvaluations, replaceInlineEvaluation,
        parseConstantsRecord, parseFunctionsRecord, createEvalContext
    };
}
