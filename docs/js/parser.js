/**
 * MathPad Parser - Tokenizer and Expression Parser
 * Handles all MathPad syntax including operators, functions, variables, and equations
 */

// Variable type enum - determines variable behavior
const VarType = {
    INPUT: 'input',            // varname: or varname:: or varname<-
    OUTPUT: 'output',          // varname-> or varname->>
};

// Clear behavior enum - determines when a variable's value is cleared
const ClearBehavior = {
    NONE: 'none',            // : or :: (persistent, never cleared)
    ON_CLEAR: 'onClear',     // <- (cleared by Clear button)
    ON_SOLVE: 'onSolve',     // -> or ->> (cleared by Clear button AND before solving)
    ON_SOLVE_ONLY: 'onSolveOnly' // => or =>> (cleared before solving, but NOT by Clear button)
};

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
    EOF: 'EOF',
    ERROR: 'ERROR',
    // Variable declaration markers
    ARROW_LEFT: 'ARROW_LEFT',       // <-
    ARROW_LEFT_FULL: 'ARROW_LEFT_FULL', // <<-
    ARROW_RIGHT: 'ARROW_RIGHT',     // ->
    ARROW_FULL: 'ARROW_FULL',       // ->>
    ARROW_PERSIST: 'ARROW_PERSIST',           // =>
    ARROW_PERSIST_FULL: 'ARROW_PERSIST_FULL', // =>>
    DOUBLE_COLON: 'DOUBLE_COLON',   // ::
    FORMATTER: 'FORMATTER',          // $ % # (format suffixes)
    DOT_DOT: 'DOT_DOT',             // .. (range in table iterators)
    UNEXPECTED_CHAR: 'UNEXPECTED_CHAR' // unrecognized characters in input
};

// AST Node types
const NodeType = {
    NUMBER: 'NUMBER',
    VARIABLE: 'VARIABLE',
    BINARY_OP: 'BINARY_OP',
    UNARY_OP: 'UNARY_OP',
    POSTFIX_OP: 'POSTFIX_OP',
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
 * Tokenizer class - converts source text to tokens
 */
class Tokenizer {
    constructor(text) {
        this.text = text;
        this.pos = 0;
        this.line = 1;
        this.col = 1;
        this.tokens = [];
        this.pendingWs = '';
    }

    peek(offset = 0) {
        const idx = this.pos + offset;
        return idx < this.text.length ? this.text[idx] : null;
    }

    advance(count = 1) {
        let ch;
        for (let i = 0; i < count; i++) {
            ch = this.text[this.pos++];
            if (ch === '\n') {
                this.line++;
                this.col = 1;
            } else {
                this.col++;
            }
        }
        return ch;
    }

    skipWhitespace() {
        let ws = '';
        while (this.peek() && /[ \t\r]/.test(this.peek())) {
            ws += this.advance();
        }
        return ws;
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
        const token = { type, value, line: startLine, col: startCol };
        // Attach pending whitespace to token
        if (this.pendingWs) {
            token.ws = this.pendingWs;
            this.pendingWs = '';
        }
        // Marker metadata
        switch (type) {
            case TokenType.COLON:
                token.isMarker = true;
                token.varType = VarType.INPUT;
                token.clearBehavior = ClearBehavior.NONE;
                token.fullPrecision = false;
                break;
            case TokenType.DOUBLE_COLON:
                token.isMarker = true;
                token.varType = VarType.INPUT;
                token.clearBehavior = ClearBehavior.NONE;
                token.fullPrecision = true;
                break;
            case TokenType.ARROW_LEFT:
                token.isMarker = true;
                token.varType = VarType.INPUT;
                token.clearBehavior = ClearBehavior.ON_CLEAR;
                token.fullPrecision = false;
                break;
            case TokenType.ARROW_LEFT_FULL:
                token.isMarker = true;
                token.varType = VarType.INPUT;
                token.clearBehavior = ClearBehavior.ON_CLEAR;
                token.fullPrecision = true;
                break;
            case TokenType.ARROW_RIGHT:
                token.isMarker = true;
                token.varType = VarType.OUTPUT;
                token.clearBehavior = ClearBehavior.ON_SOLVE;
                token.fullPrecision = false;
                break;
            case TokenType.ARROW_FULL:
                token.isMarker = true;
                token.varType = VarType.OUTPUT;
                token.clearBehavior = ClearBehavior.ON_SOLVE;
                token.fullPrecision = true;
                break;
            case TokenType.ARROW_PERSIST:
                token.isMarker = true;
                token.varType = VarType.OUTPUT;
                token.clearBehavior = ClearBehavior.ON_SOLVE_ONLY;
                token.fullPrecision = false;
                break;
            case TokenType.ARROW_PERSIST_FULL:
                token.isMarker = true;
                token.varType = VarType.OUTPUT;
                token.clearBehavior = ClearBehavior.ON_SOLVE_ONLY;
                token.fullPrecision = true;
                break;
        }
        return token;
    }

    tokenizeNumber() {
        const startLine = this.line;
        const startCol = this.col;
        const startPos = this.pos;
        let value = '';



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
        if (baseLiteral) {
            if (baseLiteral.error) {
                const token = this.makeToken(TokenType.ERROR, baseLiteral.error, startLine, startCol);
                token.length = this.col - startCol;
                token.raw = this.text.substring(startPos, this.pos);
                return token;
            }
            return this.makeToken(TokenType.NUMBER, baseLiteral, startLine, startCol);
        }

        // Decimal point (with or without trailing digits: 1.5 and 1. are both valid)
        // But don't consume . if followed by another . (range operator: 0..4)
        if (this.peek() === '.' && this.peek(1) !== '.') {
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
                const token = this.makeToken(TokenType.ERROR, 'Invalid scientific notation', startLine, startCol);
                token.length = raw.length;
                token.raw = this.text.substring(startPos, this.pos);
                return token;
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

        // Degrees literal: 400° is just a unit marker, value stays as-is
        if (this.peek() === '°') {
            this.advance(); // consume °
            raw += '°';
            return this.makeToken(TokenType.NUMBER, { value: parseFloat(value), base: 10, raw }, startLine, startCol);
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
        if (base < 2 || base > 36) {
            return { error: `Invalid base in "${raw}" - base must be between 2 and 36` };
        }
        // Validate all digits are valid for the base (parseInt silently ignores trailing invalid chars)
        const validDigits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, base);
        if (!digits.split('').every(ch => validDigits.includes(ch.toLowerCase()))) {
            return { error: `Invalid constant "${raw}" - "${digits}" is not valid in base ${base}` };
        }
        const parsed = parseInt(digits, base);
        return { value: parsed, base, raw };
    }

    tokenizeIdentifier() {
        const startLine = this.line;
        const startCol = this.col;
        const startPos = this.pos;
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
            // Exception: \ (inline eval delimiter) is not expression context
            const lastToken = this.tokens.length > 0 ? this.tokens[this.tokens.length - 1] : null;
            if (lastToken && (lastToken.type === TokenType.OPERATOR && lastToken.value !== '\\' ||
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
                const nextCh3 = this.peek(offset + 2);
                const isMarker = nextCh === ':' || nextCh === '[' ||
                                 nextCh === '\\' ||
                                 (nextCh === '<' && nextCh2 === '<' && nextCh3 === '-') ||
                                 (nextCh === '<' && nextCh2 === '-') ||
                                 (nextCh === '-' && nextCh2 === '>') ||
                                 (nextCh === '=' && nextCh2 === '>');
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
                if (base < 2 || base > 36) {
                    const token = this.makeToken(TokenType.ERROR, `Invalid base in "${raw}" - base must be between 2 and 36`, startLine, startCol);
                    token.length = raw.length;
                    token.raw = this.text.substring(startPos, this.pos);
                    return token;
                }
                // Validate all digits are valid for the base (parseInt silently ignores trailing invalid chars)
                const validDigits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, base);
                if (!value.split('').every(ch => validDigits.includes(ch.toLowerCase()))) {
                    const token = this.makeToken(TokenType.ERROR, `Invalid constant "${raw}" - "${value}" is not valid in base ${base}`, startLine, startCol);
                    token.length = raw.length;
                    token.raw = this.text.substring(startPos, this.pos);
                    return token;
                }
                const parsed = parseInt(value, base);
                return this.makeToken(TokenType.NUMBER, { value: parsed, base, raw }, startLine, startCol);
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
            value += this.advance();
            // advance() already tracks line/col for \n characters
        }
        if (this.peek() === '"') {
            this.advance(); // closing "
        }

        return this.makeToken(TokenType.COMMENT, value, startLine, startCol);
    }

    tokenizeLineComment() {
        const startLine = this.line;
        const startCol = this.col;
        this.advance(2); // //
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
            this.advance(3);
            return this.makeToken(TokenType.ARROW_FULL, '->>', startLine, startCol);
        }

        // Three-character operator: <<-
        if (ch === '<' && ch2 === '<' && ch3 === '-') {
            this.advance(3);
            return this.makeToken(TokenType.ARROW_LEFT_FULL, '<<-', startLine, startCol);
        }

        // Two-character operators (check longer patterns first within this group)
        const twoChar = ch + (ch2 || '');

        // Variable declaration markers get their own token types
        if (twoChar === '<-') {
            this.advance(2);
            return this.makeToken(TokenType.ARROW_LEFT, '<-', startLine, startCol);
        }
        if (twoChar === '->') {
            this.advance(2);
            return this.makeToken(TokenType.ARROW_RIGHT, '->', startLine, startCol);
        }
        // Note: :: :> :>> are handled in the main tokenize() loop for COLON

        // Other two-character operators
        const twoCharOps = ['**', '==', '!=', '<=', '>=', '<<', '>>', '&&', '||', '^^'];
        if (twoCharOps.includes(twoChar)) {
            this.advance(2);
            return this.makeToken(TokenType.OPERATOR, twoChar, startLine, startCol);
        }

        // °= (degree equality — mod-aware equation operator)
        if (ch === '°' && ch2 === '=') {
            this.advance(2);
            const token = this.makeToken(TokenType.OPERATOR, '°=', startLine, startCol);
            token.modN = true;
            return token;
        }

        // Single-character operators (% is not an operator - use mod() function)
        const singleCharOps = ['+', '-', '*', '/', '&', '|', '^', '~', '!', '<', '>', '=', '?'];
        if (singleCharOps.includes(ch)) {
            this.advance();
            return this.makeToken(TokenType.OPERATOR, ch, startLine, startCol);
        }

        return null;
    }

    tokenize() {
        this.tokens = [];
        this.pendingWs = '';
        const lines = [[]];  // Token[][] — accumulate per-line arrays
        const pushToken = (token) => { this.tokens.push(token); lines[lines.length - 1].push(token); };

        while (this.pos < this.text.length) {
            const startLine = this.line;
            const startCol = this.col;
            const ch = this.peek();

            // Whitespace (not newline)
            if (/[ \t\r]/.test(ch)) {
                this.pendingWs += this.skipWhitespace();
                continue;
            }

            // Newline — start a new line array (no NEWLINE token emitted)
            if (ch === '\n') {
                this.advance();
                this.pendingWs = '';
                lines.push([]);
                continue;
            }

            // Comment in double quotes
            if (ch === '"') {
                pushToken(this.tokenizeComment());
                // Multi-line comments consume newlines — sync line arrays
                while (lines.length < this.line) {
                    lines.push([]);
                }
                continue;
            }

            // Line comment: //
            if (ch === '/' && this.peek(1) === '/') {
                pushToken(this.tokenizeLineComment());
                continue;
            }

            // Number
            if (this.isDigit(ch) || (ch === '.' && this.isDigit(this.peek(1)))) {
                pushToken(this.tokenizeNumber());
                continue;
            }

            // Identifier
            if (this.isAlpha(ch)) {
                pushToken(this.tokenizeIdentifier());
                continue;
            }

            // Parentheses
            if (ch === '(') {
                this.advance();
                pushToken(this.makeToken(TokenType.LPAREN, '(', startLine, startCol));
                continue;
            }
            if (ch === ')') {
                this.advance();
                pushToken(this.makeToken(TokenType.RPAREN, ')', startLine, startCol));
                continue;
            }

            // Brackets
            if (ch === '[') {
                this.advance();
                pushToken(this.makeToken(TokenType.LBRACKET, '[', startLine, startCol));
                continue;
            }
            if (ch === ']') {
                this.advance();
                pushToken(this.makeToken(TokenType.RBRACKET, ']', startLine, startCol));
                continue;
            }

            // Braces (equation delimiters)
            if (ch === '{') {
                this.advance();
                pushToken(this.makeToken(TokenType.LBRACE, '{', startLine, startCol));
                continue;
            }
            if (ch === '}') {
                this.advance();
                pushToken(this.makeToken(TokenType.RBRACE, '}', startLine, startCol));
                continue;
            }

            // Semicolon (argument separator)
            if (ch === ';') {
                this.advance();
                pushToken(this.makeToken(TokenType.SEMICOLON, ';', startLine, startCol));
                continue;
            }

            // Colon (variable declaration): :>> :> :: :
            if (ch === ':') {
                if (this.peek(1) === '>' && this.peek(2) === '>') {
                    this.advance(3);
                    pushToken(this.makeToken(TokenType.ARROW_PERSIST_FULL, ':>>', startLine, startCol));
                } else if (this.peek(1) === '>') {
                    this.advance(2);
                    pushToken(this.makeToken(TokenType.ARROW_PERSIST, ':>', startLine, startCol));
                } else if (this.peek(1) === ':') {
                    this.advance(2);
                    pushToken(this.makeToken(TokenType.DOUBLE_COLON, '::', startLine, startCol));
                } else {
                    this.advance();
                    pushToken(this.makeToken(TokenType.COLON, ':', startLine, startCol));
                }
                continue;
            }

            // Money literal: currency symbol + digits (e.g., $100, €1,234.56, £.01)
            if ('$€£¥₹'.includes(ch) && (this.isDigit(this.peek(1)) || (this.peek(1) === '.' && this.isDigit(this.peek(2))))) {
                this.advance(); // consume currency symbol
                const numToken = this.tokenizeNumber();
                numToken.value.raw = ch + numToken.value.raw;
                numToken.line = startLine;
                numToken.col = startCol;
                pushToken(numToken);
                continue;
            }

            // °= (degree equality — must check before ° is consumed as FORMATTER)
            if (ch === '°' && this.peek(1) === '=') {
                this.advance(2);
                const token = this.makeToken(TokenType.OPERATOR, '°=', startLine, startCol);
                token.modN = true;
                pushToken(token);
                continue;
            }

            // Format suffixes: $ (money), % (percent), ° (degrees), @d (date), @t (duration), # (base)
            if (ch === '$' || ch === '%' || ch === '°' || ch === '#' || (ch === '@' && (this.peek(1) === 'd' || this.peek(1) === 't'))) {
                // @d (date) and @t (duration) — two-char prefixes
                if (ch === '@' && (this.peek(1) === 'd' || this.peek(1) === 't')) {
                    const prefix = '@' + this.peek(1);
                    const format = this.peek(1) === 'd' ? 'date' : 'duration';
                    const p2 = this.peek(2);
                    if (p2 === '-' && this.peek(3) === '>') {
                        const type = this.peek(4) === '>' ? TokenType.ARROW_FULL : TokenType.ARROW_RIGHT;
                        const marker = type === TokenType.ARROW_FULL ? '->>' : '->';
                        this.advance(2 + marker.length);
                        const token = this.makeToken(type, prefix + marker, startLine, startCol);
                        token.format = format;
                        pushToken(token);
                        continue;
                    }
                    if (p2 === '<' && this.peek(3) === '<' && this.peek(4) === '-') {
                        this.advance(5);
                        const token = this.makeToken(TokenType.ARROW_LEFT_FULL, prefix + '<<-', startLine, startCol);
                        token.format = format;
                        pushToken(token);
                        continue;
                    }
                    if (p2 === '<' && this.peek(3) === '-') {
                        this.advance(4);
                        const token = this.makeToken(TokenType.ARROW_LEFT, prefix + '<-', startLine, startCol);
                        token.format = format;
                        pushToken(token);
                        continue;
                    }
                    if (p2 === ':') {
                        let type, marker;
                        if (this.peek(3) === '>' && this.peek(4) === '>') {
                            type = TokenType.ARROW_PERSIST_FULL; marker = ':>>';
                        } else if (this.peek(3) === '>') {
                            type = TokenType.ARROW_PERSIST; marker = ':>';
                        } else if (this.peek(3) === ':') {
                            type = TokenType.DOUBLE_COLON; marker = '::';
                        } else {
                            type = TokenType.COLON; marker = ':';
                        }
                        this.advance(2 + marker.length);
                        const token = this.makeToken(type, prefix + marker, startLine, startCol);
                        token.format = format;
                        pushToken(token);
                        continue;
                    }
                }
                // For $, %, °, check if followed by a declaration marker — merge into one token
                if (ch === '$' || ch === '%' || ch === '°') {
                    const format = ch === '$' ? 'money' : ch === '%' ? 'percent' : 'degrees';
                    const next = this.peek(1);
                    if (next === '-' && this.peek(2) === '>') {
                        const type = this.peek(3) === '>' ? TokenType.ARROW_FULL : TokenType.ARROW_RIGHT;
                        const marker = type === TokenType.ARROW_FULL ? '->>' : '->';
                        this.advance(1 + marker.length);
                        const token = this.makeToken(type, ch + marker, startLine, startCol);
                        token.format = format;
                        pushToken(token);
                        continue;
                    }
                    if (next === '<' && this.peek(2) === '<' && this.peek(3) === '-') {
                        this.advance(4);
                        const token = this.makeToken(TokenType.ARROW_LEFT_FULL, ch + '<<-', startLine, startCol);
                        token.format = format;
                        pushToken(token);
                        continue;
                    }
                    if (next === '<' && this.peek(2) === '-') {
                        this.advance(3);
                        const token = this.makeToken(TokenType.ARROW_LEFT, ch + '<-', startLine, startCol);
                        token.format = format;
                        pushToken(token);
                        continue;
                    }
                    if (next === ':') {
                        let type, marker;
                        if (this.peek(2) === '>' && this.peek(3) === '>') {
                            type = TokenType.ARROW_PERSIST_FULL; marker = ':>>';
                        } else if (this.peek(2) === '>') {
                            type = TokenType.ARROW_PERSIST; marker = ':>';
                        } else if (this.peek(2) === ':') {
                            type = TokenType.DOUBLE_COLON; marker = '::';
                        } else {
                            type = TokenType.COLON; marker = ':';
                        }
                        this.advance(1 + marker.length);
                        const token = this.makeToken(type, ch + marker, startLine, startCol);
                        token.format = format;
                        pushToken(token);
                        continue;
                    }
                } else if (ch === '#') {
                    // For #, check if followed by digits then a marker — merge #base<marker> into one token
                    let baseLen = 0;
                    while (this.isDigit(this.peek(1 + baseLen))) baseLen++;
                    if (baseLen > 0) {
                        const afterBase = 1 + baseLen;
                        const p1 = this.peek(afterBase);
                        const p2 = this.peek(afterBase + 1);
                        const p3 = this.peek(afterBase + 2);
                        let markerType = null, markerStr = null;
                        if (p1 === '-' && p2 === '>') {
                            if (p3 === '>') { markerType = TokenType.ARROW_FULL; markerStr = '->>'; }
                            else { markerType = TokenType.ARROW_RIGHT; markerStr = '->'; }
                        } else if (p1 === '<' && p2 === '<' && p3 === '-') {
                            markerType = TokenType.ARROW_LEFT_FULL;
                            markerStr = '<<-';
                        } else if (p1 === '<' && p2 === '-') {
                            markerType = TokenType.ARROW_LEFT;
                            markerStr = '<-';
                        } else if (p1 === ':') {
                            if (p2 === '>' && p3 === '>') { markerType = TokenType.ARROW_PERSIST_FULL; markerStr = ':>>'; }
                            else if (p2 === '>') { markerType = TokenType.ARROW_PERSIST; markerStr = ':>'; }
                            else if (p2 === ':') { markerType = TokenType.DOUBLE_COLON; markerStr = '::'; }
                            else { markerType = TokenType.COLON; markerStr = ':'; }
                        }
                        if (markerType) {
                            const digits = this.text.slice(this.pos + 1, this.pos + 1 + baseLen);
                            this.advance(1 + baseLen + markerStr.length);
                            const value = '#' + digits + markerStr;
                            const token = this.makeToken(markerType, value, startLine, startCol);
                            token.base = parseInt(digits);
                            pushToken(token);
                            continue;
                        }
                    }
                }
                this.advance();
                pushToken(this.makeToken(TokenType.FORMATTER, ch, startLine, startCol));
                continue;
            }

            // Range operator (..) for table iterators
            if (ch === '.' && this.peek(1) === '.') {
                this.advance(2);
                pushToken(this.makeToken(TokenType.DOT_DOT, '..', startLine, startCol));
                continue;
            }

            // Operators
            const opToken = this.tokenizeOperator();
            if (opToken) {
                pushToken(opToken);
                continue;
            }

            // Unknown character - generate error token
            this.advance();
            const unexpToken = this.makeToken(TokenType.UNEXPECTED_CHAR, `Unexpected character '${ch}'`, startLine, startCol);
            unexpToken.raw = ch;
            pushToken(unexpToken);
        }

        const eofToken = this.makeToken(TokenType.EOF, null, this.line, this.col);
        this.tokens.push(eofToken);
        lines[lines.length - 1].push(eofToken);
        return lines;
    }
}

/**
 * Parser class - builds AST from tokens
 */
class Parser {
    constructor(tokens) {
        this.tokens = tokens.filter(t => t.type !== TokenType.COMMENT);
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
            const got = token.type === TokenType.EOF ? 'end of expression' : `${token.type} '${this.formatTokenValue(token)}'`;
            throw new ParseError(`Expected ${type}${value ? ` '${value}'` : ''}, got ${got}`, token.line, token.col);
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
        return this.parsePostfix();
    }

    // Level 11: Postfix ~ ?  (x~ = pre-solve value, x~? = has pre-solve value)
    parsePostfix() {
        let expr = this.parsePrimary();
        if (this.peek().type === TokenType.OPERATOR && this.peek().value === '~') {
            this.advance();
            expr = { type: NodeType.POSTFIX_OP, op: '~', operand: expr };
        }
        if (this.peek().type === TokenType.OPERATOR && this.peek().value === '?') {
            this.advance();
            expr = { type: NodeType.POSTFIX_OP, op: '?', operand: expr };
        }
        return expr;
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

        if (token.type === TokenType.ERROR) {
            throw new ParseError(token.value, token.line, token.col);
        }
        if (token.type === TokenType.EOF) {
            throw new ParseError('Unexpected end of expression', token.line, token.col);
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
            if (token.type === TokenType.ERROR) {
                throw new ParseError(token.value, token.line, token.col);
            }
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
    const lines = tokenize(text);
    const parser = new Parser(lines.flat());
    return parser.parse();
}

function parseTokens(tokens) {
    const parser = new Parser(tokens);
    return parser.parse();
}

// Note: parseVariableDeclaration, findEquations, and findInlineEvaluations
// have been consolidated into variables.js to eliminate duplication.
// Use parseVariableLine, findEquations, findInlineEvaluations from variables.js instead.

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        VarType, ClearBehavior,
        TokenType, NodeType, Tokenizer, Parser, ParseError,
        tokenize, parseExpression, parseTokens, findLineCommentStart
    };
}
