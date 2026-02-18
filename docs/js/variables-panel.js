/**
 * MathPad Variables Panel - Structured view of extracted variables
 */

/**
 * Syntax-highlight a label text string, returning HTML
 */
function highlightLabelText(text) {
    const { tokens } = tokenizeMathPad(text);
    let html = '';
    let lastPos = 0;
    for (const token of tokens) {
        if (token.from > lastPos) {
            html += escapeHtml(text.slice(lastPos, token.from));
        }
        html += `<span class="tok-${token.type}">${escapeHtml(text.slice(token.from, token.to))}</span>`;
        lastPos = token.to;
    }
    if (lastPos < text.length) {
        html += escapeHtml(text.slice(lastPos));
    }
    return html;
}

/**
 * VariablesPanel - Manages the structured variables view
 */
class VariablesPanel {
    constructor(container, record, editor) {
        this.container = container;
        this.record = record;
        this.editor = editor;
        this.declarations = new Map(); // keyed by lineIndex
        this.changeListeners = [];
        this.solveCallback = null;
        this.inputElements = new Map();
        this.lastEditedVar = null; // Track most recently edited variable name
        this.errorLines = new Set(); // Lines with errors
        this.flashChanges = false;
        this._oldDisplayValues = null;

        this.container.addEventListener('animationend', (e) => {
            if (e.target.classList.contains('value-changed')) {
                e.target.classList.remove('value-changed');
            }
        });

        // Handle Tab key to cycle through inputs
        this.container.addEventListener('keydown', (e) => {
            if (e.key === 'Tab' && e.target.classList.contains('variable-value-input')) {
                e.preventDefault();
                const nextInput = this.getNextInput(e.target, e.shiftKey);
                // Blur first (triggers undo logic), then focus next
                e.target.blur();
                if (nextInput) {
                    nextInput.focus();
                }
            }
        });
    }

    enableFlash() {
        this.flashChanges = true;
    }

    /**
     * Get next/previous input in the variables panel (wraps around)
     */
    getNextInput(currentInput, reverse = false) {
        const inputs = Array.from(this.container.querySelectorAll('.variable-value-input'));
        if (inputs.length === 0) return null;

        const currentIndex = inputs.indexOf(currentInput);
        let nextIndex;

        if (reverse) {
            nextIndex = currentIndex <= 0 ? inputs.length - 1 : currentIndex - 1;
        } else {
            nextIndex = currentIndex >= inputs.length - 1 ? 0 : currentIndex + 1;
        }

        return inputs[nextIndex];
    }

    /**
     * Update variables panel from text
     * Shows one row per declaration line and expression output
     */
    updateFromText(text) {
        // Find where references section starts (if present)
        const refSectionStart = text.indexOf('"--- Reference Constants and Functions ---"');
        const refSectionLineIndex = refSectionStart >= 0
            ? text.substring(0, refSectionStart).split('\n').length - 1
            : Infinity;

        // If reference section moved, remove separator so it gets recreated in the right place
        const existingSeparator = this.container.querySelector('.variable-section-separator');
        if (existingSeparator && this.refSectionLineIndex !== refSectionLineIndex) {
            existingSeparator.remove();
        }

        this.refSectionLineIndex = refSectionLineIndex;

        // Detect --Variables-- section marker
        const varsSectionStart = text.indexOf('--Variables--');
        const varsSectionLineIndex = varsSectionStart >= 0
            ? text.substring(0, varsSectionStart).split('\n').length - 1
            : -1; // -1 means no marker → current behavior

        this.varsSectionLineIndex = varsSectionLineIndex;

        const allTokens = this.editor.parserTokens;
        const newDeclarations = parseAllVariables(text, allTokens);

        // Build map keyed by lineIndex for diffing
        const newDeclMap = new Map();
        for (const info of newDeclarations) {
            newDeclMap.set(info.lineIndex, info);
        }

        // Also include expression outputs (expr:, expr::, expr->, expr->>)
        if (typeof findExpressionOutputs === 'function') {
            const exprOutputs = findExpressionOutputs(text, allTokens);
            for (const output of exprOutputs) {
                // Convert expression output to declaration-like format
                newDeclMap.set(output.startLine, {
                    name: tokensToText(output.exprTokens).trim(),
                    declaration: {
                        marker: output.marker,
                        type: output.recalculates ? VarType.OUTPUT : VarType.INPUT,
                        clearBehavior: output.recalculates ? ClearBehavior.ON_SOLVE : ClearBehavior.NONE,
                        fullPrecision: output.fullPrecision,
                        format: output.format || null,
                        base: output.base,
                        comment: output.comment,
                        commentUnquoted: output.commentUnquoted
                    },
                    lineIndex: output.startLine,
                    markerEndCol: output.markerEndCol,
                    value: null,
                    valueTokens: output.valueTokens,
                    isExpressionOutput: true
                });
            }
        }

        // If --Variables-- marker present, filter to only items below it
        if (varsSectionLineIndex >= 0) {
            for (const lineIndex of [...newDeclMap.keys()]) {
                if (lineIndex <= varsSectionLineIndex) {
                    newDeclMap.delete(lineIndex);
                }
            }

            // Strip // line comments from declarations below the marker
            for (const [lineIndex, info] of newDeclMap) {
                if (info.declaration && info.declaration.comment && info.declaration.commentUnquoted) {
                    info.declaration.comment = null;
                    info.declaration.commentUnquoted = false;
                }
            }

            // Add label/spacer rows for non-declaration lines below the marker
            // Build a map of line → comment text from tokens (handles multi-line comments)
            const commentLines = new Map(); // startLine → { text, endLine, isQuoted }
            const consumedLines = new Set(); // lines consumed by multi-line comments
            if (allTokens) {
                for (const lineTokens of allTokens) for (const t of lineTokens) {
                    if (t.type !== TokenType.COMMENT) continue;
                    if (t.line - 1 <= varsSectionLineIndex) continue;
                    if (t.lineComment) continue; // skip // comments
                    const startLine = t.line - 1; // 0-based
                    // Count lines in the comment value
                    const valueLines = t.value.split('\n');
                    const endLine = startLine + valueLines.length - 1;
                    commentLines.set(startLine, { text: t.value, endLine, isQuoted: true });
                    for (let l = startLine + 1; l <= endLine; l++) {
                        consumedLines.add(l);
                    }
                }
            }

            const lines = text.split('\n');
            for (let i = varsSectionLineIndex + 1; i < lines.length; i++) {
                if (newDeclMap.has(i)) continue; // Already a declaration
                if (i >= refSectionLineIndex) continue; // In reference section
                if (consumedLines.has(i)) continue; // Part of a multi-line comment

                const line = lines[i];
                const trimmed = line.trim();

                // Skip the reference section marker line
                if (trimmed.startsWith('"--- Reference')) continue;

                // Skip // comment-only lines
                if (trimmed.startsWith('//')) continue;

                // Use token-based comment text if available (handles multi-line)
                const commentInfo = commentLines.get(i);
                let labelText = commentInfo ? commentInfo.text : line;
                let isQuoted = commentInfo ? true : false;

                if (!commentInfo) {
                    // Fallback: strip surrounding quotes for single-line
                    const stripped = labelText.trim();
                    if (stripped.startsWith('"') && stripped.endsWith('"') && stripped.length >= 2) {
                        labelText = stripped.slice(1, -1);
                        isQuoted = true;
                    }
                }

                // Empty lines → spacer row
                // Plain text lines → label row
                newDeclMap.set(i, {
                    name: labelText,
                    declaration: { marker: null, comment: null },
                    lineIndex: i,
                    isLabel: true,
                    isQuoted
                });
            }
        }

        // Diff and update only changed declarations
        const toAdd = [];
        const toUpdate = [];
        const toRemove = [];

        for (const [lineIndex, info] of newDeclMap) {
            if (!this.declarations.has(lineIndex)) {
                toAdd.push(info);
            } else {
                const existing = this.declarations.get(lineIndex);
                // If name, marker, format, limits, or comment changed, remove old row and add new one
                const limitsChanged = JSON.stringify(existing.declaration.limits) !== JSON.stringify(info.declaration.limits);
                const formatChanged = existing.declaration.format !== info.declaration.format || existing.declaration.base !== info.declaration.base;
                if (existing.name !== info.name || existing.declaration.marker !== info.declaration.marker || existing.declaration.label !== info.declaration.label || formatChanged || limitsChanged || existing.declaration.comment !== info.declaration.comment) {
                    toRemove.push(lineIndex);
                    toAdd.push(info);
                } else if (this.declarationChanged(existing, info)) {
                    toUpdate.push(info);
                }
            }
        }

        for (const lineIndex of this.declarations.keys()) {
            if (!newDeclMap.has(lineIndex)) {
                toRemove.push(lineIndex);
            }
        }

        // Snapshot old display values before removing rows (for flash comparison on re-added rows)
        if (this.flashChanges) {
            this._oldDisplayValues = new Map();
            for (const lineIndex of toRemove) {
                const existing = this.declarations.get(lineIndex);
                if (existing) {
                    this._oldDisplayValues.set(lineIndex, this.formatValueForDisplay(existing));
                }
            }
        }

        // Apply changes - remove first, then add, then update
        toRemove.forEach(lineIndex => this.removeVariableRow(lineIndex));
        toAdd.forEach(info => this.addVariableRow(info));
        toUpdate.forEach(info => this.updateVariableRow(info));

        // Remove separator if no reference items remain
        const hasRefItems = [...newDeclMap.values()].some(info => info.lineIndex > refSectionLineIndex);
        if (!hasRefItems) {
            const separator = this.container.querySelector('.variable-section-separator');
            if (separator) separator.remove();
        }

        this.declarations = newDeclMap;
        this.flashChanges = false;
        this._oldDisplayValues = null;
    }

    /**
     * Add a variable row to the panel
     */
    addVariableRow(info) {
        // Handle label/spacer rows (from --Variables-- section)
        if (info.isLabel) {
            const row = document.createElement('div');
            row.className = 'variable-row';
            row.dataset.lineIndex = info.lineIndex;
            row.dataset.type = 'label';

            if (info.name) {
                // Label row with text - use same styling as declaration comments
                const label = document.createElement('span');
                label.className = 'variable-comment';
                let labelText = info.name;
                if (labelText.startsWith('*')) {
                    labelText = labelText.slice(1).trimStart();
                    label.style.color = 'var(--star-label-color)';
                    row.style.background = 'var(--bg-hover)';
                }
                if (info.isQuoted) {
                    label.style.whiteSpace = 'pre-wrap';
                }
                if (!info.isQuoted) {
                    // Syntax-highlight non-quoted labels (equations, expressions)
                    label.innerHTML = highlightLabelText(labelText);
                } else {
                    label.textContent = labelText;
                }
                row.appendChild(label);
            } else {
                // Spacer row
                row.classList.add('variable-label-spacer');
            }

            this.insertRowInOrder(row, info.lineIndex);
            return;
        }

        const row = document.createElement('div');
        row.className = 'variable-row';
        row.dataset.lineIndex = info.lineIndex;

        const decl = info.declaration;
        const clearBehavior = decl.clearBehavior;

        // Check if this is in the references section
        const isInRefSection = info.lineIndex > this.refSectionLineIndex;

        // Add separator before first reference section item
        if (isInRefSection && !this.container.querySelector('.variable-section-separator')) {
            const separator = document.createElement('div');
            separator.className = 'variable-section-separator';
            separator.textContent = 'Reference Constants';
            // Give separator a line index so insertRowInOrder works correctly
            separator.dataset.lineIndex = this.refSectionLineIndex;
            this.container.appendChild(separator);
        }

        // Set data-type for CSS styling based on clear behavior
        if (isInRefSection) {
            row.dataset.type = 'reference';
        } else if (decl.type === VarType.OUTPUT) {
            row.dataset.type = 'output';
        } else {
            row.dataset.type = 'input';
        }

        // Variable name label (includes format suffix, limits, and marker)
        const formatSuffix = decl.format === 'money' ? '$' : decl.format === 'percent' ? '%' : decl.base && decl.base !== 10 ? `#${decl.base}` : '';
        // Always separate format suffix with a space for clarity
        const formatSep = formatSuffix ? ' ' : '';
        const limitsStr = decl.limits ? `[${tokensToText(decl.limits.lowTokens).trim()}:${tokensToText(decl.limits.highTokens).trim()}]` : '';
        const nameLabel = document.createElement('span');
        nameLabel.className = 'variable-name';
        const labelPrefix = decl.label ? decl.label + ' ' : '';
        nameLabel.textContent = labelPrefix + info.name + limitsStr + formatSep + formatSuffix + (decl.marker || ':');
        // Add tooltip explaining variable type
        if (isInRefSection) {
            nameLabel.title = 'Reference (from Constants/Functions)';
        } else if (clearBehavior === ClearBehavior.ON_CLEAR) {
            nameLabel.title = 'Input variable (cleared on Clear)';
        } else if (decl.type === VarType.OUTPUT) {
            nameLabel.title = clearBehavior === ClearBehavior.ON_SOLVE_ONLY
                ? 'Output variable (cleared on Solve)'
                : 'Output variable (cleared on Solve or Clear)';
        } else {
            nameLabel.title = 'Input variable (persistent)';
        }

        // Value input or display
        // Output types (-> and ->>) are read-only
        // References section values are also read-only (auto-generated)
        // Expression outputs are always read-only
        const isOutput = decl.type === VarType.OUTPUT;
        const isExpressionOutput = info.isExpressionOutput || false;
        const isEditable = !isOutput && !isInRefSection && !isExpressionOutput;
        let valueElement;

        if (isEditable) {
            valueElement = document.createElement('input');
            valueElement.type = 'text';
            valueElement.className = 'variable-value-input';
            valueElement.inputMode = 'decimal';
            valueElement.spellcheck = false;
            valueElement.setAttribute('autocapitalize', 'none');
            valueElement.setAttribute('autocorrect', 'off');
            valueElement.autocomplete = 'off';
            valueElement.value = this.formatValueForDisplay(info);
            // Update formula pane on blur (when user is done typing), not during typing
            valueElement.addEventListener('blur', (e) => {
                this.handleValueChange(info.lineIndex, e.target.value);
            });
            valueElement.addEventListener('focus', (e) => {
                // Track this as the focused variable (for clear exclusion)
                this.lastEditedVar = info.name;
                // Save original value for Escape restore
                e.target.dataset.originalValue = e.target.value;
            });
            valueElement.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    // Restore original value and blur
                    e.target.value = e.target.dataset.originalValue ?? e.target.value;
                    e.target.blur();
                } else if (e.key === 'Enter') {
                    e.target.blur();
                }
            });
            this.inputElements.set(info.lineIndex, valueElement);
        } else {
            valueElement = document.createElement('span');
            valueElement.className = 'variable-value-readonly';
            valueElement.textContent = this.formatValueForDisplay(info);
        }

        // Add solve button for editable variables (before name)
        if (isEditable) {
            const solveBtn = document.createElement('button');
            solveBtn.className = 'variable-solve-btn';
            solveBtn.textContent = '⟲';
            solveBtn.title = 'Clear and solve';
            solveBtn.addEventListener('click', (e) => {
                e.preventDefault();
                // Get current info from declarations (may have been replaced after solve)
                const currentInfo = this.declarations.get(info.lineIndex) || info;
                // Clear the value if present, UNLESS user just edited this variable
                const justEdited = this.lastEditedVar === info.name;
                let cleared = false;
                if (this.formatValueForDisplay(currentInfo) && !justEdited) {
                    valueElement.value = '';
                    this.handleValueChange(info.lineIndex, '');
                    cleared = true;
                }
                // Clear tracking and trigger solve
                // When cleared: non-undoable so undo collapses clear+solve into one step
                // When not cleared: undoable so solve gets its own undo entry
                this.lastEditedVar = null;
                if (this.solveCallback) {
                    this.solveCallback(!cleared);
                }
            });
            row.appendChild(solveBtn);
        } else {
            // Placeholder for alignment (non-editable variables)
            const placeholder = document.createElement('span');
            placeholder.className = 'variable-solve-btn-placeholder';
            row.appendChild(placeholder);
        }

        row.appendChild(nameLabel);
        row.appendChild(valueElement);

        // Add comment if present
        if (decl.comment) {
            const commentElement = document.createElement('span');
            commentElement.className = 'variable-comment';
            commentElement.textContent = decl.comment;
            commentElement.title = decl.comment;
            row.appendChild(commentElement);
        }

        // Insert in order (by line number)
        this.insertRowInOrder(row, info.lineIndex);

        // Flash newly added/rebuilt rows if their value changed
        if (this.flashChanges && !info.isLabel) {
            const newValue = this.formatValueForDisplay(info);
            const oldValue = this._oldDisplayValues ? this._oldDisplayValues.get(info.lineIndex) : undefined;
            if (oldValue !== undefined ? newValue !== oldValue : !!newValue) {
                row.classList.add('value-changed');
            }
        }
    }

    /**
     * Update an existing variable row
     */
    updateVariableRow(info) {
        const row = this.container.querySelector(`[data-line-index="${info.lineIndex}"]`);
        if (!row) return;

        const valueElement = row.querySelector('.variable-value-input, .variable-value-readonly');
        // Skip update if element has focus (to not disrupt typing)
        if (valueElement && document.activeElement !== valueElement) {
            const newValue = this.formatValueForDisplay(info);
            const oldValue = valueElement.tagName === 'INPUT' ? valueElement.value : valueElement.textContent;
            if (valueElement.tagName === 'INPUT') {
                valueElement.value = newValue;
            } else {
                valueElement.textContent = newValue;
            }
            if (this.flashChanges && newValue !== oldValue) {
                row.classList.remove('value-changed');
                void row.offsetWidth; // force reflow to restart animation
                row.classList.add('value-changed');
            }
        }
    }

    /**
     * Remove a variable row
     */
    removeVariableRow(lineIndex) {
        const row = this.container.querySelector(`[data-line-index="${lineIndex}"]`);
        if (row) row.remove();
        this.inputElements.delete(lineIndex);
    }

    /**
     * Handle value change from input
     */
    handleValueChange(lineIndex, newValue) {
        // Clear solved/unsolved highlights since values changed
        this.clearErrors();

        // Get the declaration info for this line
        const info = this.declarations.get(lineIndex);
        if (!info) return;

        const varName = info.name;
        const decl = info.declaration;

        // Try to parse the new value as a number
        const parsedValue = this.parseInputValue(decl.format, newValue);

        // Format the value for display in formulas
        // If it's a number, format it; otherwise use the raw input (allows expressions)
        // Empty value clears the declaration
        let formattedValue;
        if (parsedValue !== null) {
            formattedValue = this.formatInputForFormulas(decl.format, newValue, parsedValue);
        } else {
            // Not a number - use the raw input (could be an expression like sqrt(3), or empty to clear)
            formattedValue = newValue.trim();
        }

        // Update cached declaration so diff works correctly after Solve
        info.valueText = formattedValue;

        // Get current text and update the specific line
        const oldText = this.editor.getValue();
        let text = oldText;
        const lines = text.split('\n');

        if (lineIndex >= 0 && lineIndex < lines.length) {
            const markerEndIndex = info.markerEndCol - 1;
            lines[lineIndex] = buildOutputLine(lines[lineIndex], markerEndIndex, formattedValue);
            text = lines.join('\n');
        }

        // Only notify listeners if text actually changed
        if (text !== oldText) {
            for (const listener of this.changeListeners) {
                listener(varName, parsedValue, text);
            }
        }

        // Update the input element to show the formatted value
        const inputElement = this.inputElements.get(lineIndex);
        if (inputElement) {
            inputElement.value = formattedValue;
        }
    }

    /**
     * Format user input for writing back to formulas, preserving precision
     * @param {string} varFormat - 'money', 'percent', or null
     */
    formatInputForFormulas(varFormat, inputText, parsedValue) {
        let text = inputText.trim();

        // Handle money variables
        if (varFormat === 'money' || text.includes('$')) {
            // Normalize: strip $ and commas, then re-add with proper formatting
            let num = text.replace(/[$,]/g, '').trim();
            const negative = num.startsWith('-');
            if (negative) num = num.substring(1).trim();
            // Add commas to integer part
            const parts = num.split('.');
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
            const result = parts.join('.');
            return (negative ? '-$' : '$') + result;
        }

        // Handle percentage variables
        if (varFormat === 'percent' || text.endsWith('%')) {
            // If user included %, return as-is
            if (text.endsWith('%')) {
                return text;
            }
            // User typed just the number for a % variable, add the %
            return text + '%';
        }

        // For regular numbers, preserve the input exactly as typed
        return text;
    }

    /**
     * Get display value for a variable
     * Simply returns the valueText from parsing - no re-formatting needed
     * since the formula pane already has the formatted text
     */
    formatValueForDisplay(info) {
        if (info.valueText != null) return info.valueText;
        if (info.valueTokens && info.valueTokens.length > 0) return tokensToText(info.valueTokens).trim();
        return '';
    }

    /**
     * Parse user input value (handling $, %, commas)
     * @param {string} varFormat - 'money', 'percent', or null
     */
    parseInputValue(varFormat, inputText) {
        let text = inputText.trim();
        if (!text) return null;

        let multiplier = 1;

        // Handle money format: $1,234.56 or -$1,234.56
        if (text.includes('$')) {
            text = text.replace(/[$,]/g, '');
        }

        // Handle percentage format: 7.5%
        // Also check if variable format is percent
        if (text.endsWith('%')) {
            text = text.slice(0, -1);
            multiplier = 0.01; // Convert percentage display to decimal
        } else if (varFormat === 'percent') {
            // Variable is percentage type but user didn't include %
            // Assume they entered as display value (e.g., 7.5 for 7.5%)
            multiplier = 0.01;
        }

        // Remove any remaining commas
        text = text.replace(/,/g, '');

        const value = Number(text);
        return isNaN(value) ? null : value * multiplier;
    }

    /**
     * Register a callback for value changes
     */
    onValueChange(callback) {
        this.changeListeners.push(callback);
    }

    /**
     * Register a callback for solve requests
     */
    onSolve(callback) {
        this.solveCallback = callback;
    }

    /**
     * Check if a declaration has changed
     */
    declarationChanged(existing, newInfo) {
        return existing.value !== newInfo.value ||
               this.formatValueForDisplay(existing) !== this.formatValueForDisplay(newInfo) ||
               existing.declaration.type !== newInfo.declaration.type ||
               existing.name !== newInfo.name;
    }

    /**
     * Set errors and highlight affected variable rows
     * @param {Array} errors - Array of error strings like "Line 3: Variable 'x' ..."
     * @param {Map} equationVarStatus - Variable name → 'solved'|'unsolved' (first equation wins)
     */
    setErrors(errors, equationVarStatus) {
        this.clearErrors();

        // Mark rows based on equation status (first-equation-wins ordering from solver)
        // Skip output variables — they're computed results, not user-editable inputs
        if (equationVarStatus) {
            for (const decl of this.declarations.values()) {
                if (decl.declaration && decl.declaration.type === VarType.OUTPUT) continue;
                const status = equationVarStatus.get(decl.name);
                if (!status) continue;
                const row = this.container.querySelector(`[data-line-index="${decl.lineIndex}"]`);
                if (!row) continue;
                if (status === 'unsolved') {
                    row.classList.add('has-unsolved');
                } else {
                    row.classList.add('has-solved');
                }
            }
        }

        if (!errors || errors.length === 0) return;

        // Parse line numbers from errors
        for (const error of errors) {
            const match = error.match(/^Line (\d+):/);
            if (match) {
                const lineNum = parseInt(match[1], 10) - 1; // Convert to 0-indexed
                this.errorLines.add(lineNum);
            }
        }

        // Mark rows with errors
        for (const lineIndex of this.errorLines) {
            const row = this.container.querySelector(`[data-line-index="${lineIndex}"]`);
            if (row) {
                row.classList.add('has-error');
            }
        }
    }

    /**
     * Clear all error highlighting
     */
    clearErrors() {
        this.errorLines.clear();
        for (const row of this.container.querySelectorAll('.variable-row.has-error')) {
            row.classList.remove('has-error');
        }
        for (const row of this.container.querySelectorAll('.variable-row.has-solved')) {
            row.classList.remove('has-solved');
        }
        for (const row of this.container.querySelectorAll('.variable-row.has-unsolved')) {
            row.classList.remove('has-unsolved');
        }
    }

    /**
     * Clear the last edited variable tracking
     * Called after solve to reset the "just edited" state
     */
    clearLastEdited() {
        this.lastEditedVar = null;
    }

    /**
     * Insert row in correct order by line number
     */
    insertRowInOrder(row, lineIndex) {
        const rows = Array.from(this.container.children);
        let inserted = false;

        for (const existingRow of rows) {
            const existingLineIndex = parseInt(existingRow.dataset.lineIndex, 10);
            if (existingLineIndex > lineIndex) {
                this.container.insertBefore(row, existingRow);
                inserted = true;
                break;
            }
        }

        if (!inserted) {
            this.container.appendChild(row);
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VariablesPanel };
}
