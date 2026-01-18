/**
 * MathPad Editor - CodeMirror 6 setup with custom syntax highlighting
 */

// Import CodeMirror modules (these will be loaded from CDN)
// We'll use the global imports approach since this is a browser app

/**
 * MathPad language tokenizer for CodeMirror
 * Returns an array of tokens with {from, to, type} for highlighting
 */
function tokenizeMathPad(text) {
    const tokens = [];
    let pos = 0;
    const len = text.length;

    // Built-in function names (case-insensitive)
    const builtinFunctions = new Set([
        'abs', 'sign', 'int', 'frac', 'round', 'floor', 'ceil',
        'sqrt', 'cbrt', 'root', 'exp', 'ln', 'log', 'fact', 'pi',
        'sin', 'asin', 'sinh', 'asinh', 'cos', 'acos', 'cosh', 'acosh',
        'tan', 'atan', 'tanh', 'atanh', 'radians', 'degrees',
        'now', 'days', 'jdays', 'date', 'jdate', 'year', 'month', 'day',
        'weekday', 'hour', 'minute', 'second', 'hours', 'hms',
        'if', 'choose', 'min', 'max', 'avg', 'sum', 'rand'
    ]);

    function isDigit(ch) {
        return ch >= '0' && ch <= '9';
    }

    function isAlpha(ch) {
        return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
    }

    function isAlphaNum(ch) {
        return isAlpha(ch) || isDigit(ch);
    }

    function isHexDigit(ch) {
        return isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
    }

    while (pos < len) {
        const start = pos;
        const ch = text[pos];

        // Whitespace and newlines
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
            pos++;
            continue;
        }

        // Comments in double quotes
        if (ch === '"') {
            pos++;
            while (pos < len && text[pos] !== '"' && text[pos] !== '\n') {
                pos++;
            }
            if (pos < len && text[pos] === '"') {
                pos++;
            }
            tokens.push({ from: start, to: pos, type: 'comment' });
            continue;
        }

        // Numbers
        if (isDigit(ch) || (ch === '.' && pos + 1 < len && isDigit(text[pos + 1]))) {
            // Check for hex, binary, octal
            if (ch === '0' && pos + 1 < len) {
                const prefix = text[pos + 1].toLowerCase();
                if (prefix === 'x') {
                    pos += 2;
                    while (pos < len && isHexDigit(text[pos])) pos++;
                    tokens.push({ from: start, to: pos, type: 'number' });
                    continue;
                } else if (prefix === 'b') {
                    pos += 2;
                    while (pos < len && (text[pos] === '0' || text[pos] === '1')) pos++;
                    tokens.push({ from: start, to: pos, type: 'number' });
                    continue;
                } else if (prefix === 'o') {
                    pos += 2;
                    while (pos < len && text[pos] >= '0' && text[pos] <= '7') pos++;
                    tokens.push({ from: start, to: pos, type: 'number' });
                    continue;
                }
            }

            // Regular decimal number
            while (pos < len && isDigit(text[pos])) pos++;
            if (pos < len && text[pos] === '.') {
                pos++;
                while (pos < len && isDigit(text[pos])) pos++;
            }
            // Scientific notation
            if (pos < len && (text[pos] === 'e' || text[pos] === 'E')) {
                pos++;
                if (pos < len && (text[pos] === '+' || text[pos] === '-')) pos++;
                while (pos < len && isDigit(text[pos])) pos++;
            }
            tokens.push({ from: start, to: pos, type: 'number' });
            continue;
        }

        // Identifiers and keywords
        if (isAlpha(ch)) {
            while (pos < len && isAlphaNum(text[pos])) pos++;
            const word = text.slice(start, pos);
            const wordLower = word.toLowerCase();

            // Check if followed by ( for function call
            let lookAhead = pos;
            while (lookAhead < len && (text[lookAhead] === ' ' || text[lookAhead] === '\t')) {
                lookAhead++;
            }

            if (builtinFunctions.has(wordLower) && lookAhead < len && text[lookAhead] === '(') {
                tokens.push({ from: start, to: pos, type: 'builtin' });
            } else if (lookAhead < len && text[lookAhead] === '(') {
                tokens.push({ from: start, to: pos, type: 'function' });
            } else {
                // Check if this is a variable declaration
                while (lookAhead < len && (text[lookAhead] === ' ' || text[lookAhead] === '\t')) {
                    lookAhead++;
                }
                const nextTwo = text.slice(lookAhead, lookAhead + 3);
                if (nextTwo.startsWith(':') || nextTwo.startsWith('<-') ||
                    nextTwo.startsWith('->') || nextTwo.startsWith('?:') ||
                    nextTwo.startsWith('#')) {
                    tokens.push({ from: start, to: pos, type: 'variable-def' });
                } else {
                    tokens.push({ from: start, to: pos, type: 'variable' });
                }
            }
            continue;
        }

        // Operators
        const twoChar = text.slice(pos, pos + 2);
        const threeChar = text.slice(pos, pos + 3);

        if (threeChar === '->>') {
            tokens.push({ from: start, to: pos + 3, type: 'operator' });
            pos += 3;
            continue;
        }

        if (['**', '==', '!=', '<=', '>=', '<<', '>>', '&&', '||', '^^', '<-', '->', '::'].includes(twoChar)) {
            tokens.push({ from: start, to: pos + 2, type: 'operator' });
            pos += 2;
            continue;
        }

        if (['+', '-', '*', '/', '%', '&', '|', '^', '~', '!', '<', '>', '='].includes(ch)) {
            tokens.push({ from: start, to: pos + 1, type: 'operator' });
            pos++;
            continue;
        }

        // Brackets and braces
        if (ch === '(' || ch === ')') {
            tokens.push({ from: start, to: pos + 1, type: 'paren' });
            pos++;
            continue;
        }

        if (ch === '[' || ch === ']') {
            tokens.push({ from: start, to: pos + 1, type: 'bracket' });
            pos++;
            continue;
        }

        if (ch === '{' || ch === '}') {
            tokens.push({ from: start, to: pos + 1, type: 'brace' });
            pos++;
            continue;
        }

        // Punctuation
        if (ch === ';' || ch === ':' || ch === '?' || ch === '#') {
            tokens.push({ from: start, to: pos + 1, type: 'punctuation' });
            pos++;
            continue;
        }

        // Inline evaluation markers
        if (ch === '\\') {
            tokens.push({ from: start, to: pos + 1, type: 'inline-marker' });
            pos++;
            continue;
        }

        // Unknown - skip
        pos++;
    }

    return tokens;
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

        this.editorArea.appendChild(this.highlightLayer);
        this.editorArea.appendChild(this.textarea);

        this.element.appendChild(this.lineNumbers);
        this.element.appendChild(this.editorArea);

        container.appendChild(this.element);

        // Event handlers
        this.textarea.addEventListener('input', () => this.onInput());
        this.textarea.addEventListener('scroll', () => this.onScroll());
        this.textarea.addEventListener('keydown', (e) => this.onKeyDown(e));

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
        for (let i = 1; i <= lines.length; i++) {
            html += `<div class="line-number">${i}</div>`;
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
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/ /g, '&nbsp;')
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
