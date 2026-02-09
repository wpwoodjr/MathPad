/**
 * MathPad Parser - Tokenizer and Expression Parser
 * Handles all MathPad syntax including operators, functions, variables, and equations
 */

// Token types
const TokenType = {
    NUMBER: 'NUMBER',
    IDENTIFIER: 'IDENTIFIER',
    OPERATOR: 'OPERATOR',
    LPAREN: 'LPAREN',
    RPAREN: 'RPAREN',
    LBRACKET: 'LBRACKET',
    RBRACKET: 'RBRACKET',
    LBRACE: 'LBRACE',
    RBRACE: 'RBRACE',
    SEMICOLON: 'SEMICOLON',
    COLON: 'COLON',
    COMMA: 'COMMA',
    COMMENT: 'COMMENT',
    NEWLINE: 'NEWLINE',
    EOF: 'EOF',
    ERROR: 'ERROR',
    // Variable declaration markers
    ARROW_LEFT: 'ARROW_LEFT',       // <-
    ARROW_RIGHT: 'ARROW_RIGHT',     // ->
    ARROW_FULL: 'ARROW_FULL',       // ->>
    DOUBLE_COLON: 'DOUBLE_COLON',   // ::
    FORMATTER: 'FORMATTER'          // $ % # (format suffixes)
};

// AST Node types
const NodeType = {
    NUMBER: 'NUMBER',
    VARIABLE: 'VARIABLE',
    BINARY_OP: 'BINARY_OP',
    UNARY_OP: 'UNARY_OP',
    FUNCTION_CALL: 'FUNCTION_CALL',
    ASSIGNMENT: 'ASSIGNMENT',
    EQUATION: 'EQUATION'
};

/**
 * Find the start position of a // line comment, ignoring // inside "..." quotes
 * Returns the index of the first /, or -1 if no line comment found
 */
function findLineCommentStart(line) {
    let inQuote = false;
    for (let i = 0; i < line.length - 1; i++) {
        if (line[i] === '"') inQuote = !inQuote;
        else if (!inQuote && line[i] === '/' && line[i + 1] === '/') return i;
    }
    return -1;
}

/**
 * Strip comments from a line: both // line comments and "..." quoted strings
 * Returns:
 *   clean - both // and "..." replaced with spaces (position-preserving)
 *   stripped - only // removed ("..." still present for regex matching)
 *   lineComment - the "// ..." text or null (for re-appending)
 */
function stripComments(line) {
    const lcStart = findLineCommentStart(line);
    const lineComment = lcStart !== -1 ? line.substring(lcStart) : null;
    const stripped = lcStart !== -1 ? line.substring(0, lcStart) : line;
    const clean = stripped.replace(/"[^"]*"/g, match => ' '.repeat(match.length));
    return { clean, stripped, lineComment };
}

/**
 * Tokenizer class - converts source text to tokens
 */
class Tokenizer {
    constructor(text) {
        this.text = text;
        this.pos = 0;
        this.line = 1;
        this.col = 1;
        this.tokens = [];
    }

    peek(offset = 0) {
        const idx = this.pos + offset;
        return idx < this.text.length ? this.text[idx] : null;
    }

    advance() {
        const ch = this.text[this.pos++];
        if (ch === '\n') {
            this.line++;
            this.col = 1;
        } else {
            this.col++;
        }
        return ch;
    }

    skipWhitespace() {
        while (this.peek() && /[ \t\r]/.test(this.peek())) {
            this.advance();
        }
    }

    isDigit(ch) {
        return ch && /[0-9]/.test(ch);
    }

    isAlpha(ch) {
        return ch && /[a-zA-Z_]/.test(ch);
    }

    isAlphaNum(ch) {
        return ch && /[a-zA-Z0-9_]/.test(ch);
    }

    isHexDigit(ch) {
        return ch && /[0-9a-fA-F]/.test(ch);
    }

    makeToken(type, value, startLine, startCol) {
        return { type, value, line: startLine, col: startCol };
    }

    tokenizeNumber() {
        const startLine = this.line;
        const startCol = this.col;
        let value = '';

        // Check for 0x/0b/0o prefix literals before consuming digits
        if (this.peek() === '0' && this.peek(1) && /[xXbBoO]/.test(this.peek(1))) {
            const prefix = this.peek(1).toLowerCase();
            this.advance(); // 0
            this.advance(); // x/b/o
            let digits = '';
            const digitTest = prefix === 'x' ? this.isHexDigit
                            : prefix === 'b' ? (ch) => ch === '0' || ch === '1'
                            : (ch) => ch && /[0-7]/.test(ch);
            while (digitTest.call(this, this.peek())) {
                digits += this.advance();
            }
            if (!digits) {
                return this.makeToken(TokenType.ERROR, `Invalid 0${prefix} literal`, startLine, startCol);
            }
            const base = prefix === 'x' ? 16 : prefix === 'b' ? 2 : 8;
            const raw = '0' + this.text[this.pos - digits.length - 1] + digits;
            return this.makeToken(TokenType.NUMBER, { value: parseInt(digits, base), base, raw }, startLine, startCol);
        }

        // Decimal number (possibly floating point with scientific notation)
        // Allow commas as digit grouping
        let raw = '';
        while (this.isDigit(this.peek()) || this.peek() === ',') {
            const ch = this.advance();
            raw += ch;
            if (ch !== ',') value += ch;  // Skip commas for numeric value
        }

        // Base literal lookahead: digits followed by alphanums then #digits (e.g., 4D#16, 101#2, 4E#16)
        // Digit-start base literals are always numeric values (can't be variable names)
        const baseLiteral = this.tryConsumeBaseLiteral(raw);
        if (baseLiteral) return this.makeToken(TokenType.NUMBER, baseLiteral, startLine, startCol);

        // Decimal point (with or without trailing digits: 1.5 and 1. are both valid)
        if (this.peek() === '.') {
            const ch = this.advance(); // .
            value += ch;
            raw += ch;
            while (this.isDigit(this.peek())) {
                const ch = this.advance();
                value += ch;
                raw += ch;
            }
        }

        // Scientific notation - only if e/E is followed by digit, +, or -
        if (this.peek() && /[eE]/.test(this.peek()) &&
            (this.isDigit(this.peek(1)) || this.peek(1) === '+' || this.peek(1) === '-')) {
            let ch = this.advance(); // e or E
            value += ch;
            raw += ch;
            if (this.peek() === '+' || this.peek() === '-') {
                ch = this.advance();
                value += ch;
                raw += ch;
            }
            if (!this.isDigit(this.peek())) {
                return this.makeToken(TokenType.ERROR, 'Invalid scientific notation', startLine, startCol);
            }
            while (this.isDigit(this.peek())) {
                ch = this.advance();
                value += ch;
                raw += ch;
            }
        }

        // Percent literal: 5% -> 0.05
        // Since % is not an operator (use mod() for modulo), 5% is always a percent literal
        if (this.peek() === '%') {
            this.advance(); // consume %
            raw += '%';
            return this.makeToken(TokenType.NUMBER, { value: parseFloat(value) / 100, base: 10, raw }, startLine, startCol);
        }

        return this.makeToken(TokenType.NUMBER, { value: parseFloat(value), base: 10, raw }, startLine, startCol);
    }

    /**
     * Try to consume a base literal suffix: alphanums followed by #digits (e.g., D#16, #2)
     * Called after reading initial alphanumeric chars. Peeks ahead without consuming
     * to check for the pattern, then consumes if found.
     * @param {string} prefix - Already-consumed alphanumeric characters
     * @returns {object|null} - { value, base, raw } if base literal found, null otherwise
     */
    tryConsumeBaseLiteral(prefix) {
        // Scan ahead (without consuming) for optional alphanums then #digits
        let offset = 0;

        // Skip additional alphanumeric chars
        while (this.peek(offset) && /[a-zA-Z0-9]/.test(this.peek(offset))) {
            offset++;
        }

        // Must see # followed by at least one digit
        if (this.peek(offset) !== '#') return null;
        offset++;
        if (!this.isDigit(this.peek(offset))) return null;

        // Consume the extra alphanumeric chars
        let digits = prefix;
        while (this.peek() && /[a-zA-Z0-9]/.test(this.peek()) && this.peek() !== '#') {
            digits += this.advance();
        }

        // Consume # and base digits
        this.advance(); // #
        let baseStr = '';
        while (this.isDigit(this.peek())) {
            baseStr += this.advance();
        }

        const base = parseInt(baseStr, 10);
        const raw = digits + '#' + baseStr;
        return { value: parseInt(digits, base), base, raw };
    }

    tokenizeIdentifier() {
        const startLine = this.line;
        const startCol = this.col;
        let value = '';

        while (this.isAlphaNum(this.peek())) {
            value += this.advance();
        }

        // Special numeric values
        if (value === 'Infinity') {
            return this.makeToken(TokenType.NUMBER, { value: Infinity, base: 10, raw: value }, startLine, startCol);
        }
        if (value === 'NaN') {
            return this.makeToken(TokenType.NUMBER, { value: NaN, base: 10, raw: value }, startLine, startCol);
        }

        // Base literal lookahead: identifier followed by #digits (e.g., FF#16, abc#16)
        // Disambiguate from variable with format suffix (x#16:) by peeking past #digits
        // for a declaration marker. If preceded by an operator, it's always a base literal
        // even if a marker follows (e.g., f#16+f#32-> the second f#32 is a base literal).
        if (this.peek() === '#' && this.isDigit(this.peek(1))) {
            let isBaseLiteral = false;

            // Check if preceded by an operator — always a base literal in expression context
            const lastToken = this.tokens.length > 0 ? this.tokens[this.tokens.length - 1] : null;
            if (lastToken && (lastToken.type === TokenType.OPERATOR ||
                              lastToken.type === TokenType.LPAREN ||
                              lastToken.type === TokenType.SEMICOLON ||
                              lastToken.type === TokenType.COMMA)) {
                isBaseLiteral = true;
            } else {
                // Peek past #digits + optional whitespace for a declaration marker
                let offset = 1;
                while (this.isDigit(this.peek(offset))) {
                    offset++;
                }
                while (this.peek(offset) && /[ \t]/.test(this.peek(offset))) {
                    offset++;
                }
                const nextCh = this.peek(offset);
                const nextCh2 = this.peek(offset + 1);
                const isMarker = nextCh === ':' || nextCh === '[' ||
                                 (nextCh === '<' && nextCh2 === '-') ||
                                 (nextCh === '-' && nextCh2 === '>');
                isBaseLiteral = !isMarker;
            }

            if (isBaseLiteral) {
                // Consume #digits and return NUMBER
                this.advance(); // #
                let baseStr = '';
                while (this.isDigit(this.peek())) {
                    baseStr += this.advance();
                }
                const base = parseInt(baseStr, 10);
                const raw = value + '#' + baseStr;
                return this.makeToken(TokenType.NUMBER, { value: parseInt(value, base), base, raw }, startLine, startCol);
            }
            // Otherwise it's a variable with format suffix — fall through to return IDENTIFIER
        }

        return this.makeToken(TokenType.IDENTIFIER, value, startLine, startCol);
    }

    tokenizeComment() {
        const startLine = this.line;
        const startCol = this.col;
        let value = '';

        this.advance(); // opening "
        while (this.peek() && this.peek() !== '"') {
            const ch = this.advance();
            value += ch;
            // Track line/col for newlines within comment
            if (ch === '\n') {
                this.line++;
                this.col = 1;
            }
        }
        if (this.peek() === '"') {
            this.advance(); // closing "
        }

        return this.makeToken(TokenType.COMMENT, value, startLine, startCol);
    }

    tokenizeLineComment() {
        const startLine = this.line;
        const startCol = this.col;
        this.advance(); // first /
        this.advance(); // second /
        let value = '';
        while (this.peek() && this.peek() !== '\n') {
            value += this.advance();
        }
        const token = this.makeToken(TokenType.COMMENT, value, startLine, startCol);
        token.lineComment = true;
        return token;
    }

    tokenizeOperator() {
        const startLine = this.line;
        const startCol = this.col;
        const ch = this.peek();
        const ch2 = this.peek(1);
        const ch3 = this.peek(2);

        // Check three-character operators FIRST
        if (ch === '-' && ch2 === '>' && ch3 === '>') {
            this.advance();
            this.advance();
            this.advance();
            return this.makeToken(TokenType.ARROW_FULL, '->>', startLine, startCol);
        }

        // Two-character operators (check longer patterns first within this group)
        const twoChar = ch + (ch2 || '');

        // Variable declaration markers get their own token types
        if (twoChar === '<-') {
            this.advance();
            this.advance();
            return this.makeToken(TokenType.ARROW_LEFT, '<-', startLine, startCol);
        }
        if (twoChar === '->') {
            this.advance();
            this.advance();
            return this.makeToken(TokenType.ARROW_RIGHT, '->', startLine, startCol);
        }
        // Note: :: is handled in the main tokenize() loop for COLON

        // Other two-character operators
        const twoCharOps = ['**', '==', '!=', '<=', '>=', '<<', '>>', '&&', '||', '^^'];
        if (twoCharOps.includes(twoChar)) {
            this.advance();
            this.advance();
            return this.makeToken(TokenType.OPERATOR, twoChar, startLine, startCol);
        }

        // Single-character operators (% is not an operator - use mod() function)
        const singleCharOps = ['+', '-', '*', '/', '&', '|', '^', '~', '!', '<', '>', '=', '?', '\\'];
        if (singleCharOps.includes(ch)) {
            this.advance();
            return this.makeToken(TokenType.OPERATOR, ch, startLine, startCol);
        }

        return null;
    }

    tokenize() {
        this.tokens = [];

        while (this.pos < this.text.length) {
            const startLine = this.line;
            const startCol = this.col;
            const ch = this.peek();

            // Whitespace (not newline)
            if (/[ \t\r]/.test(ch)) {
                this.skipWhitespace();
                continue;
            }

            // Newline
            if (ch === '\n') {
                this.advance();
                this.tokens.push(this.makeToken(TokenType.NEWLINE, '\n', startLine, startCol));
                continue;
            }

            // Comment in double quotes
            if (ch === '"') {
                this.tokens.push(this.tokenizeComment());
                continue;
            }

            // Line comment: //
            if (ch === '/' && this.peek(1) === '/') {
                this.tokens.push(this.tokenizeLineComment());
                continue;
            }

            // Number
            if (this.isDigit(ch) || (ch === '.' && this.isDigit(this.peek(1)))) {
                this.tokens.push(this.tokenizeNumber());
                continue;
            }

            // Identifier
            if (this.isAlpha(ch)) {
                this.tokens.push(this.tokenizeIdentifier());
                continue;
            }

            // Parentheses
            if (ch === '(') {
                this.advance();
                this.tokens.push(this.makeToken(TokenType.LPAREN, '(', startLine, startCol));
                continue;
            }
            if (ch === ')') {
                this.advance();
                this.tokens.push(this.makeToken(TokenType.RPAREN, ')', startLine, startCol));
                continue;
            }

            // Brackets
            if (ch === '[') {
                this.advance();
                this.tokens.push(this.makeToken(TokenType.LBRACKET, '[', startLine, startCol));
                continue;
            }
            if (ch === ']') {
                this.advance();
                this.tokens.push(this.makeToken(TokenType.RBRACKET, ']', startLine, startCol));
                continue;
            }

            // Braces (equation delimiters)
            if (ch === '{') {
                this.advance();
                this.tokens.push(this.makeToken(TokenType.LBRACE, '{', startLine, startCol));
                continue;
            }
            if (ch === '}') {
                this.advance();
                this.tokens.push(this.makeToken(TokenType.RBRACE, '}', startLine, startCol));
                continue;
            }

            // Semicolon (argument separator)
            if (ch === ';') {
                this.advance();
                this.tokens.push(this.makeToken(TokenType.SEMICOLON, ';', startLine, startCol));
                continue;
            }

            // Colon (variable declaration)
            if (ch === ':') {
                // Check for :: (full precision marker)
                if (this.peek(1) === ':') {
                    this.advance();
                    this.advance();
                    this.tokens.push(this.makeToken(TokenType.DOUBLE_COLON, '::', startLine, startCol));
                } else {
                    this.advance();
                    this.tokens.push(this.makeToken(TokenType.COLON, ':', startLine, startCol));
                }
                continue;
            }

            // Money literal: $digits or $.digits (e.g., $100, $1,234.56, $.01)
            if (ch === '$' && (this.isDigit(this.peek(1)) || (this.peek(1) === '.' && this.isDigit(this.peek(2))))) {
                this.advance(); // consume $
                const numToken = this.tokenizeNumber();
                numToken.value.raw = '$' + numToken.value.raw;
                numToken.line = startLine;
                numToken.col = startCol;
                this.tokens.push(numToken);
                continue;
            }

            // Format suffixes: $ (money), % (percent), # (base)
            if (ch === '$' || ch === '%' || ch === '#') {
                this.advance();
                this.tokens.push(this.makeToken(TokenType.FORMATTER, ch, startLine, startCol));
                continue;
            }

            // Operators
            const opToken = this.tokenizeOperator();
            if (opToken) {
                this.tokens.push(opToken);
                continue;
            }

            // Unknown character - generate error token
            this.advance();
            this.tokens.push(this.makeToken(TokenType.ERROR, `Unexpected character '${ch}'`, startLine, startCol));
        }

        this.tokens.push(this.makeToken(TokenType.EOF, null, this.line, this.col));
        return this.tokens;
    }
}

/**
 * Parser class - builds AST from tokens
 */
class Parser {
    constructor(tokens) {
        this.tokens = tokens.filter(t => t.type !== TokenType.COMMENT && t.type !== TokenType.NEWLINE);
        this.pos = 0;
    }

    peek(offset = 0) {
        const idx = this.pos + offset;
        return idx < this.tokens.length ? this.tokens[idx] : { type: TokenType.EOF, value: null };
    }

    advance() {
        return this.tokens[this.pos++];
    }

    // Format a token value for display in error messages
    formatTokenValue(token) {
        if (token.type === TokenType.NUMBER) {
            return token.value.raw || token.value.value;
        }
        return token.value;
    }

    expect(type, value = null) {
        const token = this.peek();
        if (token.type !== type || (value !== null && token.value !== value)) {
            throw new ParseError(`Expected ${type}${value ? ` '${value}'` : ''}, got ${token.type} '${this.formatTokenValue(token)}'`, token.line, token.col);
        }
        return this.advance();
    }

    match(type, value = null) {
        const token = this.peek();
        if (token.type === type && (value === null || token.value === value)) {
            return this.advance();
        }
        return null;
    }

    // Parse expression with operator precedence
    parseExpression() {
        return this.parseLogicalOr();
    }

    // Level 1: || ^^
    parseLogicalOr() {
        let left = this.parseLogicalAnd();
        while (this.peek().type === TokenType.OPERATOR &&
               (this.peek().value === '||' || this.peek().value === '^^')) {
            const op = this.advance().value;
            const right = this.parseLogicalAnd();
            left = { type: NodeType.BINARY_OP, op, left, right };
        }
        return left;
    }

    // Level 2: &&
    parseLogicalAnd() {
        let left = this.parseComparison();
        while (this.peek().type === TokenType.OPERATOR && this.peek().value === '&&') {
            const op = this.advance().value;
            const right = this.parseComparison();
            left = { type: NodeType.BINARY_OP, op, left, right };
        }
        return left;
    }

    // Level 3: == != < <= > >=
    parseComparison() {
        let left = this.parseBitwiseOr();
        const compOps = ['==', '!=', '<', '<=', '>', '>='];
        while (this.peek().type === TokenType.OPERATOR && compOps.includes(this.peek().value)) {
            const op = this.advance().value;
            const right = this.parseBitwiseOr();
            left = { type: NodeType.BINARY_OP, op, left, right };
        }
        return left;
    }

    // Level 4: | ^
    parseBitwiseOr() {
        let left = this.parseBitwiseAnd();
        while (this.peek().type === TokenType.OPERATOR &&
               (this.peek().value === '|' || this.peek().value === '^')) {
            const op = this.advance().value;
            const right = this.parseBitwiseAnd();
            left = { type: NodeType.BINARY_OP, op, left, right };
        }
        return left;
    }

    // Level 5: &
    parseBitwiseAnd() {
        let left = this.parseShift();
        while (this.peek().type === TokenType.OPERATOR && this.peek().value === '&') {
            const op = this.advance().value;
            const right = this.parseShift();
            left = { type: NodeType.BINARY_OP, op, left, right };
        }
        return left;
    }

    // Level 6: << >>
    parseShift() {
        let left = this.parseAdditive();
        while (this.peek().type === TokenType.OPERATOR &&
               (this.peek().value === '<<' || this.peek().value === '>>')) {
            const op = this.advance().value;
            const right = this.parseAdditive();
            left = { type: NodeType.BINARY_OP, op, left, right };
        }
        return left;
    }

    // Level 7: + -
    parseAdditive() {
        let left = this.parseMultiplicative();
        while (this.peek().type === TokenType.OPERATOR &&
               (this.peek().value === '+' || this.peek().value === '-')) {
            const op = this.advance().value;
            const right = this.parseMultiplicative();
            left = { type: NodeType.BINARY_OP, op, left, right };
        }
        return left;
    }

    // Level 8: * / (use mod() function for modulo)
    parseMultiplicative() {
        let left = this.parsePower();
        while (this.peek().type === TokenType.OPERATOR &&
               (this.peek().value === '*' || this.peek().value === '/')) {
            const op = this.advance().value;
            const right = this.parsePower();
            left = { type: NodeType.BINARY_OP, op, left, right };
        }
        return left;
    }

    // Level 9: ** (right-associative)
    parsePower() {
        const left = this.parseUnary();
        if (this.peek().type === TokenType.OPERATOR && this.peek().value === '**') {
            const op = this.advance().value;
            const right = this.parsePower(); // Right-associative
            return { type: NodeType.BINARY_OP, op, left, right };
        }
        return left;
    }

    // Level 10: Unary - + ~ !
    parseUnary() {
        if (this.peek().type === TokenType.OPERATOR &&
            (this.peek().value === '-' || this.peek().value === '+' ||
             this.peek().value === '~' || this.peek().value === '!')) {
            const op = this.advance().value;
            const operand = this.parseUnary();
            return { type: NodeType.UNARY_OP, op, operand };
        }
        return this.parsePrimary();
    }

    // Primary: numbers, variables, function calls, parenthesized expressions
    parsePrimary() {
        const token = this.peek();

        // Number
        if (token.type === TokenType.NUMBER) {
            this.advance();
            return { type: NodeType.NUMBER, value: token.value.value, raw: token.value.raw, base: token.value.base };
        }

        // Parenthesized expression
        if (token.type === TokenType.LPAREN) {
            this.advance();
            const expr = this.parseExpression();
            this.expect(TokenType.RPAREN);
            return expr;
        }

        // Identifier (variable or function call)
        if (token.type === TokenType.IDENTIFIER) {
            const name = this.advance().value;

            // Function call
            if (this.peek().type === TokenType.LPAREN) {
                this.advance();
                const args = [];

                if (this.peek().type !== TokenType.RPAREN) {
                    args.push(this.parseExpression());
                    while (this.peek().type === TokenType.SEMICOLON) {
                        this.advance();
                        args.push(this.parseExpression());
                    }
                }

                this.expect(TokenType.RPAREN);
                return { type: NodeType.FUNCTION_CALL, name, args };
            }

            // Variable reference
            return { type: NodeType.VARIABLE, name };
        }

        throw new ParseError(`Unexpected token: ${token.type} '${this.formatTokenValue(token)}'`, token.line, token.col);
    }

    parse() {
        if (this.tokens.length === 0 || (this.tokens.length === 1 && this.tokens[0].type === TokenType.EOF)) {
            return null;
        }
        const expr = this.parseExpression();
        if (this.peek().type !== TokenType.EOF) {
            const token = this.peek();
            throw new ParseError(`Unexpected token after expression: ${token.type} '${this.formatTokenValue(token)}'`, token.line, token.col);
        }
        return expr;
    }
}

/**
 * Parse error with location information
 */
class ParseError extends Error {
    constructor(message, line, col) {
        super(message);
        this.name = 'ParseError';
        this.line = line;
        this.col = col;
    }
}

/**
 * High-level parsing functions
 */

function tokenize(text) {
    const tokenizer = new Tokenizer(text);
    return tokenizer.tokenize();
}

function parseExpression(text) {
    const tokens = tokenize(text);
    const parser = new Parser(tokens);
    return parser.parse();
}

// Note: parseVariableDeclaration, findEquations, and findInlineEvaluations
// have been consolidated into variables.js to eliminate duplication.
// Use parseVariableLine, findEquations, findInlineEvaluations from variables.js instead.

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        TokenType, NodeType, Tokenizer, Parser, ParseError,
        tokenize, parseExpression, stripComments
    };
}
