/**
 * MathPad Variables - Variable declaration handling and text manipulation
 */

// VarType and ClearBehavior enums are defined in parser.js (loaded first)

/**
 * Get tokens for a given line index from the per-line token arrays.
 * Filters out EOF tokens. Returns empty array for out-of-bounds indices.
 * @param {Token[][]} allTokens - Per-line token arrays from tokenizer
 * @param {number} lineIndex - 0-based line index
 * @returns {Token[]} Tokens for the line
 */
function getLineTokens(allTokens, lineIndex) {
    const line = allTokens[lineIndex];
    if (!line) return [];
    return line.filter(t => t.type !== TokenType.EOF);
}


/** Precompute byte offset of each line start in text */
function computeLineOffsets(text) {
    const offsets = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') offsets.push(i + 1);
    }
    return offsets;
}

/** Convert token (line, col) to 0-based text offset */
function tokenOffset(lineOffsets, token) {
    return lineOffsets[token.line - 1] + token.col - 1;
}

/** Extract a single line's text from original text (no trailing \n) */
function getLineText(text, lineOffsets, lineNum) {
    const start = lineOffsets[lineNum - 1];
    const end = lineNum < lineOffsets.length ? lineOffsets[lineNum] - 1 : text.length;
    return text.substring(start, end);
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
    const lcStart = findLineCommentStart(line);
    const lineComment = lcStart !== -1 ? line.substring(lcStart) : null;
    if (lcStart !== -1) line = line.substring(0, lcStart).trimEnd();

    // Determine trailing comment/unit text
    let trailingPart = '';
    // Column-preserved comments: [{ col, text }]
    const colComments = [];
    if (commentInfo && commentInfo.comment) {
        if (commentInfo.comment.includes('\n')) {
            // Multi-line comment: preserve original line's trailing text (the start
            // of the multi-line comment). Don't reconstruct — continuation lines
            // are still in the text and would be duplicated.
            const afterMarker = line.substring(markerEndIndex);
            const quoteIdx = afterMarker.indexOf('"');
            if (quoteIdx !== -1) {
                trailingPart = ' ' + afterMarker.substring(quoteIdx);
            }
        } else if (commentInfo.commentUnquoted) {
            // Preserve unquoted unit comment at its original column position
            const commentCol = markerEndIndex + line.substring(markerEndIndex).indexOf(commentInfo.comment);
            colComments.push({ col: commentCol, text: commentInfo.comment });
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

    // Preserve // line comment at its original column position
    if (lineComment) {
        colComments.push({ col: lcStart, text: lineComment.trimEnd() });
    }

    const beforeValue = line.substring(0, markerEndIndex);
    const valuePart = newValue ? ' ' + newValue : '';
    let result = beforeValue + valuePart + trailingPart;

    // Append column-preserved comments (unquoted comment, then // line comment)
    for (const cc of colComments) {
        const gap = Math.max(1, cc.col - result.length);
        result += ' '.repeat(gap) + cc.text;
    }

    return result;
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
function parseMarkedLine(line, tokens) {
    // Use the grammar-based parser from line-parser.js
    const parser = tokens
        ? LineParser.fromTokens(tokens)
        : new LineParser(line);
    return parser.parse();
}

/**
 * Parse a single line to extract variable declaration
 * Returns declaration info or null if not a variable declaration
 * (Wrapper around parseMarkedLine for backwards compatibility)
 */
function parseVariableLine(line, tokens) {
    const result = parseMarkedLine(line, tokens);
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
function parseAllVariables(text, allTokens) {
    const lines = text.split('\n');
    const declarations = [];

    for (let i = 0; i < lines.length; i++) {
        const lineTokens = getLineTokens(allTokens, i);

        const decl = parseVariableLine(lines[i], lineTokens);
        if (decl) {
            // Parse numeric literals only (no expression evaluation)
            // Expressions stay as valueTokens for the solve phase
            let value = null;
            if (decl.valueTokens && decl.valueTokens.length > 0) {
                try {
                    const ast = parseTokens(decl.valueTokens);
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
                valueTokens: decl.valueTokens,
                markerEndCol: decl.markerEndCol
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
function discoverVariables(text, context, record, allTokens) {
    const lines = text.split('\n');
    const declarations = [];
    const errors = [];
    const earlyExprOutputs = new Map();
    const definedVars = new Set();

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        const lineTokens = getLineTokens(allTokens, i);

        // Find backslash operator pairs and tokens between them for \expr\ detection
        const backslashIndices = [];
        for (let j = 0; j < lineTokens.length; j++) {
            if (lineTokens[j].type === TokenType.OPERATOR && lineTokens[j].value === '\\') {
                backslashIndices.push(j);
            }
        }

        // Build inline eval matches from pairs (each pair = one \expr\)
        let lineModified = false;
        const inlineMatches = [];
        for (let j = 0; j + 1 < backslashIndices.length; j += 2) {
            const openIdx = backslashIndices[j];
            const closeIdx = backslashIndices[j + 1];
            const openTok = lineTokens[openIdx];
            const closeTok = lineTokens[closeIdx];
            const start = openTok.col - 1;   // 0-based string index of opening \
            const end = closeTok.col;         // 0-based index after closing \
            // Tokens between the backslashes (the expression content)
            const innerTokens = lineTokens.slice(openIdx + 1, closeIdx);
            inlineMatches.push({
                expression: line.substring(start + 1, end - 1).trim(),
                innerTokens,
                start,
                end
            });
        }

        // Process inline expressions from right to left to preserve positions
        for (let j = inlineMatches.length - 1; j >= 0; j--) {
            const evalInfo = inlineMatches[j];
            try {
                // Strip format suffix ($, %, #base) before parsing — for output formatting only.
                // The tokenizer produces FORMATTER($), FORMATTER(%), or FORMATTER(#)+NUMBER
                // at the end of inline evals, just like before declaration markers.
                let exprTokens = evalInfo.innerTokens;
                const lastTok = exprTokens.length > 0 ? exprTokens[exprTokens.length - 1] : null;
                if (lastTok && lastTok.type === TokenType.FORMATTER &&
                    (lastTok.value === '$' || lastTok.value === '%')) {
                    exprTokens = exprTokens.slice(0, -1);
                } else if (exprTokens.length >= 2 && lastTok && lastTok.type === TokenType.NUMBER &&
                           exprTokens[exprTokens.length - 2].type === TokenType.FORMATTER &&
                           exprTokens[exprTokens.length - 2].value === '#') {
                    // #base suffix (e.g., \a#16\) — strip FORMATTER(#) + NUMBER
                    exprTokens = exprTokens.slice(0, -2);
                }
                const ast = parseTokens(exprTokens);
                const value = evaluate(ast, context);
                const format = getInlineEvalFormat(evalInfo.innerTokens, record, null);
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

        // Parse declaration or expression output from this line
        // If line was modified by inline eval, tokens are stale — re-tokenize
        const marked = parseMarkedLine(line, lineModified ? undefined : lineTokens);
        if (marked && marked.kind === 'declaration') {
            const decl = marked;
            const name = decl.name;
            const isOutput = decl.type === VarType.OUTPUT;

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
            const valueTokens = decl.valueTokens;

            if (valueTokens && valueTokens.length > 0 && !isOutput) {
                try {
                    const ast = parseTokens(valueTokens);
                    value = evaluate(ast, context);
                } catch (e) {
                    errors.push(`Line ${i + 1}: Cannot evaluate "${tokensToText(valueTokens).trim()}" - ${e.message}`);
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
                valueTokens: valueTokens,
                markerEndCol: decl.markerEndCol
            });
        } else if (marked && marked.kind === 'expression-output') {
            // Try evaluating expression output top-to-bottom (before later shadows)
            // Skip non-recalculating outputs that already have a value (preserve existing)
            const hasValue = !marked.recalculates && marked.valueTokens && marked.valueTokens.length > 0;
            if (!hasValue) {
                try {
                    const ast = parseTokens(marked.exprTokens);
                    const value = evaluate(ast, context);
                    earlyExprOutputs.set(i, {
                        value,
                        fullPrecision: marked.fullPrecision,
                        marker: marked.marker,
                        format: marked.format,
                        base: marked.base
                    });
                } catch (e) {
                    // Can't evaluate yet — defer to solveEquations (may need solved variables)
                }
            }
        } else {
            // Not a declaration or expression output — check for tokenizer errors
            const hasCodeMarker = lineTokens.some(t =>
                (t.type === TokenType.OPERATOR && t.value === '=') ||
                t.type === TokenType.COLON ||
                t.type === TokenType.DOUBLE_COLON ||
                t.type === TokenType.ARROW_LEFT ||
                t.type === TokenType.ARROW_RIGHT ||
                t.type === TokenType.ARROW_FULL ||
                t.type === TokenType.ARROW_PERSIST ||
                t.type === TokenType.ARROW_PERSIST_FULL
            );
            if (hasCodeMarker) {
                const tokensForCheck = lineModified ? (new Tokenizer(line).tokenize()[0] || []) : lineTokens;
                for (const tok of tokensForCheck) {
                    if (tok.type === TokenType.ERROR) {
                        errors.push(`Line ${i + 1}: ${tok.value}`);
                        break;
                    }
                }
            }
        }
    }

    const newText = lines.join('\n');
    const newTokens = new Tokenizer(newText).tokenize();
    return {
        text: newText,
        declarations: declarations,
        earlyExprOutputs: earlyExprOutputs,
        errors: errors,
        allTokens: newTokens
    };
}

/**
 * Get format settings for an inline evaluation expression
 * Looks up variable's format property for $ (money) and % (percentage) formatting
 */
function getInlineEvalFormat(exprTokens, record, variables = null) {
    let varFormat = null;
    let base = 10;
    let baseName = null;

    // Detect trailing format suffix from tokens: FORMATTER($), FORMATTER(%), or FORMATTER(#)+NUMBER
    const lastTok = exprTokens.length > 0 ? exprTokens[exprTokens.length - 1] : null;
    if (lastTok && lastTok.type === TokenType.FORMATTER && lastTok.value === '$') {
        varFormat = 'money';
    } else if (lastTok && lastTok.type === TokenType.FORMATTER && lastTok.value === '%') {
        varFormat = 'percent';
    } else if (exprTokens.length >= 2 && lastTok && lastTok.type === TokenType.NUMBER &&
               exprTokens[exprTokens.length - 2].type === TokenType.FORMATTER &&
               exprTokens[exprTokens.length - 2].value === '#') {
        base = lastTok.value.value;
    }

    // If expression is a single identifier (possibly with suffix stripped), look up its format
    if (exprTokens.length === 1 && exprTokens[0].type === TokenType.IDENTIFIER) {
        baseName = exprTokens[0].value;
    } else if (exprTokens.length >= 2 && exprTokens[0].type === TokenType.IDENTIFIER &&
               exprTokens[1].type === TokenType.FORMATTER) {
        baseName = exprTokens[0].value;
    }
    if (variables && baseName) {
        const varInfo = variables.get(baseName);
        if (varInfo && varInfo.declaration && varInfo.declaration.format) {
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
            let formatted = formatNumber(absValue, places, stripZeros, numberFormat, 10, groupDigits, null);
            // Ensure at least 2 decimal places for money
            const dot = formatted.indexOf('.');
            if (dot === -1) {
                formatted += '.00';
            } else if (formatted.length - dot - 1 < 2) {
                formatted += '0'.repeat(2 - (formatted.length - dot - 1));
            }
            return value < 0 ? '-$' + formatted : '$' + formatted;
        } else {
            // Use 2 decimal places for money by default
            const formatted = toFixed(absValue, 2);
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
            const formatted = toFixed(percent, 2).replace(/\.?0+$/, '');
            return formatted + '%';
        }
    }

    // Regular number formatting
    return formatNumber(value, places, stripZeros, numberFormat, base, groupDigits, null);
}

/**
 * Clear variable values based on type
 * Clears ALL matching declarations, not just one per variable
 * clearType: 'input' clears input variables (<-) and output variables (-> and ->>)
 *            'output' clears output variables only (-> and ->>)
 *            'all' clears all variables
 */
/**
 * Capture pre-solve values for output variables (before they are cleared).
 * These are available via the ? operator and as fallback in getVariable().
 */
function capturePreSolveValues(text, allTokens) {
    const declarations = parseAllVariables(text, allTokens);
    const preSolveValues = new Map();
    for (const decl of declarations) {
        if (decl.value !== null) {
            const cb = decl.declaration.clearBehavior;
            if (cb === ClearBehavior.ON_SOLVE || cb === ClearBehavior.ON_SOLVE_ONLY) {
                preSolveValues.set(decl.name, decl.value);
            }
        }
    }
    return preSolveValues;
}

function clearVariables(text, clearType = 'input', allTokens) {
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const lineTokens = getLineTokens(allTokens, i);

        const result = parseMarkedLine(lines[i], lineTokens);
        if (!result) continue;

        let shouldClear = false;

        if (result.kind === 'declaration') {
            const clearBehavior = result.clearBehavior;

            shouldClear =
                clearType === 'all' ||
                (clearType === 'input' && (clearBehavior === ClearBehavior.ON_CLEAR || clearBehavior === ClearBehavior.ON_SOLVE)) ||
                (clearType === 'output' && clearBehavior === ClearBehavior.ON_SOLVE) ||
                (clearType === 'solve' && (clearBehavior === ClearBehavior.ON_SOLVE || clearBehavior === ClearBehavior.ON_SOLVE_ONLY));
        } else if (result.kind === 'expression-output' && result.recalculates) {
            // Skip persistent outputs (=> =>>) unless solving
            const isPersistent = result.marker === '=>' || result.marker === '=>>';
            shouldClear = clearType === 'solve' || !isPersistent;
        }

        if (shouldClear && result.valueTokens && result.valueTokens.length > 0) {
            const commentInfo = { comment: result.comment, commentUnquoted: result.commentUnquoted };
            const markerEndIndex = result.markerEndCol - 1;
            lines[i] = buildOutputLine(lines[i], markerEndIndex, '', commentInfo);
        }
    }

    const newText = lines.join('\n');
    const newTokens = new Tokenizer(newText).tokenize();
    return { text: newText, allTokens: newTokens };
}

/**
 * Find equations and expression outputs in a single pass over all lines.
 * This is the core implementation; findEquations() and findExpressionOutputs()
 * are thin wrappers for callers that only need one result.
 * @param {string} text - The formula text
 * @returns {{ equations: Array, exprOutputs: Array }}
 */
function findEquationsAndOutputs(text, allTokens) {
    const lineOffsets = computeLineOffsets(text);
    const maxLine = lineOffsets.length;
    const equations = [];
    const exprOutputs = [];
    let inBrace = false;
    let braceStartTok = null;

    // Process per-line token arrays
    for (let lineIdx = 0; lineIdx < allTokens.length && lineIdx < maxLine; lineIdx++) {
        const lineTokens = allTokens[lineIdx].filter(t => t.type !== TokenType.EOF);
        if (lineTokens.length > 0) processLine(lineIdx + 1, lineTokens);
    }

    return { equations, exprOutputs };

    function processLine(lineNum, lineTokens) {
        // Handle braced equations (state machine for multi-line braces)
        const lbraceTok = lineTokens.find(t => t.type === TokenType.LBRACE);
        const rbraceTok = lineTokens.find(t => t.type === TokenType.RBRACE);

        if (lbraceTok && !inBrace) {
            inBrace = true;
            braceStartTok = lbraceTok;

            if (rbraceTok) {
                // Single-line brace — extract content between { and }
                const content = text.substring(
                    tokenOffset(lineOffsets, lbraceTok) + 1,
                    tokenOffset(lineOffsets, rbraceTok)
                ).trim();
                // Find = token within braces to split sides
                const eqTokInBrace = lineTokens.find(t =>
                    t.type === TokenType.OPERATOR && t.value === '=' &&
                    t.col > lbraceTok.col && t.col < rbraceTok.col
                );
                const braceStart = tokenOffset(lineOffsets, lbraceTok) + 1;
                const braceEnd = tokenOffset(lineOffsets, rbraceTok);
                equations.push({
                    text: content,
                    leftText: eqTokInBrace ? text.substring(braceStart, tokenOffset(lineOffsets, eqTokInBrace)).trim() : null,
                    rightText: eqTokInBrace ? text.substring(tokenOffset(lineOffsets, eqTokInBrace) + 1, braceEnd).trim() : null,
                    startLine: lineNum - 1,   // 0-based for solve-engine.js
                    endLine: lineNum - 1,
                    isBraced: true,
                    startCol: lbraceTok.col - 1,
                    endCol: rbraceTok.col
                });
                inBrace = false;
            }
            // else: multi-line brace start — just record braceStartTok
            return;
        }

        if (inBrace) {
            if (rbraceTok) {
                // Multi-line brace ends — extract ALL content as single substring
                const rawContent = text.substring(
                    tokenOffset(lineOffsets, braceStartTok) + 1,
                    tokenOffset(lineOffsets, rbraceTok)
                );
                const normalizedContent = rawContent.replace(/\s+/g, ' ').trim();
                // Split on = for pre-parsed sides (regex fallback for multi-line)
                const eqMatch = normalizedContent.match(/^(.+?)=(.+)$/);
                equations.push({
                    text: normalizedContent,
                    leftText: eqMatch ? eqMatch[1].trim() : null,
                    rightText: eqMatch ? eqMatch[2].trim() : null,
                    startLine: braceStartTok.line - 1,
                    endLine: lineNum - 1,
                    isBraced: true,
                    startCol: braceStartTok.col - 1,
                    endCol: rbraceTok.col
                });
                inBrace = false;
            }
            return;
        }

        // Parse the line once using parseMarkedLine (reuses pre-tokenized tokens)
        const lineText = getLineText(text, lineOffsets, lineNum);
        const markedResult = parseMarkedLine(lineText, lineTokens);

        if (markedResult && markedResult.kind === 'expression-output') {
            exprOutputs.push({
                exprTokens: markedResult.exprTokens,
                marker: markedResult.marker,
                markerEndCol: markedResult.markerEndCol,
                startLine: lineNum - 1,
                fullPrecision: markedResult.fullPrecision,
                recalculates: markedResult.recalculates,
                valueTokens: markedResult.valueTokens,
                format: markedResult.format,
                base: markedResult.base,
                comment: markedResult.comment,
                commentUnquoted: markedResult.commentUnquoted
            });
            return;
        }

        if (markedResult) {
            // Declaration line - skip
            return;
        }

        // Check for equation using tokens (tokenizer distinguishes = from ==, !=, <=, >=, =>)
        const eqTok = lineTokens.find(t => t.type === TokenType.OPERATOR && t.value === '=');
        if (eqTok) {
            const eqInfo = extractEquationFromLine(lineText, lineTokens, eqTok);
            equations.push({
                text: eqInfo.text,
                leftText: eqInfo.leftText,
                rightText: eqInfo.rightText,
                startLine: lineNum - 1,
                endLine: lineNum - 1,
                isBraced: false,
                startCol: 0,
                endCol: lineText.length
            });
        }
    }
}

/**
 * Find expression outputs in text: expr:, expr::, expr->, expr->>
 * Thin wrapper around findEquationsAndOutputs for callers that only need outputs.
 */
function findExpressionOutputs(text, allTokens) {
    return findEquationsAndOutputs(text, allTokens).exprOutputs;
}

/**
 * Clear expression output values for recalculating outputs
 * @param {string} clearType - 'solve' clears all recalculating outputs; otherwise skips persistent (=> =>>)
 */
function clearExpressionOutputs(text, clearType, allTokens) {
    const lines = text.split('\n');
    const outputs = findExpressionOutputs(text, allTokens);

    for (const output of outputs) {
        // Skip persistent outputs (=> =>>) unless solving
        const isPersistent = output.marker === '=>' || output.marker === '=>>';
        if (output.recalculates && output.valueTokens && output.valueTokens.length > 0 && (clearType === 'solve' || !isPersistent)) {
            const line = lines[output.startLine];
            const markerEndIndex = output.markerEndCol - 1;
            const commentInfo = { comment: output.comment, commentUnquoted: output.commentUnquoted };
            lines[output.startLine] = buildOutputLine(line, markerEndIndex, '', commentInfo);
        }
    }

    return lines.join('\n');
}

/**
 * Try to extract a valid equation from a line that may have label text before/after.
 * For example: "equation c = a + b test" -> "c = a + b"
 * Returns the extracted equation text, or the original if it parses fine or can't be fixed.
 */
function extractEquationFromLine(lineText, lineTokens) {
    let leftText, rightText;

    const eqTok = lineTokens.find(t => t.type === TokenType.OPERATOR && t.value === '=');
    if (!eqTok) return { text: lineText, leftText: null, rightText: null };
    leftText = lineText.substring(0, eqTok.col - 1).trim();
    rightText = lineText.substring(eqTok.col).trim();

    // Try parsing both sides (parseExpression handles comments)
    // parseExpression returns null for empty input, so check for truthy result
    let leftOk = false, rightOk = false;
    try {
        leftOk = !!parseExpression(leftText);
    } catch (e) {}
    try {
        rightOk = !!parseExpression(rightText);
    } catch (e) {}

    // Incomplete equation (expr =) — return leftText for consumer use
    if (leftOk && !rightText) {
        return { text: lineText, leftText, rightText: null };
    }

    // If both sides parse, return equation (preserves original spacing around =)
    if (leftOk && rightOk) {
        const afterEq = lineText.substring(eqTok.col);
        const leadingSpace = afterEq.substring(0, afterEq.length - afterEq.trimStart().length);
        return { text: lineText.substring(0, eqTok.col) + leadingSpace + rightText, leftText, rightText };
    }

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
                if (parseExpression(candidate)) {
                    extractedRight = candidate;
                    break;
                }
            } catch (e) {
                // Try shorter
            }
        }
    }

    // Verify the extracted equation parses
    try {
        const lhs = parseExpression(extractedLeft);
        const rhs = parseExpression(extractedRight);
        if (lhs && rhs) {
            return { text: extractedLeft + ' = ' + extractedRight, leftText: extractedLeft, rightText: extractedRight };
        }
    } catch (e) {}

    // Couldn't extract a clean equation — return original text with raw split sides
    // so consumers can still attempt to parse each side and report specific errors
    return { text: lineText, leftText: leftText || null, rightText: rightText || null };
}

/**
 * Find equations in text (lines or blocks with = that are not variable declarations)
 * Thin wrapper around findEquationsAndOutputs for callers that only need equations.
 */
function findEquations(text, allTokens) {
    return findEquationsAndOutputs(text, allTokens).equations;
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
function parseConstantsRecord(text, allTokens) {
    if (!allTokens) allTokens = new Tokenizer(text).tokenize();
    const constants = new Map();
    const lines = text.split('\n');
    const tempContext = new EvalContext();

    for (let i = 0; i < lines.length; i++) {
        const lineTokens = getLineTokens(allTokens, i);

        const decl = parseVariableLine(lines[i], lineTokens);
        if (decl && decl.valueTokens && decl.valueTokens.length > 0) {
            try {
                const ast = parseTokens(decl.valueTokens);
                const value = evaluate(ast, tempContext);
                if (typeof value === 'number') {
                    constants.set(decl.name, { value, comment: decl.comment });
                    tempContext.setVariable(decl.name, value);
                }
            } catch (e) {
                // Expression couldn't be evaluated (e.g., references unknown variable)
            }
        }
    }

    return constants;
}

/**
 * Parse the Functions record
 * Returns a map of function name -> { params: [], bodyText: string }
 * Walks the token stream directly — no line splitting, no comment stripping.
 */
function parseFunctionsRecord(text, allTokens) {
    if (!allTokens) allTokens = new Tokenizer(text).tokenize();
    const functions = new Map();
    const lineOffsets = computeLineOffsets(text);
    const maxLine = lineOffsets.length;

    // Walk per-line token arrays, tracking brace state across lines
    let inBrace = false;
    let braceTokens = [];      // non-COMMENT tokens inside braces
    let braceStartTok = null;

    for (let lineIdx = 0; lineIdx < allTokens.length; lineIdx++) {
        if (lineIdx + 1 > maxLine) break;

        for (const t of allTokens[lineIdx]) {
            if (t.type === TokenType.EOF || t.type === TokenType.COMMENT) continue;

            if (t.type === TokenType.LBRACE && !inBrace) {
                inBrace = true;
                braceStartTok = t;
                braceTokens = [];
                continue;
            }

            if (inBrace) {
                if (t.type === TokenType.RBRACE) {
                    tryMatchFunction(braceTokens, braceStartTok, t);
                    inBrace = false;
                } else {
                    braceTokens.push(t);
                }
                continue;
            }
        }

        // Non-braced line: collect non-comment tokens and try to match function
        if (!inBrace) {
            const lineTokens = allTokens[lineIdx].filter(t =>
                t.type !== TokenType.EOF && t.type !== TokenType.COMMENT &&
                t.type !== TokenType.LBRACE && t.type !== TokenType.RBRACE
            );
            if (lineTokens.length > 0) {
                tryMatchFunction(lineTokens, null, null);
            }
        }
    }

    return functions;

    function tryMatchFunction(tokens, lbraceTok, rbraceTok) {
        // Pattern: IDENTIFIER LPAREN [params] RPAREN OPERATOR('=') body...
        if (tokens.length < 4) return;
        if (tokens[0].type !== TokenType.IDENTIFIER) return;
        if (tokens[1].type !== TokenType.LPAREN) return;

        // Find RPAREN
        let rparenIdx = -1;
        for (let j = 2; j < tokens.length; j++) {
            if (tokens[j].type === TokenType.RPAREN) { rparenIdx = j; break; }
        }
        if (rparenIdx === -1) return;

        // Next must be OPERATOR('=')
        if (rparenIdx + 1 >= tokens.length) return;
        const eqTok = tokens[rparenIdx + 1];
        if (eqTok.type !== TokenType.OPERATOR || eqTok.value !== '=') return;

        // Must have body tokens after =
        if (rparenIdx + 2 >= tokens.length) return;

        const name = tokens[0].value.toLowerCase();
        if (functions.has(name)) return;  // don't redefine

        // Extract params from tokens between LPAREN and RPAREN
        const params = [];
        for (let j = 2; j < rparenIdx; j++) {
            if (tokens[j].type === TokenType.IDENTIFIER) params.push(tokens[j].value);
        }

        // Body text: from original text, after = to end boundary
        const bodyStart = tokenOffset(lineOffsets, eqTok) + 1;
        let bodyEnd;
        if (rbraceTok) {
            bodyEnd = tokenOffset(lineOffsets, rbraceTok);
        } else {
            // End of line
            const lastTok = tokens[tokens.length - 1];
            bodyEnd = lastTok.line < lineOffsets.length
                ? lineOffsets[lastTok.line] - 1
                : text.length;
        }
        const bodyText = text.substring(bodyStart, bodyEnd).trim();

        // Source text: full line(s) for display in references section
        const startLine = lbraceTok ? lbraceTok.line : tokens[0].line;
        const endLine = rbraceTok ? rbraceTok.line : tokens[tokens.length - 1].line;
        const sourceStart = lineOffsets[startLine - 1];
        const sourceEnd = endLine < lineOffsets.length
            ? lineOffsets[endLine] - 1
            : text.length;
        const sourceText = text.substring(sourceStart, sourceEnd).trim();

        functions.set(name, { params, bodyText, sourceText, startLine, endLine });
    }
}

/**
 * Create an EvalContext with constants and user functions loaded
 * @param {Object} record - Current record (uses record.degreesMode)
 * @param {Map} parsedConstants - Pre-parsed constants from parseConstantsRecord()
 * @param {Map} parsedFunctions - Pre-parsed functions from parseFunctionsRecord()
 * @param {string} localText - Optional text of current record for local function definitions
 * @param {Array} allTokens - Optional pre-tokenized tokens for localText
 * @returns {EvalContext} Configured evaluation context
 */
function createEvalContext(record, parsedConstants, parsedFunctions, localText = null, allTokens = null) {
    const context = new EvalContext();
    context.degreesMode = (record && record.degreesMode) || false;

    // Load constants (callers provide pre-parsed results from getReferenceInfo)
    if (parsedConstants) {
        for (const [name, { value, comment }] of parsedConstants) {
            context.setConstant(name, value, comment);
        }
    }

    // Load user functions (callers provide pre-parsed results from getReferenceInfo)
    if (parsedFunctions) {
        for (const [name, { params, bodyText, sourceText }] of parsedFunctions) {
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
        const localFunctions = parseFunctionsRecord(strippedText, allTokens);
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

// Reference to formatNumber from evaluator.js (will be available globally)
// This is declared here for reference, actual function is in evaluator.js

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        parseVarNameAndFormat, parseMarkedLine, parseVariableLine, parseAllVariables,
        discoverVariables, getInlineEvalFormat, formatVariableValue,
        buildOutputLine, capturePreSolveValues, clearVariables, findEquations,
        findExpressionOutputs, findEquationsAndOutputs, clearExpressionOutputs,
        findInlineEvaluations, replaceInlineEvaluation,
        parseConstantsRecord, parseFunctionsRecord, createEvalContext,
        extractEquationFromLine
    };
}
