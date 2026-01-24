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
    ERROR: 'ERROR'
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

        // Note: Base prefixes (0x, 0b, 0o) and suffix notation (value#base) are
        // expanded to decimal by expandLiterals() before parsing, so we only
        // need to handle decimal numbers here.

        // Decimal number (possibly floating point with scientific notation)
        // Allow commas as digit grouping (ignored)
        while (this.isDigit(this.peek()) || this.peek() === ',') {
            const ch = this.advance();
            if (ch !== ',') value += ch;  // Skip commas
        }

        // Decimal point
        if (this.peek() === '.' && this.isDigit(this.peek(1))) {
            value += this.advance(); // .
            while (this.isDigit(this.peek())) {
                value += this.advance();
            }
        }

        // Scientific notation
        if (this.peek() && /[eE]/.test(this.peek())) {
            value += this.advance(); // e or E
            if (this.peek() === '+' || this.peek() === '-') {
                value += this.advance();
            }
            if (!this.isDigit(this.peek())) {
                return this.makeToken(TokenType.ERROR, 'Invalid scientific notation', startLine, startCol);
            }
            while (this.isDigit(this.peek())) {
                value += this.advance();
            }
        }

        return this.makeToken(TokenType.NUMBER, { value: parseFloat(value), base: 10, raw: value }, startLine, startCol);
    }

    tokenizeIdentifier() {
        const startLine = this.line;
        const startCol = this.col;
        let value = '';

        while (this.isAlphaNum(this.peek())) {
            value += this.advance();
        }

        // Allow $ or % suffix for money/percentage variable names
        if (this.peek() === '$' || this.peek() === '%') {
            value += this.advance();
        }

        return this.makeToken(TokenType.IDENTIFIER, value, startLine, startCol);
    }

    tokenizeComment() {
        const startLine = this.line;
        const startCol = this.col;
        let value = '';

        this.advance(); // opening "
        while (this.peek() && this.peek() !== '"' && this.peek() !== '\n') {
            value += this.advance();
        }
        if (this.peek() === '"') {
            this.advance(); // closing "
        }

        return this.makeToken(TokenType.COMMENT, value, startLine, startCol);
    }

    tokenizeOperator() {
        const startLine = this.line;
        const startCol = this.col;
        const ch = this.peek();
        const ch2 = this.peek(1);

        // Two-character operators
        const twoChar = ch + (ch2 || '');
        const twoCharOps = ['**', '==', '!=', '<=', '>=', '<<', '>>', '&&', '||', '^^', '<-', '->', '::', '>>', '->'];

        if (twoCharOps.includes(twoChar)) {
            this.advance();
            this.advance();
            return this.makeToken(TokenType.OPERATOR, twoChar, startLine, startCol);
        }

        // Check for ->> (three char)
        if (ch === '-' && ch2 === '>' && this.peek(2) === '>') {
            this.advance();
            this.advance();
            this.advance();
            return this.makeToken(TokenType.OPERATOR, '->>', startLine, startCol);
        }

        // Single-character operators
        const singleCharOps = ['+', '-', '*', '/', '%', '&', '|', '^', '~', '!', '<', '>', '=', '?', '#', '\\'];
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
                // Check for ::
                if (this.peek(1) === ':') {
                    this.advance();
                    this.advance();
                    this.tokens.push(this.makeToken(TokenType.OPERATOR, '::', startLine, startCol));
                } else {
                    this.advance();
                    this.tokens.push(this.makeToken(TokenType.COLON, ':', startLine, startCol));
                }
                continue;
            }

            // Operators
            const opToken = this.tokenizeOperator();
            if (opToken) {
                this.tokens.push(opToken);
                continue;
            }

            // Unknown character - skip it
            this.advance();
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

    expect(type, value = null) {
        const token = this.peek();
        if (token.type !== type || (value !== null && token.value !== value)) {
            throw new ParseError(`Expected ${type}${value ? ` '${value}'` : ''}, got ${token.type} '${token.value}'`, token.line, token.col);
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

    // Level 8: * / %
    parseMultiplicative() {
        let left = this.parsePower();
        while (this.peek().type === TokenType.OPERATOR &&
               (this.peek().value === '*' || this.peek().value === '/' || this.peek().value === '%')) {
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

        throw new ParseError(`Unexpected token: ${token.type} '${token.value}'`, token.line, token.col);
    }

    parse() {
        if (this.tokens.length === 0 || (this.tokens.length === 1 && this.tokens[0].type === TokenType.EOF)) {
            return null;
        }
        const expr = this.parseExpression();
        if (this.peek().type !== TokenType.EOF) {
            const token = this.peek();
            throw new ParseError(`Unexpected token after expression: ${token.type} '${token.value}'`, token.line, token.col);
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
        tokenize, parseExpression
    };
}
