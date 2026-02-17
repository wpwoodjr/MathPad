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

    // Tokenize first to find quoted comments (they take precedence)
    const tokenizer = new Tokenizer(text);
    const parserTokens = tokenizer.tokenize();  // Token[][]

    // Flatten for sequential position-based operations (highlight loop, comment region detection)
    const flatTokens = parserTokens.flat();

    // Find user-defined functions (reuse full-text tokens; maxLine bounds to strippedText)
    const userDefinedFunctions = new Set(parseFunctionsRecord(strippedText, parserTokens).keys());

    // Find quoted comment regions from tokenizer
    const quotedCommentRegions = [];
    let pos = 0;
    for (const token of flatTokens) {
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

    // Single pass: detect shadow variables AND find label regions (reuses full-text tokens, no re-tokenization)
    const { localVariables, labelRegions } = analyzeLines(text, strippedText, referenceConstants, shadowConstants, parserTokens);  // parserTokens is Token[][]

    // Filter label regions that overlap with quoted comments
    const commentRegions = labelRegions.filter(
        r => !overlapsQuotedComment(r.start, r.end)
    );

    const tokens = [];
    pos = 0;

    let lastTokenWasVarDef = false;
    let lastTokenWasVar = false;
    let lastTokenWasBuiltin = false;
    let lastTokenEnd = 0;
    let inInlineEval = false;  // Track whether we're inside \..\ inline eval markers
    let prevHighlightType = null;
    let prevTokenLine = 0;

    for (let ti = 0; ti < flatTokens.length; ti++) {
        const token = flatTokens[ti];

        // Skip EOF token
        if (token.type === TokenType.EOF) continue;

        // Reset state on line transitions (replaces old NEWLINE token handling)
        if (token.line !== prevTokenLine) {
            lastTokenWasVarDef = false;
            lastTokenWasVar = false;
            lastTokenWasBuiltin = false;
            prevHighlightType = null;
            inInlineEval = false;
            prevTokenLine = token.line;
        }

        const tokenStart = findTokenPosition(text, token, pos);
        if (tokenStart === -1) continue;

        const tokenLength = getTokenLength(token, text, tokenStart);
        const tokenEnd = tokenStart + tokenLength;

        // Skip tokens that overlap with comment regions (comments take precedence)
        const inCommentRegion = commentRegions.some(r => tokenStart < r.end && tokenEnd > r.start);
        if (inCommentRegion) {
            pos = tokenEnd;
            lastTokenWasVarDef = false;
            prevHighlightType = null;
            continue;
        }

        // Map token types to highlight types
        let highlightType;
        switch (token.type) {
            case TokenType.NUMBER:
                highlightType = 'number';
                break;
            case TokenType.IDENTIFIER: {
                const next = flatTokens[ti + 1];
                const nextToken = (next && next.type !== TokenType.EOF && next.line === token.line) ? next : null;
                highlightType = getIdentifierHighlightType(token.value, tokenStart, nextToken, prevHighlightType, userDefinedFunctions, referenceConstants, referenceFunctions, localVariables);
                break;
            }
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
            case TokenType.FORMATTER:
                // $/%  before markers are merged into marker tokens by the tokenizer,
                // so standalone FORMATTER is only for suffix on variable names.
                // # (base suffix) matches the preceding identifier style in declaration context
                if ((lastTokenWasVarDef || lastTokenWasBuiltin) && tokenStart === lastTokenEnd) {
                    highlightType = lastTokenWasBuiltin ? 'builtin' : 'variable-def';
                } else if (inInlineEval && lastTokenWasVar && tokenStart === lastTokenEnd) {
                    highlightType = 'variable'; // format suffix in inline eval (\a$\, \a%\, \a#16\)
                } else {
                    highlightType = 'error'; // formatter in expression context is a syntax error
                }
                break;
            case TokenType.ERROR:
            case TokenType.UNEXPECTED_CHAR:
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

        // Track highlight type for lookback in identifier classification
        prevHighlightType = highlightType;
        // Track if this token is a variable-def, variable, or builtin for styling following $ or % or #
        lastTokenWasVarDef = (highlightType === 'variable-def');
        lastTokenWasVar = (highlightType === 'variable');
        lastTokenWasBuiltin = (highlightType === 'builtin');
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

    // Sort tokens by position
    tokens.sort((a, b) => a.from - b.from);

    return { tokens, parserTokens };
}

/**
 * Analyze lines in one pass: detect shadow variables AND find label regions
 * Reuses tokens from the full-text tokenizer — no per-line re-tokenization.
 * @param {string} text - Full text to analyze
 * @param {string} strippedText - Text with reference section removed (for shadow detection bounds)
 * @param {Set} referenceConstants - Constants from Reference section
 * @param {boolean} shadowConstants - If true, output markers also shadow constants
 * @param {Token[][]} tokensByLine - Per-line token arrays from the tokenizer
 * @returns {{ localVariables: Map, labelRegions: Array }}
 */
function analyzeLines(text, strippedText, referenceConstants, shadowConstants, tokensByLine) {
    const lines = text.split('\n');
    const strippedLength = strippedText.length;
    const localVariables = new Map();  // name -> charOffset where shadowing starts
    const labelRegions = [];
    let lineStart = 0;
    let insideBrace = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const inReferenceSection = lineStart >= strippedLength;

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
            const closeBracePos = line.indexOf('}');
            if (closeBracePos >= 0) {
                const afterBrace = closeBracePos + 1;
                if (afterBrace < line.length && line.slice(afterBrace).trim()) {
                    labelRegions.push({
                        start: lineStart + afterBrace,
                        end: lineStart + line.length
                    });
                }
            }
            lineStart += line.length + 1;
            continue;
        }

        // Create LineParser from pre-tokenized input (no re-tokenization)
        const parser = LineParser.fromTokens(tokensByLine[i] || [], i);
        const result = parser.parse();

        // --- Shadow detection (non-reference lines only) ---
        if (!inReferenceSection && result && result.kind === 'declaration') {
            const decl = result;
            const isDefMarker = decl.marker === ':' || decl.marker === '<-' || decl.marker === '::';
            const isOutMarker = decl.marker === '->' || decl.marker === '->>' || decl.marker === '=>' || decl.marker === '=>>';
            if (isDefMarker || (shadowConstants && isOutMarker && referenceConstants.has(decl.name))) {
                if (!localVariables.has(decl.name)) {
                    localVariables.set(decl.name, lineStart);
                }
            }
        }

        // --- Label region detection ---
        if (result && result.kind === 'declaration') {
            // For declarations, label is everything before the variable
            const markerInfo = parser.findBestMarker();
            if (markerInfo) {
                // $/%  format specifiers are merged into the marker token by the tokenizer,
                // so markerInfo.index already points to the correct position.
                const varInfo = parser.getImmediateVarBeforeMarker(markerInfo.index);
                if (varInfo && varInfo.varTokenStartIndex > 0) {
                    const varStartCol = parser.tokens[varInfo.varTokenStartIndex].col;
                    labelRegions.push({
                        start: lineStart,
                        end: lineStart + varStartCol - 1
                    });
                }
            }
        } else if (result && result.kind === 'expression-output' && result.exprTokens.length > 0) {
            // For expression outputs, label is everything before the first expression token
            const exprStart = result.exprTokens[0].col - 1;
            if (exprStart > 0) {
                labelRegions.push({
                    start: lineStart,
                    end: lineStart + exprStart
                });
            }
        } else if (!result && line.includes('=')) {
            // Equation line - find label text before and after the equation
            const eqRegions = findEquationLabelRegions(line, tokensByLine[i]);
            for (const r of eqRegions) {
                labelRegions.push({
                    start: lineStart + r.start,
                    end: lineStart + r.end
                });
            }
        } else if (!result && line.trim() && !insideBrace) {
            // Plain text line - label/comment (but not if it has error tokens)
            const hasError = parser.tokens.some(t => t.type === TokenType.ERROR || t.type === TokenType.UNEXPECTED_CHAR);
            if (!hasError && parser.tokens.length > 0) {
                // Find backslash pairs for inline evals — label regions go around them
                const bsIndices = [];
                for (let j = 0; j < parser.tokens.length; j++) {
                    if (parser.tokens[j].type === TokenType.OPERATOR && parser.tokens[j].value === '\\') {
                        bsIndices.push(j);
                    }
                }

                if (bsIndices.length >= 2) {
                    // Label region before first backslash
                    const firstBS = parser.tokens[bsIndices[0]];
                    if (firstBS.col - 1 > 0) {
                        labelRegions.push({
                            start: lineStart,
                            end: lineStart + firstBS.col - 1
                        });
                    }
                    // Label regions between backslash pairs (closing \ of one pair to opening \ of next)
                    for (let p = 1; p + 1 < bsIndices.length; p += 2) {
                        const closeBS = parser.tokens[bsIndices[p]];
                        const openBS = parser.tokens[bsIndices[p + 1]];
                        const gapStart = closeBS.col; // after closing backslash
                        const gapEnd = openBS.col - 1; // before opening backslash
                        if (gapEnd > gapStart) {
                            labelRegions.push({
                                start: lineStart + gapStart,
                                end: lineStart + gapEnd
                            });
                        }
                    }
                    // Label region after last backslash
                    const lastBS = parser.tokens[bsIndices[bsIndices.length - 1]];
                    const afterBS = lastBS.col; // col is 1-based, so col = position after the backslash
                    const lastTok = parser.tokens[parser.tokens.length - 1];
                    const raw = lastTok.type === TokenType.NUMBER ? lastTok.value.raw : lastTok.value;
                    const labelEnd = lastTok.col - 1 + raw.length;
                    if (afterBS < labelEnd) {
                        labelRegions.push({
                            start: lineStart + afterBS,
                            end: lineStart + labelEnd
                        });
                    }
                } else {
                    // No inline evals — whole line is label
                    const lastTok = parser.tokens[parser.tokens.length - 1];
                    const raw = lastTok.type === TokenType.NUMBER ? lastTok.value.raw : lastTok.value;
                    const labelEnd = lastTok.col - 1 + raw.length;
                    if (labelEnd > 0) {
                        labelRegions.push({
                            start: lineStart,
                            end: lineStart + labelEnd
                        });
                    }
                }
            }
        }

        // Handle unquoted trailing comments (for both declarations and expression outputs)
        if (result && result.comment && result.commentUnquoted) {
            const commentStart = line.lastIndexOf(result.comment);
            if (commentStart > 0) {
                labelRegions.push({
                    start: lineStart + commentStart,
                    end: lineStart + commentStart + result.comment.length
                });
            }
        }

        lineStart += line.length + 1;
    }

    return { localVariables, labelRegions };
}

/**
 * Find label text regions in an equation line
 * For "equation c = a + b test", returns regions for "equation " and " test"
 * Uses extractEquationFromLine from variables.js
 */
function findEquationLabelRegions(line, lineTokens) {
    const regions = [];

    // For braced equations, everything before { is label
    const lbrace = lineTokens.find(t => t.type === TokenType.LBRACE);
    if (lbrace) {
        const bracePos = lbrace.col - 1;
        if (bracePos > 0) {
            regions.push({ start: 0, end: bracePos });
        }
        return regions;
    }

    // Use the existing function to extract the valid equation
    const result = extractEquationFromLine(line, lineTokens);

    // If extraction returned the same line, no label text
    if (result.text === line) return regions;

    // Find where the extracted equation appears in the original line
    const eqStart = line.indexOf(result.text);
    if (eqStart === -1) return regions;

    // Everything before the equation is label text
    if (eqStart > 0) {
        regions.push({ start: 0, end: eqStart });
    }

    // Everything after the equation is label text
    const eqEnd = eqStart + result.text.length;
    if (eqEnd < line.length) {
        regions.push({ start: eqEnd, end: line.length });
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
    } else if (token.type === TokenType.ERROR || token.type === TokenType.UNEXPECTED_CHAR) {
        // Extract the actual character from error message like "Unexpected character '$'"
        const match = token.value.match(/character '(.)'/);
        searchValue = match ? match[1] : null;
    } else {
        searchValue = token.value;
    }

    if (!searchValue) {
        // Skip whitespace for multi-char error tokens
        let pos = startFrom;
        while (pos < text.length && /\s/.test(text[pos])) {
            pos++;
        }
        return pos;
    }

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
    } else if (token.type === TokenType.ERROR || token.type === TokenType.UNEXPECTED_CHAR) {
        return token.length || 1; // Multi-char errors (e.g., %<-) use token.length
    } else if (token.value) {
        return token.value.length;
    }
    return 1;
}

/**
 * Determine highlight type for an identifier
 */
function getIdentifierHighlightType(name, tokenStart, nextToken, prevHighlightType, userDefinedFunctions, referenceConstants = new Set(), referenceFunctions = new Set(), localVariables = new Map()) {
    const nameLower = name.toLowerCase();

    // Check if a local variable shadows a constant at this position
    // localVariables maps name -> character position where shadowing starts
    function isShadowed(varName) {
        const shadowPos = localVariables.get(varName);
        return shadowPos !== undefined && tokenStart >= shadowPos;
    }

    // Look ahead for ( to detect function calls
    if (nextToken?.type === TokenType.LPAREN) {
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

    // Check if the next token is a variable declaration marker
    const isMarker = nextToken && (
        nextToken.isMarker ||
        nextToken.type === TokenType.LBRACKET ||
        nextToken.type === TokenType.ERROR
    );

    if (isMarker) {
        // Check if this is part of an expression (has operator/paren/bracket before it)
        // If so, it's not a variable-def, just a variable in an expression output
        if (prevHighlightType === 'operator' || prevHighlightType === 'paren' || prevHighlightType === 'bracket') {
            if (referenceConstants.has(name) && !isShadowed(name)) {
                return 'builtin';
            }
            return 'variable';
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

        // Update line numbers on resize (affects wrapping)
        this.resizeObserver = new ResizeObserver(() => this.updateLineNumbers());
        this.resizeObserver.observe(this.editorArea);

        // Initial render
        this.updateHighlighting();
        this.updateLineNumbers();

        // Push initial state so first undo returns to it
        this.saveInitialState();
    }

    /**
     * Save initial state to undo history
     */
    saveInitialState() {
        this.undoStack.push({
            value: this.textarea.value,
            cursorStart: this.textarea.selectionStart,
            cursorEnd: this.textarea.selectionEnd
        });
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

        const currentValue = this.textarea.value;

        // Only save if different from top of stack
        const top = this.undoStack[this.undoStack.length - 1];
        if (top && top.value === currentValue) {
            return;
        }

        // Push current state to undo stack
        this.undoStack.push({
            value: currentValue,
            cursorStart: this.textarea.selectionStart,
            cursorEnd: this.textarea.selectionEnd
        });
        if (this.undoStack.length > this.maxUndoHistory) {
            this.undoStack.shift();
        }

        // Clear redo stack on new input
        this.redoStack = [];

        this.notifyUndoState();
    }

    /**
     * Undo the last change
     */
    undo() {
        // Flush any pending debounced state
        this.saveToHistoryNow();

        // Need at least 2 entries: current state on top + a previous state to restore
        if (this.undoStack.length < 2) return false;

        // Pop current state (top of stack matches current textarea) → push to redo
        this.redoStack.push(this.undoStack.pop());

        // Pop and restore previous state
        const state = this.undoStack[this.undoStack.length - 1];
        this.textarea.value = state.value;
        this.textarea.selectionStart = state.cursorStart;
        this.textarea.selectionEnd = state.cursorEnd;

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

        // Pop from redo and push to undo stack (becomes new top = current state)
        const state = this.redoStack.pop();
        this.undoStack.push(state);

        this.textarea.value = state.value;
        this.textarea.selectionStart = state.cursorStart;
        this.textarea.selectionEnd = state.cursorEnd;

        this.updateHighlighting();
        this.updateLineNumbers();
        this.notifyChange();
        this.notifyUndoState();

        return true;
    }

    canUndo() {
        // Need current state + at least one previous state
        return this.undoStack.length > 1 || this.undoDebounceTimer !== null;
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

        const changed = this.textarea.value !== value;

        // Save to undo history before changing (if content is different)
        if (undoable && changed) {
            // Flush any pending debounced state first
            this.saveToHistoryNow();
            // Clear redo stack on new change
            this.redoStack = [];
        }

        this.textarea.value = value;

        if (undoable && changed) {
            // Push new state as current top of stack
            this.undoStack.push({
                value,
                cursorStart: this.textarea.selectionStart,
                cursorEnd: this.textarea.selectionEnd
            });
            if (this.undoStack.length > this.maxUndoHistory) {
                this.undoStack.shift();
            }
            this.notifyUndoState();
        } else if (changed) {
            // Non-undoable change: update top of stack to match new state
            // so saveToHistoryNow doesn't see stale state
            const top = this.undoStack[this.undoStack.length - 1];
            if (top) {
                top.value = value;
            }
        }

        this.updateHighlighting();
        this.updateLineNumbers();

        // Restore scroll position
        this.textarea.scrollTop = scrollTop;
        this.highlightLayer.scrollTop = scrollTop;
        this.lineNumbers.scrollTop = scrollTop;

        if (changed) {
            this.notifyChange();
        }
    }

    /**
     * Set reference constants and functions for highlighting
     * These will be highlighted as 'builtin' (same as built-in functions)
     * @param {Set|Array} constants - Names of constants from Reference section
     * @param {Set|Array} functions - Names of functions from Reference section
     */
    setReferenceInfo(constants, functions, shadowConstants = false, parsedConstants = null, parsedFunctions = null) {
        this.referenceConstants = new Set(constants || []);
        this.referenceFunctions = new Set(Array.from(functions || []).map(n => n.toLowerCase()));
        this.shadowConstants = shadowConstants;
        this.parsedConstants = parsedConstants;
        this.parsedFunctions = parsedFunctions;
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
        // Ctrl+/ to toggle line comments
        if ((e.ctrlKey || e.metaKey) && e.key === '/') {
            e.preventDefault();
            this.toggleLineComment();
            return;
        }

        // Tab / Shift+Tab handling
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = this.textarea.selectionStart;
            const end = this.textarea.selectionEnd;
            const value = this.textarea.value;

            // Check if selection spans multiple lines
            const selectedText = value.substring(start, end);
            if (selectedText.includes('\n')) {
                if (e.shiftKey) {
                    this.outdentLines(start, end);
                } else {
                    this.indentLines(start, end);
                }
            } else if (e.shiftKey) {
                // Shift+Tab with single cursor or single-line selection: outdent current line
                this.outdentLines(start, end);
            } else {
                // Single cursor or single-line selection: insert 2 spaces
                this.replaceRange(start, end, '  ');
            }
            return;
        }
    }

    /**
     * Replace a range in the textarea, saving to undo history first
     */
    replaceRange(from, to, text) {
        const ta = this.textarea;
        const value = ta.value;
        const newValue = value.substring(0, from) + text + value.substring(to);
        if (newValue === value) return;

        // Flush pending state, then push new state
        this.saveToHistoryNow();
        this.redoStack = [];

        ta.value = newValue;
        const newCursor = from + text.length;
        ta.selectionStart = newCursor;
        ta.selectionEnd = newCursor;

        // Push new state as current top of stack
        this.undoStack.push({
            value: newValue,
            cursorStart: newCursor,
            cursorEnd: newCursor
        });
        if (this.undoStack.length > this.maxUndoHistory) {
            this.undoStack.shift();
        }

        this.updateHighlighting();
        this.updateLineNumbers();
        this.notifyChange();
        this.notifyUndoState();
    }

    /**
     * Toggle // comment on selected or current lines
     */
    toggleLineComment() {
        const ta = this.textarea;
        const value = ta.value;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;

        // Find the full line range
        // If selection end is at the start of a line, don't include that line
        const effectiveEnd = (end > start && end > 0 && value[end - 1] === '\n') ? end - 1 : end;
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = value.indexOf('\n', effectiveEnd);
        const blockEnd = lineEnd === -1 ? value.length : lineEnd;

        const block = value.substring(lineStart, blockEnd);
        const lines = block.split('\n');

        // Determine if we should uncomment: all non-empty lines start with "// "
        const allCommented = lines.every(line => line.trimStart() === '' || line.startsWith('// '));

        let newLines;
        if (allCommented) {
            // Uncomment: remove first "// " from each line
            newLines = lines.map(line => {
                if (line.startsWith('// ')) return line.substring(3);
                return line;
            });
        } else {
            // Comment: add "// " to non-blank lines, leave blank lines alone
            newLines = lines.map(line => line.trimStart() === '' ? line : '// ' + line);
        }

        const newBlock = newLines.join('\n');
        this.replaceRange(lineStart, blockEnd, newBlock);

        // Adjust selection
        const delta = newBlock.length - block.length;
        const firstLineBlank = lines[0].trimStart() === '';
        const firstLineDelta = allCommented ? (lines[0].startsWith('// ') ? -3 : 0) : (firstLineBlank ? 0 : 3);

        let newStart = (start === lineStart) ? lineStart : start + firstLineDelta;
        if (newStart < lineStart) newStart = lineStart;

        let newEnd = end + delta;
        if (newEnd < lineStart) newEnd = lineStart;

        ta.selectionStart = newStart;
        ta.selectionEnd = newEnd;
    }

    /**
     * Indent selected lines by 2 spaces
     */
    indentLines(start, end) {
        const ta = this.textarea;
        const value = ta.value;

        // Find the full line range
        // If selection end is at the start of a line, don't include that line
        const effectiveEnd = (end > start && end > 0 && value[end - 1] === '\n') ? end - 1 : end;
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = value.indexOf('\n', effectiveEnd);
        const blockEnd = lineEnd === -1 ? value.length : lineEnd;

        const block = value.substring(lineStart, blockEnd);
        const lines = block.split('\n');
        const newLines = lines.map(line => '  ' + line);
        const newBlock = newLines.join('\n');

        this.replaceRange(lineStart, blockEnd, newBlock);

        // Adjust selection
        let newStart = (start === lineStart) ? lineStart : start + 2;
        ta.selectionStart = newStart;
        ta.selectionEnd = end + (lines.length * 2);
    }

    /**
     * Outdent selected lines by up to 2 spaces
     */
    outdentLines(start, end) {
        const ta = this.textarea;
        const value = ta.value;

        // Find the full line range
        // If selection end is at the start of a line, don't include that line
        const effectiveEnd = (end > start && end > 0 && value[end - 1] === '\n') ? end - 1 : end;
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = value.indexOf('\n', effectiveEnd);
        const blockEnd = lineEnd === -1 ? value.length : lineEnd;

        const block = value.substring(lineStart, blockEnd);
        const lines = block.split('\n');

        let totalRemoved = 0;
        let firstLineRemoved = 0;
        const newLines = lines.map((line, i) => {
            let removed = 0;
            if (line.startsWith('  ')) {
                removed = 2;
            } else if (line.startsWith(' ')) {
                removed = 1;
            }
            if (i === 0) firstLineRemoved = removed;
            totalRemoved += removed;
            return line.substring(removed);
        });

        const newBlock = newLines.join('\n');
        this.replaceRange(lineStart, blockEnd, newBlock);

        // Adjust selection
        let newStart = (start === lineStart) ? lineStart : start - firstLineRemoved;
        if (newStart < lineStart) newStart = lineStart;
        let newEnd = end - totalRemoved;
        if (newEnd < lineStart) newEnd = lineStart;

        ta.selectionStart = newStart;
        ta.selectionEnd = newEnd;
    }

    updateHighlighting() {
        const text = this.textarea.value;
        const { tokens, parserTokens } = tokenizeMathPad(text, {
            referenceConstants: this.referenceConstants,
            referenceFunctions: this.referenceFunctions,
            shadowConstants: this.shadowConstants
        });
        this.parserTokens = parserTokens;

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
