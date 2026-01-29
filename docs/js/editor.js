/**
 * MathPad Editor - Syntax highlighting editor using shared tokenizer
 */

// Built-in function names (case-insensitive) for syntax highlighting
const editorBuiltinFunctions = new Set([
    'abs', 'sign', 'int', 'frac', 'round', 'floor', 'ceil',
    'sqrt', 'cbrt', 'root', 'exp', 'ln', 'log', 'fact', 'pi',
    'sin', 'asin', 'sinh', 'asinh', 'cos', 'acos', 'cosh', 'acosh',
    'tan', 'atan', 'tanh', 'atanh', 'radians', 'degrees',
    'now', 'days', 'jdays', 'date', 'jdate', 'year', 'month', 'day',
    'weekday', 'hour', 'minute', 'second', 'hours', 'hms',
    'if', 'choose', 'min', 'max', 'avg', 'sum', 'rand'
]);

/**
 * Convert parser tokens to editor highlight tokens
 * Uses the shared Tokenizer from parser.js and maps to highlight types
 */
function tokenizeMathPad(text) {
    // Use the shared Tokenizer from parser.js
    const tokenizer = new Tokenizer(text);
    const parserTokens = tokenizer.tokenize();

    const tokens = [];
    let pos = 0;

    for (const token of parserTokens) {
        // Skip EOF token
        if (token.type === TokenType.EOF) continue;

        // Calculate position from line/col (need to track position)
        // Since Tokenizer doesn't give us absolute positions directly,
        // we'll calculate them from the token values
        const tokenStart = findTokenPosition(text, token, pos);
        if (tokenStart === -1) continue;

        const tokenLength = getTokenLength(token, text, tokenStart);
        const tokenEnd = tokenStart + tokenLength;

        // Map token types to highlight types
        let highlightType;
        switch (token.type) {
            case TokenType.NUMBER:
                highlightType = 'number';
                break;
            case TokenType.IDENTIFIER:
                highlightType = getIdentifierHighlightType(token.value, text, tokenEnd);
                break;
            case TokenType.OPERATOR:
                highlightType = 'operator';
                break;
            case TokenType.LPAREN:
            case TokenType.RPAREN:
                highlightType = 'paren';
                break;
            case TokenType.LBRACKET:
            case TokenType.RBRACKET:
                highlightType = 'bracket';
                break;
            case TokenType.LBRACE:
            case TokenType.RBRACE:
                highlightType = 'brace';
                break;
            case TokenType.COMMENT:
                highlightType = 'comment';
                break;
            case TokenType.COLON:
            case TokenType.SEMICOLON:
                highlightType = 'punctuation';
                break;
            case TokenType.NEWLINE:
                pos = tokenEnd;
                continue; // Don't add newlines to highlight tokens
            default:
                highlightType = 'punctuation';
        }

        // Check for inline evaluation marker (backslash)
        if (token.type === TokenType.OPERATOR && token.value === '\\') {
            highlightType = 'inline-marker';
        }

        tokens.push({ from: tokenStart, to: tokenEnd, type: highlightType });
        pos = tokenEnd;
    }

    return tokens;
}

/**
 * Find the position of a token in the text
 */
function findTokenPosition(text, token, startFrom) {
    // For most tokens, we can find them by their value
    let searchValue;
    if (token.type === TokenType.NUMBER) {
        searchValue = token.value.raw || String(token.value.value);
    } else if (token.type === TokenType.COMMENT) {
        searchValue = '"' + token.value + '"';
    } else if (token.type === TokenType.NEWLINE) {
        return text.indexOf('\n', startFrom);
    } else {
        searchValue = token.value;
    }

    if (!searchValue) return startFrom;

    // Skip whitespace to find the token
    let pos = startFrom;
    while (pos < text.length && /\s/.test(text[pos])) {
        pos++;
    }

    // Look for the token value
    const idx = text.indexOf(searchValue, pos);
    return idx >= startFrom ? idx : -1;
}

/**
 * Get the length of a token in the source text
 */
function getTokenLength(token, text, start) {
    if (token.type === TokenType.NUMBER) {
        return (token.value.raw || String(token.value.value)).length;
    } else if (token.type === TokenType.COMMENT) {
        return token.value.length + 2; // Include quotes
    } else if (token.type === TokenType.NEWLINE) {
        return 1;
    } else if (token.value) {
        return token.value.length;
    }
    return 1;
}

/**
 * Determine highlight type for an identifier
 */
function getIdentifierHighlightType(name, text, tokenEnd) {
    const nameLower = name.toLowerCase();

    // Look ahead for ( to detect function calls
    let lookAhead = tokenEnd;
    while (lookAhead < text.length && (text[lookAhead] === ' ' || text[lookAhead] === '\t')) {
        lookAhead++;
    }

    if (lookAhead < text.length && text[lookAhead] === '(') {
        return editorBuiltinFunctions.has(nameLower) ? 'builtin' : 'function';
    }

    // Check if this is a variable declaration
    const nextChars = text.slice(lookAhead, lookAhead + 3);
    if (nextChars.startsWith(':') || nextChars.startsWith('<-') ||
        nextChars.startsWith('->') || nextChars.startsWith('?:') ||
        nextChars.startsWith('#') || nextChars.startsWith('[')) {
        return 'variable-def';
    }

    return 'variable';
}

/**
 * Create a simple CodeMirror-like editor using a contenteditable div with highlighting
 * This is a fallback for when CodeMirror is not available
 */
class SimpleEditor {
    constructor(container, options = {}) {
        this.container = container;
        this.options = options;
        this.changeListeners = [];

        this.element = document.createElement('div');
        this.element.className = 'simple-editor';

        // Line numbers
        this.lineNumbers = document.createElement('div');
        this.lineNumbers.className = 'line-numbers';

        // Editor area with highlighting layer and text area
        this.editorArea = document.createElement('div');
        this.editorArea.className = 'editor-area';

        this.highlightLayer = document.createElement('div');
        this.highlightLayer.className = 'highlight-layer';

        this.textarea = document.createElement('textarea');
        this.textarea.className = 'editor-textarea';
        this.textarea.spellcheck = false;
        this.textarea.value = options.value || '';

        // Hidden element to measure line heights
        this.measureElement = document.createElement('div');
        this.measureElement.className = 'editor-measure';
        this.measureElement.setAttribute('aria-hidden', 'true');

        this.editorArea.appendChild(this.highlightLayer);
        this.editorArea.appendChild(this.textarea);
        this.editorArea.appendChild(this.measureElement);

        this.element.appendChild(this.lineNumbers);
        this.element.appendChild(this.editorArea);

        container.appendChild(this.element);

        // Event handlers
        this.textarea.addEventListener('input', () => this.onInput());
        this.textarea.addEventListener('scroll', () => this.onScroll());
        this.textarea.addEventListener('keydown', (e) => this.onKeyDown(e));
        this.textarea.addEventListener('focus', () => {
            // Scroll into view after keyboard appears on mobile
            // Only scroll if still focused (skip for programmatic focus/blur)
            setTimeout(() => {
                if (document.activeElement === this.textarea) {
                    this.textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 300);
        });

        // Update line numbers on resize (affects wrapping)
        this.resizeObserver = new ResizeObserver(() => this.updateLineNumbers());
        this.resizeObserver.observe(this.editorArea);

        // Initial render
        this.updateHighlighting();
        this.updateLineNumbers();
    }

    getValue() {
        return this.textarea.value;
    }

    setValue(value, undoable = false) {
        if (undoable) {
            // Use execCommand to make the change undoable with Ctrl+Z
            this.textarea.focus();
            this.textarea.select();
            document.execCommand('insertText', false, value);
        } else {
            this.textarea.value = value;
        }
        this.updateHighlighting();
        this.updateLineNumbers();
    }

    onInput() {
        this.updateHighlighting();
        this.updateLineNumbers();
        this.notifyChange();
    }

    onScroll() {
        this.highlightLayer.scrollTop = this.textarea.scrollTop;
        this.highlightLayer.scrollLeft = this.textarea.scrollLeft;
        this.lineNumbers.scrollTop = this.textarea.scrollTop;
    }

    onKeyDown(e) {
        // Tab handling
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = this.textarea.selectionStart;
            const end = this.textarea.selectionEnd;
            const value = this.textarea.value;

            this.textarea.value = value.substring(0, start) + '  ' + value.substring(end);
            this.textarea.selectionStart = this.textarea.selectionEnd = start + 2;
            this.onInput();
        }
    }

    updateHighlighting() {
        const text = this.textarea.value;
        const tokens = tokenizeMathPad(text);

        let html = '';
        let lastPos = 0;

        for (const token of tokens) {
            // Add unhighlighted text before this token
            if (token.from > lastPos) {
                html += escapeHtml(text.slice(lastPos, token.from));
            }

            // Add highlighted token
            const tokenText = escapeHtml(text.slice(token.from, token.to));
            html += `<span class="tok-${token.type}">${tokenText}</span>`;
            lastPos = token.to;
        }

        // Add remaining text
        if (lastPos < text.length) {
            html += escapeHtml(text.slice(lastPos));
        }

        // Ensure the highlight layer has the same whitespace handling
        this.highlightLayer.innerHTML = html + '\n'; // Extra newline for scrolling
    }

    updateLineNumbers() {
        const lines = this.textarea.value.split('\n');
        let html = '';

        // Measure each line's rendered height to handle wrapping
        for (let i = 0; i < lines.length; i++) {
            // Use non-breaking space for empty lines to get correct height
            this.measureElement.textContent = lines[i] || '\u00A0';
            const height = this.measureElement.offsetHeight;
            html += `<div class="line-number" style="height:${height}px">${i + 1}</div>`;
        }
        this.lineNumbers.innerHTML = html;
    }

    onChange(callback) {
        this.changeListeners.push(callback);
    }

    notifyChange() {
        for (const listener of this.changeListeners) {
            listener(this.getValue());
        }
    }

    focus() {
        this.textarea.focus();
    }

    getCursorPosition() {
        return this.textarea.selectionStart;
    }

    setCursorPosition(pos) {
        this.textarea.selectionStart = this.textarea.selectionEnd = pos;
    }

    getSelection() {
        return {
            start: this.textarea.selectionStart,
            end: this.textarea.selectionEnd
        };
    }

    setSelection(start, end) {
        this.textarea.selectionStart = start;
        this.textarea.selectionEnd = end;
    }

    insertText(text, pos = null) {
        if (pos === null) {
            pos = this.textarea.selectionStart;
        }
        const value = this.textarea.value;
        this.textarea.value = value.substring(0, pos) + text + value.substring(pos);
        this.textarea.selectionStart = this.textarea.selectionEnd = pos + text.length;
        this.onInput();
    }

    replaceSelection(text) {
        const start = this.textarea.selectionStart;
        const end = this.textarea.selectionEnd;
        const value = this.textarea.value;
        this.textarea.value = value.substring(0, start) + text + value.substring(end);
        this.textarea.selectionStart = this.textarea.selectionEnd = start + text.length;
        this.onInput();
    }

    // Highlight a range (for errors)
    highlightError(from, to) {
        // For now, just select the range
        this.textarea.focus();
        this.textarea.setSelectionRange(from, to);
    }

    clearErrorHighlight() {
        // Nothing needed for basic implementation
    }
}

/**
 * Helper: escape HTML
 */
function escapeHtml(text) {
    // Note: Don't replace spaces with &nbsp; - with white-space: pre-wrap,
    // regular spaces are preserved AND allow wrapping at the same points as textarea
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/\n/g, '<br>');
}

/**
 * Create an editor instance
 * Will use CodeMirror if available, otherwise falls back to SimpleEditor
 */
function createEditor(container, options = {}) {
    // For now, always use SimpleEditor
    // CodeMirror 6 can be added later if needed
    return new SimpleEditor(container, options);
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        tokenizeMathPad, SimpleEditor, createEditor, escapeHtml
    };
}
