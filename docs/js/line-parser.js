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
    '->': 2,
    '<-': 2,
    '::': 1,
    ':': 0
};

/**
 * Check if a token is a declaration marker
 */
function isMarkerToken(token) {
    return token.type === TokenType.COLON ||
           token.type === TokenType.DOUBLE_COLON ||
           token.type === TokenType.ARROW_LEFT ||
           token.type === TokenType.ARROW_RIGHT ||
           token.type === TokenType.ARROW_FULL;
}

/**
 * Get marker string from token
 */
function getMarkerString(token) {
    switch (token.type) {
        case TokenType.COLON: return ':';
        case TokenType.DOUBLE_COLON: return '::';
        case TokenType.ARROW_LEFT: return '<-';
        case TokenType.ARROW_RIGHT: return '->';
        case TokenType.ARROW_FULL: return '->>';
        default: return null;
    }
}

/**
 * LineParser class - parses a single line to extract declarations or expression outputs
 */
class LineParser {
    constructor(line, lineNumber = 0) {
        this.originalLine = line;
        this.lineNumber = lineNumber;

        // Strip // line comment before processing
        const lcStart = findLineCommentStart(line);
        this.lineComment = null;
        if (lcStart !== -1) {
            this.lineComment = line.substring(lcStart);
            line = line.substring(0, lcStart);
        }

        // Extract trailing quoted comment before tokenizing
        const trailingCommentMatch = line.match(/"([^"]*)"\s*$/);
        this.trailingComment = trailingCommentMatch ? trailingCommentMatch[1] : null;

        // Remove quoted strings for tokenization (replace with spaces to preserve positions)
        this.cleanLine = line.replace(/"[^"]*"/g, match => ' '.repeat(match.length));

        // Tokenize the clean line
        const tokenizer = new Tokenizer(this.cleanLine);
        this.tokens = tokenizer.tokenize();

        // Filter out NEWLINE and EOF for easier parsing, but keep track of original positions
        this.tokens = this.tokens.filter(t => t.type !== TokenType.NEWLINE && t.type !== TokenType.EOF);
        this.pos = 0;
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
            if (isMarkerToken(this.tokens[i])) {
                markers.push({ token: this.tokens[i], index: i });
            }
        }
        return markers;
    }

    /**
     * Find the most appropriate marker to use
     * Strategy:
     * 1. Arrow markers (-> ->> <-) take precedence over colon markers
     * 2. Among equal precedence, use the last one (rightmost)
     * 3. But for input (<-), always use the first one found
     */
    findBestMarker() {
        const markers = this.findAllMarkers();
        if (markers.length === 0) return null;

        // If there's an input arrow, always use the first one
        for (const m of markers) {
            if (m.token.type === TokenType.ARROW_LEFT) {
                return m;
            }
        }

        // Find highest precedence marker (prefer rightmost among equals)
        let best = markers[0];
        for (let i = 1; i < markers.length; i++) {
            const m = markers[i];
            const mPrec = MARKER_PRECEDENCE[getMarkerString(m.token)];
            const bestPrec = MARKER_PRECEDENCE[getMarkerString(best.token)];

            // Higher precedence wins, or same precedence but rightmost
            if (mPrec > bestPrec || (mPrec === bestPrec && m.index > best.index)) {
                best = m;
            }
        }

        return best;
    }

    /**
     * Check if the token immediately before the marker is a single identifier
     * (possibly with suffix $ % or #base)
     */
    getImmediateVarBeforeMarker(markerIndex) {
        if (markerIndex === 0) return null;

        const markerToken = this.tokens[markerIndex];
        const markerCol = markerToken.col;

        // Look for what's immediately before the marker in the original line
        // Get the text just before the marker
        const beforeMarker = this.cleanLine.substring(0, markerCol - 1);

        // Check for variable pattern at end: identifier optionally followed by $, %, or #digits
        // Also handle limits: identifier[low:high]
        // Variable names must start with letter or underscore (not digit)
        const varMatch = beforeMarker.match(/([a-zA-Z_]\w*)([$%]|#\d+)?(\s*\[[^\]]+\])?\s*$/);
        if (varMatch) {
            const name = varMatch[1];
            const formatSuffix = varMatch[2];
            const limitsText = varMatch[3];

            let format = null;
            let base = 10;
            if (formatSuffix === '$') format = 'money';
            else if (formatSuffix === '%') format = 'percent';
            else if (formatSuffix && formatSuffix.startsWith('#')) {
                base = parseInt(formatSuffix.substring(1));
            }

            let limits = null;
            if (limitsText) {
                const limitsContent = limitsText.replace(/[\[\]\s]/g, '');
                const colonIdx = limitsContent.indexOf(':');
                if (colonIdx !== -1) {
                    limits = {
                        lowExpr: limitsContent.substring(0, colonIdx).trim(),
                        highExpr: limitsContent.substring(colonIdx + 1).trim()
                    };
                }
            }

            // Calculate where the variable starts in the line
            const fullVarMatch = varMatch[0];
            const varStartPos = beforeMarker.length - fullVarMatch.length;

            return {
                name,
                format,
                base,
                limits,
                hasLimits: !!limitsText,
                varStartPos
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
     * Key heuristic: if there's an operator connecting to the variable immediately
     * before the marker, it's an expression. Parentheses in label text like
     * "Value (m/s) b" don't count because ) is followed by space then identifier.
     */
    isExpressionLHS(markerIndex) {
        if (markerIndex === 0) return false;

        const markerToken = this.tokens[markerIndex];

        // <- always indicates input variable declaration
        if (markerToken.type === TokenType.ARROW_LEFT) {
            return false;
        }

        // Get the variable info - if we can't find one, assume expression
        const varInfo = this.getImmediateVarBeforeMarker(markerIndex);
        if (!varInfo) return true;

        // Get the text before the variable
        const beforeVar = this.cleanLine.substring(0, varInfo.varStartPos).trimEnd();
        if (!beforeVar) return false; // No label text, simple declaration

        // Check if there's an operator immediately before the variable that would
        // connect it to the previous term (making it an expression)
        // Operators that connect: + - * / ** ^ %
        // Opening paren ( also indicates function call
        // Closing paren ) with no space before var also connects: "func(x)"
        // But ) followed by space then var is just label: "Value (m/s) x"

        const lastChar = beforeVar[beforeVar.length - 1];

        // Digit immediately before variable means they're adjacent (expression, not label)
        // e.g., "7v#32->" should be expression, not "7" as label + "v#32" as variable
        if (/\d/.test(lastChar)) {
            return true;
        }

        // Math operators directly connect
        if (['+', '*', '/', '^', '%', '<', '>', '=', '!', '&', '|', '~'].includes(lastChar)) {
            return true;
        }

        // Opening paren indicates the start of an expression or function arg
        if (lastChar === '(') {
            return true;
        }

        // For minus, need to check if it's binary (connecting) or could be part of label
        if (lastChar === '-') {
            // Check if there's something before the minus that it connects to
            const beforeMinus = beforeVar.slice(0, -1).trimEnd();
            if (beforeMinus && /[\w\)\]\+\*\/\^\%\<\>\=\!\&\|\~\(]$/.test(beforeMinus)) {
                return true; // Binary minus connecting terms
            }
        }

        return false;
    }

    /**
     * Extract value and optional unit comment from text after marker
     */
    extractValueAndComment(markerIndex) {
        const markerToken = this.tokens[markerIndex];
        const markerStr = getMarkerString(markerToken);
        const markerEnd = markerToken.col + markerStr.length - 1;
        const afterMarker = this.cleanLine.substring(markerEnd).trim();

        if (!afterMarker) {
            return { valueText: '', unitComment: null };
        }

        // For output markers (-> and ->>), trailing non-numeric text is unit comment
        if (markerToken.type === TokenType.ARROW_RIGHT || markerToken.type === TokenType.ARROW_FULL) {
            // Match numeric value at start:
            // - NaN, Infinity, -Infinity (special values)
            // - Money: $123, -$123.45
            // - Regular numbers with optional scientific notation
            // - Base format: FF#16, 101#2
            const numMatch = afterMarker.match(/^(-?Infinity|NaN|-?\$?[\d,]+(?:\.\d+)?%?(?:[eE][+-]?\d+)?|[0-9a-zA-Z]+#\d+)\s*(.*)$/);
            if (numMatch) {
                return {
                    valueText: numMatch[1],
                    unitComment: numMatch[2].trim() || null
                };
            }
            // No numeric value - entire thing might be unit comment for cleared output
            return { valueText: '', unitComment: afterMarker || null };
        }

        // For other markers, the whole thing is value
        return { valueText: afterMarker, unitComment: null };
    }

    /**
     * Extract expression text before the marker
     * Handles cases like "result: (a * b)->" where we need to find the actual expression
     * Also handles "Result x+y->" where "Result " is label text
     */
    extractExpressionText(markerIndex) {
        if (markerIndex === 0) return '';

        const markerToken = this.tokens[markerIndex];
        const beforeMarker = this.cleanLine.substring(0, markerToken.col - 1).trimEnd();

        // Check for "label: expression" pattern (colon followed by space)
        const colonSpaceIdx = beforeMarker.lastIndexOf(': ');
        if (colonSpaceIdx !== -1) {
            return beforeMarker.substring(colonSpaceIdx + 2).trim();
        }

        // Find where the expression actually starts
        // Strategy: find the first operator and trace back to find the start of the expression
        // For "Result x+y" we want to find "x+y" - the x starts the expression

        // Get all tokens before the marker
        const tokensBeforeMarker = this.tokens.slice(0, markerIndex);
        if (tokensBeforeMarker.length === 0) return '';

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
            // No operators found - check for adjacent numbers/identifiers (invalid syntax)
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
                    // Multiple adjacent values - include all of them as the expression
                    // (the parser will fail with a proper error)
                    return beforeMarker.trim();
                }
                return beforeMarker.substring(tokensBeforeMarker[lastValueIdx].col - 1).trim();
            }
            return beforeMarker.trim();
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
        }

        // Get the expression from the start token to the marker
        const startToken = tokensBeforeMarker[exprStartIdx];
        return beforeMarker.substring(startToken.col - 1).trim();
    }

    /**
     * Parse the line and return result
     */
    parse() {
        // Skip blank lines
        if (this.tokens.length === 0 || this.cleanLine.trim() === '') {
            return null;
        }

        // Find the best marker token to use
        const markerInfo = this.findBestMarker();
        if (!markerInfo) {
            return null; // No marker found - not a declaration or expression output
        }

        const { token: markerToken, index: markerIndex } = markerInfo;
        const marker = getMarkerString(markerToken);

        // Check for braced equation before marker - skip if RHS starts with {
        const markerEnd = markerToken.col + marker.length - 1;
        const afterMarker = this.cleanLine.substring(markerEnd).trim();
        if (afterMarker.startsWith('{')) {
            return null;
        }

        // Determine if this is declaration or expression output
        const isExpression = this.isExpressionLHS(markerIndex);

        if (!isExpression) {
            // Variable declaration
            const varInfo = this.getImmediateVarBeforeMarker(markerIndex);
            if (!varInfo) {
                return null;
            }

            // Extract value and unit comment
            const { valueText, unitComment } = this.extractValueAndComment(markerIndex);

            // Determine type based on marker
            let type, clearBehavior, fullPrecision;
            let finalComment = this.trailingComment;
            let commentUnquoted = false;

            switch (markerToken.type) {
                case TokenType.ARROW_LEFT:
                    type = VarType.INPUT;
                    clearBehavior = ClearBehavior.ON_CLEAR;
                    fullPrecision = false;
                    break;
                case TokenType.ARROW_RIGHT:
                    type = VarType.OUTPUT;
                    clearBehavior = ClearBehavior.ON_SOLVE;
                    fullPrecision = false;
                    // Use unit comment if no quoted comment
                    if (!finalComment && unitComment) {
                        finalComment = unitComment;
                        commentUnquoted = true;
                    }
                    break;
                case TokenType.ARROW_FULL:
                    type = VarType.OUTPUT;
                    clearBehavior = ClearBehavior.ON_SOLVE;
                    fullPrecision = true;
                    if (!finalComment && unitComment) {
                        finalComment = unitComment;
                        commentUnquoted = true;
                    }
                    break;
                case TokenType.DOUBLE_COLON:
                    type = VarType.STANDARD;
                    clearBehavior = ClearBehavior.NONE;
                    fullPrecision = true;
                    break;
                case TokenType.COLON:
                default:
                    type = VarType.STANDARD;
                    clearBehavior = ClearBehavior.NONE;
                    fullPrecision = false;
                    break;
            }

            return {
                kind: 'declaration',
                name: varInfo.name,
                type,
                clearBehavior,
                limits: varInfo.limits,
                valueText: valueText,
                base: varInfo.base,
                fullPrecision,
                marker,
                format: varInfo.format,
                comment: finalComment,
                commentUnquoted
            };
        } else {
            // Expression output
            const expression = this.extractExpressionText(markerIndex);
            const { valueText, unitComment } = this.extractValueAndComment(markerIndex);

            const fullPrecision = markerToken.type === TokenType.DOUBLE_COLON ||
                                  markerToken.type === TokenType.ARROW_FULL;
            const recalculates = markerToken.type === TokenType.ARROW_RIGHT ||
                                 markerToken.type === TokenType.ARROW_FULL;

            let finalComment = this.trailingComment;
            let commentUnquoted = false;
            if (!finalComment && unitComment) {
                finalComment = unitComment;
                commentUnquoted = true;
            }

            return {
                kind: 'expression-output',
                expression,
                marker,
                valueText,
                fullPrecision,
                recalculates,
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
        isMarkerToken,
        getMarkerString
    };
}
