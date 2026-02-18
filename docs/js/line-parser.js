/**
 * MathPad Line Parser - Grammar-based recursive descent parser for variable declarations
 *
 * Uses the tokenizer from parser.js to parse individual lines, identifying:
 * - Variable declarations (var:, var<-, var->, var->>, var::)
 * - Expression outputs (expr:, expr->, etc.)
 * - Equations (expr = expr)
 * - Function definitions (f(x) = expr)
 *
 * This replaces the regex-based parsing in variables.js with a cleaner grammar-based approach.
 */

/**
 * Line classification types
 */
const LineType = {
    DECLARATION: 'declaration',           // varName: value
    EXPRESSION_OUTPUT: 'expression-output', // expr-> value
    EQUATION: 'equation',                 // expr = expr
    FUNCTION_DEF: 'function-def',         // f(x) = expr
    INLINE_EVAL: 'inline-eval',           // \expr\
    COMMENT: 'comment',                   // "..."
    BLANK: 'blank'
};

/**
 * Marker precedence - higher precedence markers take priority
 * Arrow markers (->, ->>, <-) have higher precedence than colon markers
 */
const MARKER_PRECEDENCE = {
    '->>': 3,
    '=>>': 3,
    '<<-': 3,
    '->': 2,
    '=>': 2,
    '<-': 2,
    '::': 1,
    ':': 0
};

/**
 * Get marker string from token
 */
function getMarkerString(token) {
    switch (token.type) {
        case TokenType.COLON: return ':';
        case TokenType.DOUBLE_COLON: return '::';
        case TokenType.ARROW_LEFT: return '<-';
        case TokenType.ARROW_LEFT_FULL: return '<<-';
        case TokenType.ARROW_RIGHT: return '->';
        case TokenType.ARROW_FULL: return '->>';
        case TokenType.ARROW_PERSIST: return '=>';
        case TokenType.ARROW_PERSIST_FULL: return '=>>';
        default: return null;
    }
}

/**
 * Get the raw source text for any token
 */
function tokenToRaw(token) {
    if (token.type === TokenType.NUMBER) return token.value.raw;
    if (token.type === TokenType.ERROR || token.type === TokenType.UNEXPECTED_CHAR) {
        // Use .raw if stored by the tokenizer
        if (token.raw) return token.raw;
        // Fallback: extract character from "Unexpected character 'X'" messages
        const charMatch = token.value.match(/character '(.)'/);
        if (charMatch) return charMatch[1];
        // Last resort: return empty (tokensToText will use token.length for spacing)
        return '';
    }
    return token.value;
}

/**
 * Reconstruct parseable text from a token array.
 * Uses token .ws (leading whitespace) when available for exact whitespace preservation
 * (including tabs). Falls back to column-position-based spacing.
 */
function tokensToText(tokens) {
    if (tokens.length === 0) return '';
    let result = '';
    for (const t of tokens) {
        if (t.ws) result += t.ws;
        result += tokenToRaw(t);
    }
    return result;
}

/**
 * LineParser class - parses a single line to extract declarations or expression outputs
 *
 * Works purely from the token stream — no line text required.
 */
class LineParser {
    /**
     * Create a LineParser by tokenizing a line of text
     * @param {string} line - The line text to parse
     * @param {number} lineNumber - Line number (0-based)
     */
    constructor(line, lineNumber = 0) {
        const tokenizer = new Tokenizer(line);
        const allLines = tokenizer.tokenize();
        // Delegate to the token-based initializer (single-line input → first line)
        const fromTokens = LineParser.fromTokens(allLines[0] || [], lineNumber);
        this.lineNumber = fromTokens.lineNumber;
        this.pos = fromTokens.pos;
        this.lineComment = fromTokens.lineComment;
        this.trailingComment = fromTokens.trailingComment;
        this.tokens = fromTokens.tokens;
    }

    /**
     * Create a LineParser from pre-tokenized input (avoids re-tokenizing)
     * Derives comment metadata purely from the token stream.
     * @param {Array} tokens - Tokens for this line (may include COMMENT and EOF tokens)
     * @param {number} lineNumber - Line number (0-based)
     * @returns {LineParser}
     */
    static fromTokens(tokens, lineNumber = 0) {
        const parser = Object.create(LineParser.prototype);
        parser.lineNumber = lineNumber;
        parser.pos = 0;

        // Extract comment info from COMMENT tokens
        let lineComment = null;
        let trailingComment = null;
        const commentTokens = tokens.filter(t => t.type === TokenType.COMMENT);

        for (const t of commentTokens) {
            if (t.lineComment) {
                lineComment = '//' + t.value;
            }
        }

        // Structural tokens (no COMMENT, EOF)
        const structuralTokens = tokens.filter(t =>
            t.type !== TokenType.COMMENT &&
            t.type !== TokenType.EOF
        );

        // Trailing quoted comment: last non-lineComment COMMENT token
        // that comes after all structural tokens
        const quotedComments = commentTokens.filter(t => !t.lineComment);
        if (quotedComments.length > 0) {
            const lastQuoted = quotedComments[quotedComments.length - 1];
            const lastStructural = structuralTokens.length > 0
                ? structuralTokens[structuralTokens.length - 1]
                : null;
            // It's trailing if no structural token comes after it
            if (!lastStructural ||
                lastQuoted.col > lastStructural.col + tokenToRaw(lastStructural).length - 1) {
                trailingComment = lastQuoted.value;
            }
        }

        parser.lineComment = lineComment;
        parser.trailingComment = trailingComment;
        parser.tokens = structuralTokens;

        return parser;
    }

    peek(offset = 0) {
        const idx = this.pos + offset;
        return idx < this.tokens.length ? this.tokens[idx] : null;
    }

    advance() {
        return this.pos < this.tokens.length ? this.tokens[this.pos++] : null;
    }

    /**
     * Find all marker tokens in the token stream
     * Returns array of { token, index }
     */
    findAllMarkers() {
        const markers = [];
        for (let i = 0; i < this.tokens.length; i++) {
            if (this.tokens[i].isMarker) {
                markers.push({ token: this.tokens[i], index: i });
            }
        }
        return markers;
    }

    /**
     * Find the most appropriate marker to use
     * Strategy:
     * 1. Arrow markers (-> ->> <-) take precedence over colon markers
     * 2. Arrow markers prefer leftmost (the real marker; later ones are in trailing text)
     * 3. Colon markers prefer rightmost (for "label: var: value" patterns)
     */
    findBestMarker() {
        const markers = this.findAllMarkers();
        if (markers.length === 0) return null;

        // If there's an input arrow, always use the first one
        for (const m of markers) {
            if (m.token.type === TokenType.ARROW_LEFT ||
                m.token.type === TokenType.ARROW_LEFT_FULL) {
                return m;
            }
        }

        // Find highest precedence marker
        // Arrows (-> ->>) prefer leftmost; colons (: ::) prefer rightmost
        let best = markers[0];
        for (let i = 1; i < markers.length; i++) {
            const m = markers[i];
            const mPrec = MARKER_PRECEDENCE[getMarkerString(m.token)];
            const bestPrec = MARKER_PRECEDENCE[getMarkerString(best.token)];

            if (mPrec > bestPrec) {
                best = m;
            } else if (mPrec === bestPrec) {
                // Arrows: leftmost wins (keep best if it's already left)
                // Colons: rightmost wins
                if (mPrec < 2 && m.index > best.index) {
                    best = m;
                }
            }
        }

        return best;
    }

    /**
     * Walk tokens backward from the marker to find the variable declaration group.
     * Returns { name, base, limits, hasLimits, varTokenStartIndex } or null.
     *
     * Handles: IDENTIFIER, optional #base suffix (FORMATTER + NUMBER or merged into marker),
     * optional [limits] (LBRACKET...RBRACKET), and optional $/%  FORMATTER tokens.
     */
    getImmediateVarBeforeMarker(markerIndex) {
        if (markerIndex === 0) return null;

        const markerToken = this.tokens[markerIndex];
        // Base may be merged into the marker token (e.g., #16->)
        let base = markerToken.base || 10;
        let limits = null;
        let hasLimits = false;
        let idx = markerIndex - 1;

        // Skip standalone $ or % FORMATTER tokens (normally merged into marker,
        // but appear separately when there's whitespace: "x$ :")
        while (idx >= 0 && this.tokens[idx].type === TokenType.FORMATTER &&
               (this.tokens[idx].value === '$' || this.tokens[idx].value === '%')) {
            idx--;
        }

        // Check for limits: [lowExpr : highExpr]
        if (idx >= 0 && this.tokens[idx].type === TokenType.RBRACKET) {
            const rbracketIdx = idx;
            let depth = 1;
            idx--;
            let colonInBracket = -1;
            while (idx >= 0) {
                const t = this.tokens[idx];
                if (t.type === TokenType.RBRACKET) {
                    depth++;
                } else if (t.type === TokenType.LBRACKET) {
                    depth--;
                    if (depth === 0) break;
                }
                if (depth === 1 && t.type === TokenType.COLON) {
                    colonInBracket = idx;
                }
                idx--;
            }
            // idx is now at LBRACKET (or -1 if unmatched)
            if (idx >= 0) {
                hasLimits = true;
                if (colonInBracket !== -1) {
                    limits = {
                        lowTokens: this.tokens.slice(idx + 1, colonInBracket),
                        highTokens: this.tokens.slice(colonInBracket + 1, rbracketIdx)
                    };
                }
                idx--; // Move past LBRACKET
            }
        }

        // Check for #base suffix: FORMATTER('#') + NUMBER (when not merged into marker)
        if (idx >= 1 &&
            this.tokens[idx].type === TokenType.NUMBER &&
            this.tokens[idx - 1].type === TokenType.FORMATTER &&
            this.tokens[idx - 1].value === '#') {
            base = this.tokens[idx].value.value;
            idx -= 2;
        }

        // Expect IDENTIFIER — the variable name
        if (idx >= 0 && this.tokens[idx].type === TokenType.IDENTIFIER) {
            return {
                name: this.tokens[idx].value,
                base,
                limits,
                hasLimits,
                varTokenStartIndex: idx
            };
        }

        return null;
    }

    /**
     * Check if the LHS (before marker) is an expression or just label + variable
     *
     * An expression has operators connecting terms: "a + b", "sqrt(a)", "(a * b)"
     * A simple declaration has only label text followed by a variable name
     *
     * Key heuristic: check the token type immediately before the variable group.
     * Operators, numbers, and opening parens indicate expression context.
     */
    isExpressionLHS(markerIndex) {
        if (markerIndex === 0) return false;

        const markerToken = this.tokens[markerIndex];

        // <- <<- : :: always indicate variable declaration, not expression output
        if (markerToken.type === TokenType.ARROW_LEFT ||
            markerToken.type === TokenType.ARROW_LEFT_FULL ||
            markerToken.type === TokenType.COLON ||
            markerToken.type === TokenType.DOUBLE_COLON) {
            return false;
        }

        // Get the variable info - if we can't find one, assume expression
        const varInfo = this.getImmediateVarBeforeMarker(markerIndex);
        if (!varInfo) return true;

        // No tokens before the variable group — simple declaration
        if (varInfo.varTokenStartIndex === 0) return false;

        const prevToken = this.tokens[varInfo.varTokenStartIndex - 1];

        // Number immediately before variable means they're adjacent (expression)
        // e.g., "7v#32->" should be expression, not "7" as label + "v#32" as variable
        if (prevToken.type === TokenType.NUMBER) {
            return true;
        }

        // Opening paren indicates function call or grouping
        if (prevToken.type === TokenType.LPAREN) {
            return true;
        }

        // Operators connect terms in expressions
        if (prevToken.type === TokenType.OPERATOR) {
            if (prevToken.value === '-') {
                // Check if binary minus (something connects to it before)
                if (varInfo.varTokenStartIndex >= 2) {
                    const prevPrev = this.tokens[varInfo.varTokenStartIndex - 2];
                    if (prevPrev.type === TokenType.IDENTIFIER ||
                        prevPrev.type === TokenType.NUMBER ||
                        prevPrev.type === TokenType.RPAREN ||
                        prevPrev.type === TokenType.RBRACKET ||
                        prevPrev.type === TokenType.OPERATOR ||
                        prevPrev.type === TokenType.LPAREN) {
                        return true; // Binary minus connecting terms
                    }
                }
                return false; // Unary minus or label with dash
            }
            return true; // Other operators directly connect
        }

        return false;
    }

    /**
     * Extract value tokens and optional unit comment from tokens after the marker.
     * Returns { valueTokens: Token[], unitComment: string|null }
     */
    extractValueAndComment(markerIndex) {
        const markerToken = this.tokens[markerIndex];
        const afterTokens = this.tokens.slice(markerIndex + 1);

        if (afterTokens.length === 0) {
            return { valueTokens: [], unitComment: null };
        }

        // For non-output markers (: :: <-), all tokens are value (no unit comment split)
        if (markerToken.type !== TokenType.ARROW_RIGHT && markerToken.type !== TokenType.ARROW_FULL &&
            markerToken.type !== TokenType.ARROW_PERSIST && markerToken.type !== TokenType.ARROW_PERSIST_FULL) {
            return { valueTokens: afterTokens, unitComment: null };
        }

        // For output markers, split value and trailing unit comment
        let valueTokenCount = 0;

        if (afterTokens[0].type === TokenType.NUMBER) {
            valueTokenCount = 1;
        } else if (afterTokens.length > 1 && afterTokens[0].type === TokenType.OPERATOR &&
                   afterTokens[0].value === '-' && afterTokens[1].type === TokenType.NUMBER) {
            valueTokenCount = 2;
        }

        if (valueTokenCount > 0) {
            // If value covers all tokens, no unit comment
            if (valueTokenCount >= afterTokens.length) {
                return { valueTokens: afterTokens, unitComment: null };
            }

            // Don't split if trailing starts with digit, $, or -digit (ambiguous with value)
            const nextToken = afterTokens[valueTokenCount];
            if (nextToken.type === TokenType.NUMBER ||
                (nextToken.type === TokenType.FORMATTER && nextToken.value === '$') ||
                (nextToken.type === TokenType.OPERATOR && nextToken.value === '-' &&
                 valueTokenCount + 1 < afterTokens.length &&
                 afterTokens[valueTokenCount + 1].type === TokenType.NUMBER)) {
                return { valueTokens: afterTokens, unitComment: null };
            }

            const valueTokens = afterTokens.slice(0, valueTokenCount);
            const commentTokens = afterTokens.slice(valueTokenCount);
            return { valueTokens, unitComment: tokensToText(commentTokens).trim() || null };
        }

        // No numeric value found - entire text is unit comment (for cleared output variables)
        return { valueTokens: [], unitComment: tokensToText(afterTokens).trim() || null };
    }

    /**
     * Extract expression tokens before the marker.
     * Returns the token slice for the expression (no text conversion).
     * Handles cases like "result: (a * b)->" and "Result x+y->".
     */
    extractExpressionTokens(markerIndex) {
        if (markerIndex === 0) return [];

        // Get all tokens before the marker
        const tokensBeforeMarker = this.tokens.slice(0, markerIndex);
        if (tokensBeforeMarker.length === 0) return [];

        // Check for "label: expression" pattern — find last COLON (not inside brackets)
        // that is followed by a space
        let lastColonIdx = -1;
        let bracketDepth = 0;
        for (let i = tokensBeforeMarker.length - 1; i >= 0; i--) {
            if (tokensBeforeMarker[i].type === TokenType.RBRACKET) bracketDepth++;
            else if (tokensBeforeMarker[i].type === TokenType.LBRACKET) bracketDepth--;
            else if (bracketDepth === 0 && tokensBeforeMarker[i].type === TokenType.COLON) {
                // Check that there's a space after the colon (label separator pattern)
                if (i + 1 < tokensBeforeMarker.length) {
                    const colonToken = tokensBeforeMarker[i];
                    const nextToken = tokensBeforeMarker[i + 1];
                    const colonEnd = colonToken.col + tokenToRaw(colonToken).length;
                    if (nextToken.col > colonEnd) {
                        lastColonIdx = i;
                        break;
                    }
                }
            }
        }

        if (lastColonIdx !== -1) {
            return tokensBeforeMarker.slice(lastColonIdx + 1);
        }

        // Find where the expression actually starts
        // Strategy: find the first operator and trace back to find the start of the expression
        // For "Result x+y" we want to find "x+y" - the x starts the expression

        // First pass: find where the first operator is
        let firstOperatorIdx = -1;
        for (let i = 0; i < tokensBeforeMarker.length; i++) {
            const token = tokensBeforeMarker[i];
            if (token.type === TokenType.OPERATOR) {
                firstOperatorIdx = i;
                break;
            }
            // Function call (identifier followed by lparen) also starts expression
            if (token.type === TokenType.LPAREN && i > 0 && tokensBeforeMarker[i-1].type === TokenType.IDENTIFIER) {
                firstOperatorIdx = i - 1;
                break;
            }
            // Opening paren not after identifier starts expression
            if (token.type === TokenType.LPAREN) {
                firstOperatorIdx = i;
                break;
            }
        }

        if (firstOperatorIdx === -1) {
            // No operators found - check for adjacent numbers/identifiers
            // or single identifier/number (valid simple expression)
            let lastValueIdx = -1;
            let hasAdjacentValues = false;
            for (let i = tokensBeforeMarker.length - 1; i >= 0; i--) {
                if (tokensBeforeMarker[i].type === TokenType.IDENTIFIER ||
                    tokensBeforeMarker[i].type === TokenType.NUMBER) {
                    if (lastValueIdx === -1) {
                        lastValueIdx = i;
                    } else {
                        // Found another value token - adjacent values without operator
                        hasAdjacentValues = true;
                    }
                }
            }
            if (lastValueIdx !== -1) {
                if (hasAdjacentValues) {
                    // Multiple adjacent values - if last is a NUMBER preceded by an
                    // IDENTIFIER, the identifier is label text (e.g., "Enter 3.25$->>")
                    if (tokensBeforeMarker[lastValueIdx].type === TokenType.NUMBER &&
                        lastValueIdx > 0 &&
                        tokensBeforeMarker[lastValueIdx - 1].type === TokenType.IDENTIFIER) {
                        return tokensBeforeMarker.slice(lastValueIdx);
                    }
                    // Otherwise include all as expression (parser will error)
                    return tokensBeforeMarker;
                }
                return tokensBeforeMarker.slice(lastValueIdx);
            }
            return tokensBeforeMarker;
        }

        // Found first operator - the expression starts with the token before it
        // (or the operator itself if it's unary/paren)
        let exprStartIdx = firstOperatorIdx;

        const firstOpToken = tokensBeforeMarker[firstOperatorIdx];

        // If it's an opening paren, expression starts here
        if (firstOpToken.type === TokenType.LPAREN) {
            // Check if it's a function call (identifier before it)
            if (firstOperatorIdx > 0 && tokensBeforeMarker[firstOperatorIdx - 1].type === TokenType.IDENTIFIER) {
                exprStartIdx = firstOperatorIdx - 1;
            }
        } else if (firstOpToken.type === TokenType.OPERATOR) {
            // Binary operator - expression starts with the token before it
            if (firstOperatorIdx > 0 &&
                (tokensBeforeMarker[firstOperatorIdx - 1].type === TokenType.IDENTIFIER ||
                 tokensBeforeMarker[firstOperatorIdx - 1].type === TokenType.NUMBER)) {
                exprStartIdx = firstOperatorIdx - 1;
            }
            // If preceded by a FORMATTER ($/%/#), back up through it to include in expression
            // e.g., "x%+4" or "3$+4" — the FORMATTER is part of the expression (error), not a label
            if (firstOperatorIdx > 1 &&
                tokensBeforeMarker[firstOperatorIdx - 1].type === TokenType.FORMATTER &&
                (tokensBeforeMarker[firstOperatorIdx - 2].type === TokenType.IDENTIFIER ||
                 tokensBeforeMarker[firstOperatorIdx - 2].type === TokenType.NUMBER)) {
                exprStartIdx = firstOperatorIdx - 2;
            }
        }

        // Check if expression start token is preceded by base literal tokens
        // (e.g., IDENTIFIER 'f' + FORMATTER '#' + NUMBER '16' should all be included)
        while (exprStartIdx >= 2 &&
               tokensBeforeMarker[exprStartIdx].type === TokenType.NUMBER &&
               tokensBeforeMarker[exprStartIdx - 1].type === TokenType.FORMATTER &&
               tokensBeforeMarker[exprStartIdx - 1].value === '#' &&
               tokensBeforeMarker[exprStartIdx - 2].type === TokenType.IDENTIFIER) {
            exprStartIdx -= 2;
        }

        // Get the expression from the start token to the marker
        return tokensBeforeMarker.slice(exprStartIdx);
    }

    /**
     * Parse the line and return result
     */
    parse() {
        // Skip blank lines
        if (this.tokens.length === 0) {
            return null;
        }

        // Find the best marker token to use
        const markerInfo = this.findBestMarker();
        if (!markerInfo) {
            return null; // No marker found - not a declaration or expression output
        }

        const { token: markerToken, index: markerIndex } = markerInfo;
        const marker = getMarkerString(markerToken);
        const markerEndCol = markerToken.col + markerToken.value.length;  // 1-based col after marker

        // Check for braced equation after marker - skip if RHS starts with {
        if (markerIndex + 1 < this.tokens.length &&
            this.tokens[markerIndex + 1].type === TokenType.LBRACE) {
            return null;
        }

        // Format specifier ($/%  before marker) is merged into the marker token
        // by the tokenizer — read it directly from the token's format property.
        const markerFormat = markerToken.format || null;

        // Determine if this is declaration or expression output
        const isExpression = this.isExpressionLHS(markerIndex);

        if (!isExpression) {
            const varInfo = this.getImmediateVarBeforeMarker(markerIndex);
            if (!varInfo) {
                return null;
            }

            // Extract value tokens and unit comment
            const { valueTokens, unitComment } = this.extractValueAndComment(markerIndex);

            // Read type, precision, and clear behavior directly from marker token
            const type = markerToken.varType;
            const clearBehavior = markerToken.clearBehavior;
            const fullPrecision = markerToken.fullPrecision;

            let finalComment = this.trailingComment;
            let commentUnquoted = false;
            // Output markers use unit comment if no quoted comment
            if (type === VarType.OUTPUT && !finalComment && unitComment) {
                finalComment = unitComment;
                commentUnquoted = true;
            }

            // Capture label text from tokens before the variable name
            const label = varInfo.varTokenStartIndex > 0
                ? tokensToText(this.tokens.slice(0, varInfo.varTokenStartIndex)).trim()
                : null;

            return {
                kind: 'declaration',
                name: varInfo.name,
                label,
                type,
                clearBehavior,
                limits: varInfo.limits,
                valueTokens,
                base: varInfo.base,
                fullPrecision,
                marker,
                markerEndCol,
                format: markerFormat,
                comment: finalComment,
                commentUnquoted
            };
        } else {
            // Expression output
            const exprTokens = this.extractExpressionTokens(markerIndex);
            const { valueTokens, unitComment } = this.extractValueAndComment(markerIndex);

            const fullPrecision = markerToken.fullPrecision;
            const recalculates = markerToken.varType === VarType.OUTPUT;

            let finalComment = this.trailingComment;
            let commentUnquoted = false;
            if (!finalComment && unitComment) {
                finalComment = unitComment;
                commentUnquoted = true;
            }

            return {
                kind: 'expression-output',
                exprTokens,
                marker,
                markerEndCol,
                valueTokens,
                fullPrecision,
                recalculates,
                format: markerFormat,
                base: markerToken.base || 10,
                comment: finalComment,
                commentUnquoted
            };
        }
    }
}

/**
 * Parse a marked line using the grammar-based parser
 * This is a drop-in replacement for the regex-based parseMarkedLine in variables.js
 */
function parseMarkedLineNew(line) {
    const parser = new LineParser(line);
    return parser.parse();
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        LineType,
        LineParser,
        parseMarkedLineNew,
        getMarkerString,
        tokenToRaw,
        tokensToText
    };
}
