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
    'if', 'choose', 'min', 'max', 'avg', 'sum', 'rand', 'mod'
]);

/**
 * Convert parser tokens to editor highlight tokens
 * Uses the shared Tokenizer from parser.js and maps to highlight types
 * @param {string} text - The text to tokenize
 * @param {Object} options - Optional settings
 * @param {Set} options.referenceConstants - Constants from Reference section (highlighted as builtin)
 * @param {Set} options.referenceFunctions - Functions from Reference section (highlighted as builtin)
 * @param {boolean} options.shadowConstants - If true, reference constants with any marker are shadowed
 */
function tokenizeMathPad(text, options = {}) {
    const { referenceConstants = new Set(), referenceFunctions = new Set(), shadowConstants = false } = options;

    // Strip the reference section first so definitions there aren't treated as local
    const strippedText = text.replace(/\n*"--- Reference Constants and Functions ---"[\s\S]*$/, '');

    // Find user-defined functions (may shadow builtins/reference functions)
    const userDefinedFunctions = new Set(parseFunctionsRecord(strippedText).keys());

    // Find locally-defined variables (may shadow reference constants)
    // When shadowConstants is OFF: only definition markers (:, <-, ::) shadow constants
    // When shadowConstants is ON: ANY marker shadows constants (including ->, ->>)
    // Stores name -> character position where shadowing starts (top-to-bottom, matching evaluator)
    const localVariables = new Map();
    let charOffset = 0;
    for (const line of strippedText.split('\n')) {
        const decl = parseVariableLine(line);
        if (decl) {
            const isDefinitionMarker = decl.marker === ':' || decl.marker === '<-' || decl.marker === '::';
            const isOutputMarker = decl.marker === '->' || decl.marker === '->>';
            // Shadow if it's a definition, OR if shadowConstants is on and it's any marker
            if (isDefinitionMarker || (shadowConstants && isOutputMarker && referenceConstants.has(decl.name))) {
                if (!localVariables.has(decl.name)) {
                    localVariables.set(decl.name, charOffset);
                }
            }
        }
        charOffset += line.length + 1; // +1 for newline
    }

    // Tokenize first to find quoted comments (they take precedence)
    const tokenizer = new Tokenizer(text);
    const parserTokens = tokenizer.tokenize();

    // Find quoted comment regions from tokenizer
    const quotedCommentRegions = [];
    let pos = 0;
    for (const token of parserTokens) {
        if (token.type === TokenType.EOF) continue;
        const tokenStart = findTokenPosition(text, token, pos);
        if (tokenStart === -1) continue;
        const tokenLength = getTokenLength(token, text, tokenStart);
        const tokenEnd = tokenStart + tokenLength;
        if (token.type === TokenType.COMMENT) {
            quotedCommentRegions.push({ start: tokenStart, end: tokenEnd });
        }
        pos = tokenEnd;
    }

    // Helper to check if a region overlaps with quoted comments
    const overlapsQuotedComment = (start, end) =>
        quotedCommentRegions.some(r => start < r.end && end > r.start);

    // Find label/comment regions (exclude those inside quoted comments)
    const commentRegions = findLabelRegions(text).filter(
        r => !overlapsQuotedComment(r.start, r.end)
    );

    // Find literal number formats (exclude those inside quoted comments)
    const literalRegions = findLiteralRegions(text).filter(
        r => !overlapsQuotedComment(r.start, r.end)
    );

    const tokens = [];
    pos = 0;

    // Helper to check if a position overlaps with any special region
    const overlapsSpecialRegion = (start, end) =>
        commentRegions.some(r => start < r.end && end > r.start) ||
        literalRegions.some(r => start < r.end && end > r.start);

    let lastTokenWasVarDef = false;
    let lastTokenWasVar = false;
    let lastTokenWasBaseFormatter = false;  // Track # formatter for base suffix (e.g., xx#16)
    let lastTokenEnd = 0;
    let inInlineEval = false;  // Track whether we're inside \..\ inline eval markers

    for (const token of parserTokens) {
        // Skip EOF token
        if (token.type === TokenType.EOF) continue;

        const tokenStart = findTokenPosition(text, token, pos);
        if (tokenStart === -1) continue;

        const tokenLength = getTokenLength(token, text, tokenStart);
        const tokenEnd = tokenStart + tokenLength;

        // Skip tokens that overlap with special regions (we'll add those separately)
        // - Skip all tokens overlapping literal regions (literals take precedence)
        // - Skip all tokens overlapping comment regions (comments take precedence)
        const inLiteralRegion = literalRegions.some(r => tokenStart < r.end && tokenEnd > r.start);
        const inCommentRegion = commentRegions.some(r => tokenStart < r.end && tokenEnd > r.start);
        if (inLiteralRegion || inCommentRegion) {
            pos = tokenEnd;
            lastTokenWasVarDef = false;
            continue;
        }

        // Map token types to highlight types
        let highlightType;
        switch (token.type) {
            case TokenType.NUMBER:
                // Style number as variable-def if it's the base in a format suffix (e.g., 16 in xx#16)
                if (lastTokenWasBaseFormatter && tokenStart === lastTokenEnd) {
                    highlightType = 'variable-def';
                } else {
                    highlightType = 'number';
                }
                break;
            case TokenType.IDENTIFIER:
                highlightType = getIdentifierHighlightType(token.value, text, tokenStart, tokenEnd, userDefinedFunctions, commentRegions, referenceConstants, referenceFunctions, localVariables);
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
                lastTokenWasVarDef = false;
                lastTokenWasVar = false;
                lastTokenWasBaseFormatter = false;
                inInlineEval = false;
                continue;
            case TokenType.FORMATTER:
                // Style $, %, # to match the preceding identifier only in declaration or inline eval context
                if (lastTokenWasVarDef && tokenStart === lastTokenEnd) {
                    highlightType = 'variable-def';
                } else if (inInlineEval && lastTokenWasVar && tokenStart === lastTokenEnd) {
                    highlightType = 'variable'; // format suffix in inline eval (\a$\, \a%\, \a#16\)
                } else {
                    highlightType = 'error'; // formatter in expression context is a syntax error
                }
                break;
            case TokenType.ERROR:
                highlightType = 'error';
                break;
            default:
                highlightType = 'punctuation';
        }

        // Check for inline evaluation marker (backslash)
        if (token.type === TokenType.OPERATOR && token.value === '\\') {
            highlightType = 'inline-marker';
            inInlineEval = !inInlineEval;
        }

        // Track if this token is a variable-def or variable for styling following $ or % or #
        lastTokenWasVarDef = (highlightType === 'variable-def');
        lastTokenWasVar = (highlightType === 'variable');
        // Track if this is a # formatter for styling following base number (e.g., 16 in xx#16)
        lastTokenWasBaseFormatter = (token.type === TokenType.FORMATTER && token.value === '#' && highlightType === 'variable-def');
        lastTokenEnd = tokenEnd;

        tokens.push({ from: tokenStart, to: tokenEnd, type: highlightType });
        pos = tokenEnd;
    }

    // Add comment regions as single comment tokens
    // Skip if overlapping with existing tokens (but regular numbers in comments were already skipped)
    for (const region of commentRegions) {
        const overlapsExisting = tokens.some(t =>
            region.start < t.to && region.end > t.from);
        if (!overlapsExisting) {
            tokens.push({ from: region.start, to: region.end, type: 'comment' });
        }
    }

    // Add literal regions as number tokens (skip if overlapping with existing tokens or comments)
    for (const region of literalRegions) {
        const inComment = commentRegions.some(c => region.start >= c.start && region.end <= c.end);
        const overlapsToken = tokens.some(t => region.start < t.to && region.end > t.from);
        if (!inComment && !overlapsToken) {
            tokens.push({ from: region.start, to: region.end, type: 'number' });
        }
    }

    // Sort tokens by position
    tokens.sort((a, b) => a.from - b.from);

    return tokens;
}

/**
 * Find label regions in the text using LineParser
 * Returns array of { start, end } for each label region (absolute positions)
 */
function findLabelRegions(text) {
    const lines = text.split('\n');
    const regions = [];
    let lineStart = 0;
    let insideBrace = false;  // Track if we're inside a multi-line braced equation

    for (const line of lines) {
        // Count braces to track multi-line braced equations
        const openBraces = (line.match(/\{/g) || []).length;
        const closeBraces = (line.match(/\}/g) || []).length;
        const hadOpenBrace = insideBrace;

        // Update brace state
        if (openBraces > closeBraces) {
            insideBrace = true;
        } else if (closeBraces > openBraces) {
            insideBrace = false;
        }

        // If we're inside a brace (continuation line), don't treat as label
        // But we still need to find label text after the closing brace
        if (hadOpenBrace && !line.includes('{')) {
            // This is a continuation line inside braces
            // Check if this line has the closing brace with trailing text
            const closeBracePos = line.indexOf('}');
            if (closeBracePos >= 0) {
                // Everything after the closing brace is label text
                const afterBrace = closeBracePos + 1;
                if (afterBrace < line.length && line.slice(afterBrace).trim()) {
                    regions.push({
                        start: lineStart + afterBrace,
                        end: lineStart + line.length
                    });
                }
            }
            lineStart += line.length + 1;
            continue;
        }

        // Use LineParser to parse the line
        const parser = new LineParser(line);
        const result = parser.parse();

        if (result && result.kind === 'declaration') {
            // For declarations, label is everything before the variable
            const markerInfo = parser.findBestMarker();
            if (markerInfo) {
                const varInfo = parser.getImmediateVarBeforeMarker(markerInfo.index);
                if (varInfo && varInfo.varStartPos > 0) {
                    regions.push({
                        start: lineStart,
                        end: lineStart + varInfo.varStartPos
                    });
                }
            }
        } else if (result && result.kind === 'expression-output' && result.expression) {
            // For expression outputs, label is everything before where the expression starts
            const exprStart = line.indexOf(result.expression);
            if (exprStart > 0) {
                regions.push({
                    start: lineStart,
                    end: lineStart + exprStart
                });
            }
        } else if (!result && line.includes('=')) {
            // Equation line - find label text before and after the equation
            // For braced equations like "This is a fn: { xmin(a;b) = ", everything before { is label
            if (line.includes('{')) {
                const bracePos = line.indexOf('{');
                // Everything before the opening brace is label text
                if (bracePos > 0) {
                    regions.push({
                        start: lineStart,
                        end: lineStart + bracePos
                    });
                }
            } else {
                const eqRegions = findEquationLabelRegions(line);
                for (const r of eqRegions) {
                    regions.push({
                        start: lineStart + r.start,
                        end: lineStart + r.end
                    });
                }
            }
        } else if (!result && line.trim() && !insideBrace) {
            // Plain text line (no markers, no equation, not inside brace) - entire line is comment
            regions.push({
                start: lineStart,
                end: lineStart + line.length
            });
        }

        // Handle unquoted trailing comments (for both declarations and expression outputs)
        if (result && result.comment && result.commentUnquoted) {
            const commentStart = line.lastIndexOf(result.comment);
            if (commentStart > 0) {
                regions.push({
                    start: lineStart + commentStart,
                    end: lineStart + commentStart + result.comment.length
                });
            }
        }

        lineStart += line.length + 1; // +1 for newline
    }

    return regions;
}

/**
 * Find label text regions in an equation line
 * For "equation c = a + b test", returns regions for "equation " and " test"
 * Uses extractEquationFromLine from variables.js
 */
function findEquationLabelRegions(line) {
    const regions = [];

    // Use the existing function to extract the valid equation
    const extracted = extractEquationFromLine(line);

    // If extraction returned the same line, no label text
    if (extracted === line) return regions;

    // Find where the extracted equation appears in the original line
    const eqStart = line.indexOf(extracted);
    if (eqStart === -1) return regions;

    // Everything before the equation is label text
    if (eqStart > 0) {
        regions.push({ start: 0, end: eqStart });
    }

    // Everything after the equation is label text
    const eqEnd = eqStart + extracted.length;
    if (eqEnd < line.length) {
        regions.push({ start: eqEnd, end: line.length });
    }

    return regions;
}

/**
 * Find literal number formats that the tokenizer doesn't handle natively
 * Returns array of { start, end } for each literal region
 * Handles: FF#16, 0xFF, 0b101, 0o77, $607, -$607
 *
 * Note: Percent literals (5%) and special values (NaN, Infinity) are handled
 * by the tokenizer directly as NUMBER tokens - simpler than regex + expandLiterals().
 * Other literals produce multiple tokens (e.g. $100 → FORMATTER + NUMBER) so we
 * use regex here to highlight them as unified number regions.
 */
function findLiteralRegions(text) {
    const regions = [];

    const patterns = [
        /0[xX][0-9a-fA-F]+/g,                      // hex (0xFF)
        /0[bB][01]+/g,                             // binary (0b101)
        /0[oO][0-7]+/g,                            // octal (0o77)
        /-?\$[\d,]*\.?\d+/g,                         // money (-$607, $1,234.56, $.01)
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            regions.push({ start: match.index, end: match.index + match[0].length });
        }
    }

    // Base literals (ff#16, 7v#32) need context-aware matching:
    // - If starts with digit, it's always a literal (can't be a variable name)
    // - If starts with letter and followed by a marker (-> <- : ::), it's a variable with format suffix
    // - Otherwise, it's a literal value
    const baseLiteralPattern = /[a-zA-Z0-9][a-zA-Z0-9]*#[0-9]+/g;
    const markerPattern = /^\s*(<-|->|::|:|=)/;
    let match;
    while ((match = baseLiteralPattern.exec(text)) !== null) {
        const firstChar = match[0][0];
        // If starts with digit, always a literal (can't be a variable name)
        if (/[0-9]/.test(firstChar)) {
            regions.push({ start: match.index, end: match.index + match[0].length });
            continue;
        }
        // Starts with letter - check if followed by a marker (variable declaration)
        // But if preceded by an operator, it's a literal in expression context (e.g., f#16+f#32->)
        const afterMatch = text.slice(match.index + match[0].length);
        if (markerPattern.test(afterMatch)) {
            const charBefore = match.index > 0 ? text[match.index - 1] : '';
            if (!/[+\-*\/^(,;]/.test(charBefore)) {
                continue;
            }
        }
        regions.push({ start: match.index, end: match.index + match[0].length });
    }

    return regions;
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
        searchValue = token.lineComment ? '//' + token.value : '"' + token.value + '"';
    } else if (token.type === TokenType.NEWLINE) {
        return text.indexOf('\n', startFrom);
    } else if (token.type === TokenType.ERROR) {
        // Extract the actual character from error message like "Unexpected character '$'"
        const match = token.value.match(/character '(.)'/);
        searchValue = match ? match[1] : null;
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
    } else if (token.type === TokenType.ERROR) {
        return 1; // ERROR tokens are single unknown characters
    } else if (token.value) {
        return token.value.length;
    }
    return 1;
}

/**
 * Determine highlight type for an identifier
 */
function getIdentifierHighlightType(name, text, tokenStart, tokenEnd, userDefinedFunctions, commentRegions = [], referenceConstants = new Set(), referenceFunctions = new Set(), localVariables = new Map()) {
    const nameLower = name.toLowerCase();

    // Check if a local variable shadows a constant at this position
    // localVariables maps name -> character position where shadowing starts
    function isShadowed(varName) {
        const shadowPos = localVariables.get(varName);
        return shadowPos !== undefined && tokenStart >= shadowPos;
    }

    // Look ahead for ( to detect function calls
    let lookAhead = tokenEnd;
    while (lookAhead < text.length && (text[lookAhead] === ' ' || text[lookAhead] === '\t')) {
        lookAhead++;
    }

    if (lookAhead < text.length && text[lookAhead] === '(') {
        // User-defined functions (local) override everything
        if (userDefinedFunctions && userDefinedFunctions.has(nameLower)) {
            return 'function';
        }
        // Reference functions and builtins both use 'builtin' style
        if (referenceFunctions.has(nameLower) || editorBuiltinFunctions.has(nameLower)) {
            return 'builtin';
        }
        return 'function';
    }

    // Check if this is a variable declaration
    // Account for $ or % suffix before the marker
    let checkPos = lookAhead;
    if (checkPos < text.length && (text[checkPos] === '$' || text[checkPos] === '%')) {
        checkPos++;
        // Skip whitespace after suffix
        while (checkPos < text.length && (text[checkPos] === ' ' || text[checkPos] === '\t')) {
            checkPos++;
        }
    }
    const nextChars = text.slice(checkPos, checkPos + 3);
    if (nextChars.startsWith(':') || nextChars.startsWith('<-') ||
        nextChars.startsWith('->') || nextChars.startsWith('?:') ||
        nextChars.startsWith('#') || nextChars.startsWith('[')) {
        // Check if this is part of an expression (has operator before it)
        // If so, it's not a variable-def, just a variable in an expression output
        let lookBack = tokenStart - 1;
        while (lookBack >= 0 && (text[lookBack] === ' ' || text[lookBack] === '\t')) {
            lookBack--;
        }
        if (lookBack >= 0) {
            const charBefore = text[lookBack];
            // If preceded by operator or closing paren/bracket, it's part of an expression
            // But only if that character is NOT in a comment region (e.g., label text)
            if ('+-*/%^)]=<>!&|~'.includes(charBefore)) {
                const charPos = lookBack;
                const inCommentRegion = commentRegions.some(r => charPos >= r.start && charPos < r.end);
                if (!inCommentRegion) {
                    // Check if it's a reference constant (not shadowed by local variable)
                    if (referenceConstants.has(name) && !isShadowed(name)) {
                        return 'builtin';
                    }
                    return 'variable';
                }
            }
        }
        // Check if it's a reference constant being output (not shadowed)
        // e.g., "pi->" should highlight pi as builtin, not variable-def
        if (referenceConstants.has(name) && !isShadowed(name)) {
            return 'builtin';
        }
        return 'variable-def';
    }

    // Check if it's a reference constant (not shadowed by local variable)
    if (referenceConstants.has(name) && !isShadowed(name)) {
        return 'builtin';
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
        this.scrollListeners = [];
        this.referenceConstants = new Set();
        this.referenceFunctions = new Set();

        // Custom undo/redo history (browser's native undo is unreliable across tab switches)
        this.undoStack = [];
        this.redoStack = [];
        this.maxUndoHistory = 100;
        this.undoDebounceTimer = null;
        this.lastSavedState = null;

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
        this.textarea.setAttribute('autocapitalize', 'none');
        this.textarea.setAttribute('autocorrect', 'off');
        this.textarea.autocomplete = 'off';
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
        this.textarea.addEventListener('scroll', () => this.onUserScroll());
        this.textarea.addEventListener('keydown', (e) => this.onKeyDown(e));

        // Mobile keyboard handling - resize editor to fit visible viewport
        this.isAdjustedForKeyboard = false;
        this.originalVariablesHeight = null;
        this.viewportHandler = null;
        this._userInitiatedFocus = false;

        // Track user-initiated focus (touch, click, mousedown)
        // Two flags: _userTouched is ephemeral (cleared on focus), _userInitiatedFocus persists until blur
        this._userTouched = false;
        this.textarea.addEventListener('mousedown', () => {
            this._userTouched = true;
        });
        this.textarea.addEventListener('touchstart', () => {
            this._userTouched = true;
        });

        this.textarea.addEventListener('focus', () => {
            // Confirm user touch led to focus, then clear the ephemeral flag
            this._userInitiatedFocus = this._userTouched;
            if (this._userTouched) {
                this._userTouched = false;
                // adjust for keyboard in case keyboard is already active
                this.adjustForKeyboard();
            }
        });

        this.textarea.addEventListener('blur', () => {
            this._userInitiatedFocus = false;
            this.restoreHeight();
        });

        // Listen for viewport changes (keyboard resize, rotation)
        if (window.visualViewport) {
            this.viewportHandler = () => {
                if (document.activeElement === this.textarea && this._userInitiatedFocus) {
                    this.adjustForKeyboard();
                }
            };
            window.visualViewport.addEventListener('resize', this.viewportHandler);
        }

        // Update line numbers on resize (affects wrapping)
        this.resizeObserver = new ResizeObserver(() => this.updateLineNumbers());
        this.resizeObserver.observe(this.editorArea);

        // Initial render
        this.updateHighlighting();
        this.updateLineNumbers();

        // Save initial state for undo history
        this.saveInitialState();
    }

    /**
     * Save initial state to undo history
     */
    saveInitialState() {
        const value = this.textarea.value;
        this.lastSavedState = {
            value,
            cursorStart: value.length,
            cursorEnd: value.length
        };
        // Don't push to undoStack - this is the baseline
    }

    /**
     * Save current state to undo history (debounced)
     * Called on user input to capture undoable changes
     */
    saveToHistory() {
        // Clear any pending debounce
        if (this.undoDebounceTimer) {
            clearTimeout(this.undoDebounceTimer);
        }

        // Debounce: wait for 300ms of no typing before saving a history entry
        // This groups rapid keystrokes into a single undo step
        this.undoDebounceTimer = setTimeout(() => {
            this.saveToHistoryNow();
        }, 300);
    }

    /**
     * Immediately save current state to undo history
     */
    saveToHistoryNow() {
        if (this.undoDebounceTimer) {
            clearTimeout(this.undoDebounceTimer);
            this.undoDebounceTimer = null;
        }

        const currentState = {
            value: this.textarea.value,
            cursorStart: this.textarea.selectionStart,
            cursorEnd: this.textarea.selectionEnd
        };

        // Only save if different from last saved state
        if (this.lastSavedState && currentState.value === this.lastSavedState.value) {
            return;
        }

        // Push last saved state to undo stack (not current - we want to undo TO the previous state)
        if (this.lastSavedState) {
            this.undoStack.push(this.lastSavedState);
            // Trim stack if too large
            if (this.undoStack.length > this.maxUndoHistory) {
                this.undoStack.shift();
            }
        }

        // Clear redo stack on new input
        this.redoStack = [];

        // Update last saved state
        this.lastSavedState = currentState;

        this.notifyUndoState();
    }

    /**
     * Undo the last change
     */
    undo() {
        // Save any pending state first
        this.saveToHistoryNow();

        if (this.undoStack.length === 0) return false;

        // Push current state to redo stack
        this.redoStack.push({
            value: this.textarea.value,
            cursorStart: this.textarea.selectionStart,
            cursorEnd: this.textarea.selectionEnd
        });

        // Pop and restore previous state
        const state = this.undoStack.pop();
        this.textarea.value = state.value;
        this.textarea.selectionStart = state.cursorStart;
        this.textarea.selectionEnd = state.cursorEnd;
        this.lastSavedState = state;

        this.updateHighlighting();
        this.updateLineNumbers();
        this.notifyChange();
        this.notifyUndoState();

        return true;
    }

    /**
     * Redo the last undone change
     */
    redo() {
        if (this.redoStack.length === 0) return false;

        // Push current state to undo stack
        this.undoStack.push({
            value: this.textarea.value,
            cursorStart: this.textarea.selectionStart,
            cursorEnd: this.textarea.selectionEnd
        });

        // Pop and restore redo state
        const state = this.redoStack.pop();
        this.textarea.value = state.value;
        this.textarea.selectionStart = state.cursorStart;
        this.textarea.selectionEnd = state.cursorEnd;
        this.lastSavedState = state;

        this.updateHighlighting();
        this.updateLineNumbers();
        this.notifyChange();
        this.notifyUndoState();

        return true;
    }

    canUndo() {
        return this.undoStack.length > 0;
    }

    canRedo() {
        return this.redoStack.length > 0;
    }

    onUndoStateChange(callback) {
        if (!this.undoStateListeners) {
            this.undoStateListeners = [];
        }
        this.undoStateListeners.push(callback);
    }

    notifyUndoState() {
        if (this.undoStateListeners) {
            for (const listener of this.undoStateListeners) {
                listener(this.canUndo(), this.canRedo());
            }
        }
    }

    getValue() {
        return this.textarea.value;
    }

    setValue(value, undoable = false) {
        // Save scroll position
        const scrollTop = this.textarea.scrollTop;

        // Save to undo history before changing (if content is different)
        if (undoable && this.textarea.value !== value) {
            // Clear any pending debounce timer
            if (this.undoDebounceTimer) {
                clearTimeout(this.undoDebounceTimer);
                this.undoDebounceTimer = null;
            }
            // Push current state to undo stack
            this.undoStack.push({
                value: this.textarea.value,
                cursorStart: this.textarea.selectionStart,
                cursorEnd: this.textarea.selectionEnd
            });
            if (this.undoStack.length > this.maxUndoHistory) {
                this.undoStack.shift();
            }
            // Clear redo stack on new change
            this.redoStack = [];
            this.notifyUndoState();
        }

        this.textarea.value = value;

        // Update last saved state if this was an undoable change
        if (undoable) {
            this.lastSavedState = {
                value,
                cursorStart: this.textarea.selectionStart,
                cursorEnd: this.textarea.selectionEnd
            };
        }

        this.updateHighlighting();
        this.updateLineNumbers();

        // Restore scroll position
        this.textarea.scrollTop = scrollTop;
        this.highlightLayer.scrollTop = scrollTop;
        this.lineNumbers.scrollTop = scrollTop;
    }

    /**
     * Set reference constants and functions for highlighting
     * These will be highlighted as 'builtin' (same as built-in functions)
     * @param {Set|Array} constants - Names of constants from Reference section
     * @param {Set|Array} functions - Names of functions from Reference section
     */
    setReferenceInfo(constants, functions, shadowConstants = false) {
        this.referenceConstants = new Set(constants || []);
        this.referenceFunctions = new Set(Array.from(functions || []).map(n => n.toLowerCase()));
        this.shadowConstants = shadowConstants;
        this.updateHighlighting();
    }

    onInput() {
        this.saveToHistory();
        this.updateHighlighting();
        this.updateLineNumbers();
        this.notifyChange();
    }

    onScroll() {
        this.highlightLayer.scrollTop = this.textarea.scrollTop;
        this.highlightLayer.scrollLeft = this.textarea.scrollLeft;
        this.lineNumbers.scrollTop = this.textarea.scrollTop;
    }

    onUserScroll() {
        this.onScroll();
        // Notify scroll listeners only on user scroll
        for (const listener of this.scrollListeners) {
            listener(this.textarea.scrollTop);
        }
    }

    onScrollChange(callback) {
        this.scrollListeners.push(callback);
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
        const tokens = tokenizeMathPad(text, {
            referenceConstants: this.referenceConstants,
            referenceFunctions: this.referenceFunctions,
            shadowConstants: this.shadowConstants
        });

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

    /**
     * Measure the rendered height of text, accounting for wrapping
     */
    measureTextHeight(text) {
        this.measureElement.style.width = `${this.textarea.clientWidth}px`;
        this.measureElement.textContent = text || '\u00A0';
        return this.measureElement.offsetHeight;
    }

    /**
     * Get the height of a single line in pixels
     */
    getLineHeight() {
        return this.measureTextHeight('X');
    }

    /**
     * Get the pixel position of the cursor from the top of the textarea content
     */
    getCursorPixelPosition() {
        const cursorPos = this.textarea.selectionStart;
        const textBeforeCursor = this.textarea.value.substring(0, cursorPos);
        return this.measureTextHeight(textBeforeCursor);
    }

    updateLineNumbers() {
        const lines = this.textarea.value.split('\n');
        let html = '';

        // Measure each line's rendered height to handle wrapping
        for (let i = 0; i < lines.length; i++) {
            const height = this.measureTextHeight(lines[i]);
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

    getScrollPosition() {
        return this.textarea.scrollTop;
    }

    setScrollPosition(scrollTop) {
        this.textarea.scrollTop = scrollTop;
        this.onScroll();
    }

    getCursorPosition() {
        return this.textarea.selectionStart;
    }

    setCursorPosition(pos) {
        this.textarea.selectionStart = this.textarea.selectionEnd = pos;
    }
    adjustForKeyboard() {
        if (!window.visualViewport) return;

        // Check if keyboard is actually showing by comparing viewport to window height
        const viewportHeight = window.visualViewport.height;
        const keyboardShowing = viewportHeight < window.innerHeight * 0.85;

        if (!keyboardShowing) {
            // Keyboard closed while still focused - restore normal height
            this.restoreHeight();
            return;
        }

        // Get header and tab bar heights
        const header = document.querySelector('.app-header');
        const headerHeight = header ? header.offsetHeight : 0;
        const tabBar = document.querySelector('.tab-bar');
        const tabBarHeight = tabBar ? tabBar.offsetHeight : 0;

        // Calculate available height for editor (exact space between tab bar and keyboard)
        const availableHeight = viewportHeight - headerHeight - tabBarHeight;

        // Resize both panels (like divider drag does)
        // Navigate from this.element (simple-editor) to find panels
        const formulasPanel = this.element.parentElement;
        const container = formulasPanel?.parentElement;
        const variablesPanel = container?.querySelector('.variables-panel');
        const divider = container?.querySelector('.panel-divider');
        const dividerHeight = divider ? divider.offsetHeight : 0;

        // Save original variables panel height on first call
        if (!this.isAdjustedForKeyboard) {
            this.isAdjustedForKeyboard = true;
            this.originalVariablesHeight = variablesPanel?.style.height || '';
        }

        // Get the container height to calculate variables panel size
        const containerHeight = container ? container.offsetHeight : 0;
        const variablesHeight = Math.max(40, containerHeight - availableHeight - dividerHeight);

        if (formulasPanel) {
            formulasPanel.style.height = `${availableHeight}px`;
        }
        if (variablesPanel) {
            variablesPanel.style.height = `${variablesHeight}px`;
        }

        // Scroll cursor into view if it's too close to the bottom
        // Use setTimeout to let the resize take effect first
        setTimeout(() => {
            const cursorTop = this.getCursorPixelPosition();
            const lineHeight = this.measureTextHeight('X');
            const margin = lineHeight * 3;
            const visibleHeight = this.textarea.clientHeight;
            const cursorFromTop = cursorTop - this.textarea.scrollTop;

            // If cursor is less than 3 lines from the bottom, scroll it up
            if (cursorFromTop > visibleHeight - margin) {
                this.textarea.scrollTop = cursorTop - visibleHeight + margin;
                this.highlightLayer.scrollTop = this.textarea.scrollTop;
                this.lineNumbers.scrollTop = this.textarea.scrollTop;
            }
        }, 50);
    }

    restoreHeight() {
        if (!this.isAdjustedForKeyboard) return;

        // Restore both panels to their original heights
        // Navigate from this.element (simple-editor) to find panels
        const formulasPanel = this.element.parentElement;
        const container = formulasPanel?.parentElement;
        const variablesPanel = container?.querySelector('.variables-panel');

        formulasPanel?.style.removeProperty('height');

        if (variablesPanel) {
            if (this.originalVariablesHeight) {
                variablesPanel.style.height = this.originalVariablesHeight;
            } else {
                variablesPanel.style.removeProperty('height');
            }
        }

        this.isAdjustedForKeyboard = false;
        this.originalVariablesHeight = null;
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
