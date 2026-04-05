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
        // Find where references/table outputs section starts (if present) — excluded from panel
        let refSectionStart = text.indexOf('"--- Reference Constants and Functions ---"');
        const tableOutputStart = text.indexOf('"--- Table Outputs ---"');
        if (tableOutputStart >= 0 && (refSectionStart < 0 || tableOutputStart < refSectionStart)) {
            refSectionStart = tableOutputStart;
        }
        const refSectionLineIndex = refSectionStart >= 0
            ? text.substring(0, refSectionStart).split('\n').length - 1
            : Infinity;

        // Detect --Variables-- section marker
        const varsSectionStart = text.indexOf('--Variables--');
        const varsSectionLineIndex = varsSectionStart >= 0
            ? text.substring(0, varsSectionStart).split('\n').length - 1
            : -1; // -1 means no marker → current behavior

        this.varsSectionLineIndex = varsSectionLineIndex;

        const allTokens = this.editor.parserTokens;

        // Detect table definitions and build skip set
        const tableDefs = findTableDefinitions(text, allTokens);
        const tableSkipLines = new Set();
        for (const td of tableDefs) {
            for (let l = td.startLine; l <= td.endLine; l++) tableSkipLines.add(l);
        }
        this._tableDefs = tableDefs;

        const newDeclarations = parseAllVariables(text, allTokens, tableSkipLines.size > 0 ? tableSkipLines : null);

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
                        label: output.label || null,
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

        // Remove reference section items from panel (shown in formulas only)
        for (const lineIndex of [...newDeclMap.keys()]) {
            if (lineIndex >= refSectionLineIndex) {
                newDeclMap.delete(lineIndex);
            }
        }

        // If --Variables-- marker present, filter to only items below it
        if (varsSectionLineIndex >= 0) {
            for (const lineIndex of [...newDeclMap.keys()]) {
                if (lineIndex <= varsSectionLineIndex) {
                    newDeclMap.delete(lineIndex);
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
                if (tableSkipLines.has(i + 1)) continue; // Inside table definition

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
        // Key by name (not lineIndex) so line insertions/deletions don't cause false flashes
        if (this.flashChanges) {
            this._oldDisplayValues = new Map();
            for (const lineIndex of toRemove) {
                const existing = this.declarations.get(lineIndex);
                if (existing) {
                    this._oldDisplayValues.set(existing.name, this.formatValueForDisplay(existing));
                }
            }
        }

        // Apply changes - remove first, then add, then update
        toRemove.forEach(lineIndex => this.removeVariableRow(lineIndex));
        toAdd.forEach(info => this.addVariableRow(info));
        toUpdate.forEach(info => this.updateVariableRow(info));

        this.declarations = newDeclMap;
        this.flashChanges = false;
        this._oldDisplayValues = null;

        // Align all value inputs/outputs by setting name elements to the same width
        this.alignNameWidths();

        // Auto-size value fields that overflow
        for (const input of this.container.querySelectorAll('.variable-value-input, .variable-value-readonly')) {
            this.autoSizeInput(input);
        }
    }

    /**
     * Set all .variable-name elements to the same width so value columns align
     */
    alignNameWidths() {
        const names = this.container.querySelectorAll('.variable-name');
        // Reset to natural width first
        for (const el of names) el.style.minWidth = '';
        // Find max natural width
        let maxWidth = 0;
        for (const el of names) {
            maxWidth = Math.max(maxWidth, el.offsetWidth);
        }
        // Apply uniform width
        if (maxWidth > 0) {
            const px = maxWidth + 'px';
            for (const el of names) el.style.minWidth = px;
        }
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

            if (info.name && /^-{3,}$/.test(info.name.trim())) {
                // Dash line → horizontal rule
                const hr = document.createElement('hr');
                hr.className = 'variable-divider';
                row.appendChild(hr);
            } else if (info.name) {
                // Label row with text - use same styling as declaration comments
                const label = document.createElement('span');
                label.className = 'variable-comment';
                let labelText = info.name;
                if (labelText.startsWith('*')) {
                    labelText = labelText.slice(1).trimStart();
                    label.style.color = 'var(--star-label-color)';
                    row.style.background = 'var(--bg-hover)';
                }
                label.style.whiteSpace = 'pre-wrap';
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

        // Set data-type for CSS styling based on clear behavior
        if (decl.type === VarType.OUTPUT) {
            row.dataset.type = 'output';
        } else {
            row.dataset.type = 'input';
        }

        // Variable name label (includes format suffix, limits, and marker)
        const formatSuffix = decl.format === 'money' ? '$' : decl.format === 'percent' ? '%' : decl.format === 'degrees' ? '°' : decl.format === 'date' ? '@d' : decl.format === 'duration' ? '@t' : decl.base && decl.base !== 10 ? `#${decl.base}` : '';
        const limitsStr = decl.limits ? `[${tokensToText(decl.limits.lowTokens).trim()}:${tokensToText(decl.limits.highTokens).trim()}]` : '';
        const nameLabel = document.createElement('span');
        nameLabel.className = 'variable-name';
        const displayName = (decl.label && decl.label.trim()) ? decl.label.trim() : info.name + limitsStr;
        const nameText = document.createElement('span');
        nameText.className = 'variable-name-text';
        nameText.textContent = displayName;
        const markerText = document.createElement('span');
        markerText.className = 'variable-name-marker';
        markerText.textContent = formatSuffix + (decl.marker || ':');
        nameLabel.appendChild(nameText);
        nameLabel.appendChild(markerText);
        // Add tooltip explaining variable type
        if (clearBehavior === ClearBehavior.ON_CLEAR) {
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
        // Expression outputs are always read-only
        const isOutput = decl.type === VarType.OUTPUT;
        const isExpressionOutput = info.isExpressionOutput || false;
        const isEditable = !isOutput && !isExpressionOutput;
        let valueElement;

        if (isEditable) {
            valueElement = document.createElement('input');
            valueElement.type = 'text';
            valueElement.className = 'variable-value-input';
            valueElement.inputMode = 'text';
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
            valueElement.addEventListener('input', (e) => {
                this.autoSizeInput(e.target);
            });
            this.inputElements.set(info.lineIndex, valueElement);
        } else {
            valueElement = document.createElement('input');
            valueElement.type = 'text';
            valueElement.className = 'variable-value-readonly';
            valueElement.readOnly = true;
            valueElement.value = this.formatValueForDisplay(info);
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
            commentElement.style.whiteSpace = 'pre-wrap';
            commentElement.textContent = decl.comment;
            commentElement.title = decl.comment;
            row.appendChild(commentElement);
        }

        // Insert in order (by line number)
        this.insertRowInOrder(row, info.lineIndex);

        // Flash newly added/rebuilt rows if their value changed
        if (this.flashChanges && !info.isLabel) {
            const newValue = this.formatValueForDisplay(info);
            const oldValue = this._oldDisplayValues ? this._oldDisplayValues.get(info.name) : undefined;
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
                this.autoSizeInput(valueElement);
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
            return (negative ? '-$' : '$') + addCommaGrouping(num);
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

        // Handle degrees variables
        if (varFormat === 'degrees' || text.endsWith('°')) {
            if (text.endsWith('°')) {
                return text;
            }
            return text + '°';
        }

        // For regular numbers, preserve the input exactly as typed
        return text;
    }

    /**
     * Auto-size an input element to fit its content when wider than default max-width
     */
    autoSizeInput(input) {
        if (!input.value) { input.style.maxWidth = ''; return; }
        // Measure text width using a hidden span
        if (!this._measureSpan) {
            this._measureSpan = document.createElement('span');
            this._measureSpan.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;';
            document.body.appendChild(this._measureSpan);
        }
        const style = getComputedStyle(input);
        this._measureSpan.style.font = style.font;
        this._measureSpan.textContent = input.value;
        const textWidth = this._measureSpan.offsetWidth;
        const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) +
                         parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
        const needed = textWidth + padding + 4;
        input.style.maxWidth = needed > 140 ? needed + 'px' : '';
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

        // Handle degrees format: strip ° suffix
        if (text.endsWith('°')) {
            text = text.slice(0, -1);
        }

        // Remove any remaining commas
        text = text.replace(/,/g, '');

        const value = Number(text);
        let result = isNaN(value) ? null : value * multiplier;
        if (result !== null && varFormat === 'degrees') {
            result = result - 360 * Math.floor(result / 360);
        }
        return result;
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

    /**
     * Create a collapsible table title element.
     * Title prefix: 'v' = open, '>' = closed. Toggling updates the source text.
     */
    _createTableTitle(table, wrapper) {
        if (!table.title) return null;

        const rawTitle = table.title;
        const firstChar = rawTitle.charAt(0);
        const collapsed = firstChar === '>';
        const displayTitle = (firstChar === 'v' || firstChar === '>') ? rawTitle.substring(1).trimStart() : rawTitle;

        const titleEl = document.createElement('div');
        titleEl.className = 'mathpad-table-title' + (collapsed ? ' collapsed' : '');
        titleEl.textContent = displayTitle;
        titleEl.style.fontSize = (table.fontSize || 14) + 'px';

        // Hide table/graph if collapsed
        if (collapsed) {
            setTimeout(() => {
                const contentEl = wrapper.querySelector('.mathpad-table, .mathpad-graph');
                if (contentEl) contentEl.style.display = 'none';
            }, 0);
        }

        titleEl.addEventListener('click', () => {
            const isCollapsed = titleEl.classList.toggle('collapsed');
            const contentEl = wrapper.querySelector('.mathpad-table, .mathpad-graph');
            if (contentEl) contentEl.style.display = isCollapsed ? 'none' : '';

            // Update title prefix in source text using startLine
            if (this.editor && table.startLine != null) {
                const text = this.editor.getValue();
                const lines = text.split('\n');
                const lineIdx = table.startLine - 1; // startLine is 1-based
                const line = lines[lineIdx];
                if (line) {
                    const match = line.match(/^((?:table|grid|tablegraph|gridgraph)\s*\(\s*")(.*)("\s*[;)])/i);
                    if (match) {
                        // Strip existing v/> prefix from source title
                        let srcTitle = match[2];
                        if (srcTitle.charAt(0) === 'v' || srcTitle.charAt(0) === '>') {
                            srcTitle = srcTitle.substring(1).trimStart();
                        }
                        const newPrefix = isCollapsed ? '> ' : 'v ';
                        lines[lineIdx] = line.replace(match[0], match[1] + newPrefix + srcTitle + match[3]);
                        this.editor.setValue(lines.join('\n'), false);
                    }
                }
            }
        });

        return titleEl;
    }

    /**
     * Set table data for display. Pass null to clear all tables.
     */
    setTableData(tables) {
        // Remove existing table containers
        for (const el of this.container.querySelectorAll('.variable-table-container')) {
            el.remove();
        }

        if (!tables || tables.length === 0) return;

        for (const table of tables) {
            if (table.type === 'graph') {
                this._renderGraph(table);
                continue;
            }
            if (table.type === 'gridGraph') {
                this._renderGridGraph(table);
                continue;
            }
            if (table.type === 'grid') {
                this._renderTable2(table);
                continue;
            }
            if (table.columns.length === 0 || table.rows.length === 0) continue;

            const wrapper = document.createElement('div');
            wrapper.className = 'variable-row variable-table-container';
            wrapper.dataset.lineIndex = table.startLine - 1;
            wrapper.dataset.type = 'table';

            // Title label
            const titleEl = this._createTableTitle(table, wrapper);
            if (titleEl) wrapper.appendChild(titleEl);

            const tableEl = document.createElement('table');
            tableEl.className = 'mathpad-table';
            if (table.fontSize) {
                tableEl.style.fontSize = table.fontSize + 'px';
            }

            // Header
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            for (const col of table.columns) {
                const th = document.createElement('th');
                th.textContent = col.header || col.name;
                headerRow.appendChild(th);
            }
            thead.appendChild(headerRow);
            tableEl.appendChild(thead);

            // Body
            const tbody = document.createElement('tbody');
            for (const row of table.rows) {
                const tr = document.createElement('tr');
                for (const cell of row) {
                    const td = document.createElement('td');
                    td.textContent = cell;
                    tr.appendChild(td);
                }
                tbody.appendChild(tr);
            }
            tableEl.appendChild(tbody);

            wrapper.appendChild(tableEl);
            this.insertRowInOrder(wrapper, table.startLine - 1);
            this._setStickyHeaderOffsets(wrapper);
        }
    }

    /**
     * Set sticky top offsets for thead rows to stack below the sticky title.
     */
    _setStickyHeaderOffsets(wrapper) {
        requestAnimationFrame(() => {
            const titleEl = wrapper.querySelector('.mathpad-table-title');
            // Match title width to table width so it covers all columns
            if (titleEl) {
                const tableEl = wrapper.querySelector('.mathpad-table');
                if (tableEl) titleEl.style.minWidth = tableEl.offsetWidth + 'px';
            }
            // Title sticks at -4px, so its bottom is at titleHeight - 4
            const titleBottom = titleEl ? (titleEl.offsetHeight - 4) : 0;
            const isGrid = wrapper.querySelector('.mathpad-grid');
            if (isGrid) {
                // Grid: make thead sticky as a unit (individual th sticky fails for leftmost cells)
                const thead = wrapper.querySelector('thead');
                if (thead) thead.style.top = titleBottom + 'px';
                // Set sticky left offset for row values (after the row label column)
                const rowLabel = wrapper.querySelector('.mathpad-grid-row-label');
                if (rowLabel) {
                    const rowValueLeft = rowLabel.offsetWidth - 8;
                    wrapper.querySelectorAll('.grid-row-value').forEach(th => {
                        th.style.left = rowValueLeft + 'px';
                    });
                }
            } else {
                // Table: individual th sticky
                const headerRows = wrapper.querySelectorAll('thead tr');
                let offset = titleBottom;
                for (const row of headerRows) {
                    for (const th of row.querySelectorAll('th')) {
                        th.style.top = offset + 'px';
                    }
                    offset += row.offsetHeight;
                }
            }
        });
    }

    /**
     * Render an SVG multi-line graph from gridGraph data.
     * X-axis: row header values (first output), lines: one per column (second output), Y-axis: cell values (third output)
     */
    _renderGridGraph(table) {
        if (!table.rawGrid || table.rawGrid.length === 0 || table.rawColHeaderValues.length === 0) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'variable-row variable-table-container';
        wrapper.dataset.lineIndex = table.startLine - 1;
        wrapper.dataset.type = 'table';

        const titleEl = this._createTableTitle(table, wrapper);
        if (titleEl) wrapper.appendChild(titleEl);

        const numRows = table.rawGrid.length;
        const numCols = table.rawColHeaderValues.length;
        const xValues = table.rawRowHeaderValues;

        // Color palette
        const colors = ['#4fc1ff', '#ff6b6b', '#51cf66', '#ffd43b', '#cc5de8', '#ff922b', '#20c997',
                         '#748ffc', '#f783ac', '#a9e34b', '#66d9e8', '#e599f7'];

        // Compute data range
        let yMin = Infinity, yMax = -Infinity, xMin = Infinity, xMax = -Infinity;
        for (let r = 0; r < numRows; r++) {
            const x = xValues[r];
            if (x != null && isFinite(x)) { if (x < xMin) xMin = x; if (x > xMax) xMax = x; }
            for (let c = 0; c < numCols; c++) {
                const y = table.rawGrid[r][c];
                if (y != null && isFinite(y)) { if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
            }
        }
        if (!isFinite(xMin) || !isFinite(yMin)) { this.insertRowInOrder(wrapper, table.startLine - 1); return; }
        const yPad = (yMax - yMin) * 0.05 || 1;
        yMin -= yPad; yMax += yPad;

        // Graph dimensions — legend above plot area
        const width = 550;
        let height = 384;
        const legendHeight = 28;
        const margin = { top: legendHeight + 5, right: 20, bottom: 45, left: 60 };
        const plotW = width - margin.left - margin.right;
        let plotH = height - margin.top - margin.bottom;

        const sx = (x) => margin.left + (x - xMin) / (xMax - xMin) * plotW;
        const sy = (y) => margin.top + (1 - (y - yMin) / (yMax - yMin)) * plotH;

        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('class', 'mathpad-graph');
        svg.style.width = '100%';
        svg.style.maxWidth = width + 'px';

        // Legend (horizontal, above plot — wraps to next line if too wide)
        const legendTitle = table.iter2Label || '';
        let legendX = margin.left;
        let legendY = 20;
        const legendLineHeight = 16;
        const legendMaxX = width - margin.right;
        if (legendTitle) {
            const text = document.createElementNS(ns, 'text');
            text.setAttribute('x', legendX); text.setAttribute('y', legendY);
            text.setAttribute('class', 'graph-text'); text.setAttribute('font-size', '11');
            text.setAttribute('font-weight', 'bold');
            text.textContent = legendTitle + ':';
            svg.appendChild(text);
            legendX += legendTitle.length * 7 + 10;
        }
        const legendIndent = legendX; // first key position — wrap lines align here
        for (let c = 0; c < numCols; c++) {
            const label = table.colValues[c] || String(c);
            const itemWidth = label.length * 6 + 25;
            if (legendX + itemWidth > legendMaxX && legendX > legendIndent) {
                legendX = legendIndent;
                legendY += legendLineHeight;
            }
            const color = colors[c % colors.length];
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', legendX); line.setAttribute('x2', legendX + 12);
            line.setAttribute('y1', legendY - 4); line.setAttribute('y2', legendY - 4);
            line.setAttribute('stroke', color); line.setAttribute('stroke-width', '2');
            svg.appendChild(line);
            const text = document.createElementNS(ns, 'text');
            text.setAttribute('x', legendX + 16); text.setAttribute('y', legendY);
            text.setAttribute('class', 'graph-text'); text.setAttribute('font-size', '10');
            text.textContent = label;
            svg.appendChild(text);
            legendX += itemWidth;
        }
        // Adjust layout if legend wrapped to multiple lines
        const legendRows = Math.ceil((legendY - 20) / legendLineHeight) + 1;
        if (legendRows > 1) {
            const extraHeight = (legendRows - 1) * legendLineHeight;
            margin.top += extraHeight;
            height += extraHeight;
            plotH = height - margin.top - margin.bottom;
        }
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

        // Colors via CSS classes (graph-text, graph-grid, graph-subgrid) for theme switching

        // Determine axis formats from columns
        const xFormat = table.columns.length > 0 ? table.columns[0].format : null;
        const yFormat = table.columns.length > 2 ? table.columns[2].format : null;
        const colFormat = table.columns.length > 1 ? table.columns[1].format : null;

        const xFmt = (v) => xFormat ? formatVariableValue(v, xFormat, false, table.formatOpts || {}) : this._formatTickLabel(v);
        const yFmt = (v) => yFormat ? formatVariableValue(v, yFormat, false, table.formatOpts || {}) : this._formatTickLabel(v);

        // Y-axis ticks — adjust left margin for label width
        const yTicks = this._niceTicks(yMin, yMax, 8, yFormat);
        const maxYLabel = Math.max(...yTicks.map(t => yFmt(t).length));
        const neededLeft = maxYLabel * 7 + 15; // ~7px per char + padding
        if (neededLeft > margin.left) {
            margin.left = neededLeft;
        }

        // Secondary grid lines (between primary ticks)
        for (let i = 0; i < yTicks.length - 1; i++) {
            const mid = sy((yTicks[i] + yTicks[i + 1]) / 2);
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', margin.left); line.setAttribute('x2', margin.left + plotW);
            line.setAttribute('y1', mid); line.setAttribute('y2', mid);
            line.setAttribute('class', 'graph-subgrid'); line.setAttribute('stroke-width', '0.5');
            svg.appendChild(line);
        }
        for (const tick of yTicks) {
            const y = sy(tick);
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', margin.left); line.setAttribute('x2', margin.left + plotW);
            line.setAttribute('y1', y); line.setAttribute('y2', y);
            line.setAttribute('class', 'graph-grid'); line.setAttribute('stroke-width', '0.5');
            svg.appendChild(line);
            const label = document.createElementNS(ns, 'text');
            label.setAttribute('x', margin.left - 5); label.setAttribute('y', y + 4);
            label.setAttribute('text-anchor', 'end'); label.setAttribute('class', 'graph-text');
            label.setAttribute('font-size', '11');
            label.textContent = yFmt(tick);
            svg.appendChild(label);
        }

        // X-axis ticks
        const xTicks = this._niceTicks(xMin, xMax, 8, xFormat);
        for (let i = 0; i < xTicks.length - 1; i++) {
            const mid = sx((xTicks[i] + xTicks[i + 1]) / 2);
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', mid); line.setAttribute('x2', mid);
            line.setAttribute('y1', margin.top); line.setAttribute('y2', margin.top + plotH);
            line.setAttribute('class', 'graph-subgrid'); line.setAttribute('stroke-width', '0.5');
            svg.appendChild(line);
        }
        for (const tick of xTicks) {
            const x = sx(tick);
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', x); line.setAttribute('x2', x);
            line.setAttribute('y1', margin.top); line.setAttribute('y2', margin.top + plotH);
            line.setAttribute('class', 'graph-grid'); line.setAttribute('stroke-width', '0.5');
            svg.appendChild(line);
            const label = document.createElementNS(ns, 'text');
            label.setAttribute('x', x); label.setAttribute('y', margin.top + plotH + 15);
            label.setAttribute('text-anchor', 'middle'); label.setAttribute('class', 'graph-text');
            label.setAttribute('font-size', '11');
            label.textContent = xFmt(tick);
            svg.appendChild(label);
        }

        // Plot border
        const border = document.createElementNS(ns, 'rect');
        border.setAttribute('x', margin.left); border.setAttribute('y', margin.top);
        border.setAttribute('width', plotW); border.setAttribute('height', plotH);
        border.setAttribute('fill', 'none'); border.setAttribute('class', 'graph-border');
        svg.appendChild(border);

        // Data lines — one per column
        for (let c = 0; c < numCols; c++) {
            let pathD = '';
            let started = false;
            for (let r = 0; r < numRows; r++) {
                const x = xValues[r], y = table.rawGrid[r][c];
                if (x == null || y == null || !isFinite(x) || !isFinite(y)) { started = false; continue; }
                const px = sx(x), py = sy(y);
                pathD += (started ? 'L' : 'M') + px.toFixed(2) + ',' + py.toFixed(2);
                started = true;
            }
            if (pathD) {
                const path = document.createElementNS(ns, 'path');
                path.setAttribute('d', pathD);
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke', colors[c % colors.length]);
                path.setAttribute('stroke-width', '2');
                path.setAttribute('stroke-linejoin', 'round');
                svg.appendChild(path);
            }
        }

        // Axis labels
        const xLabel = table.iter1Label || '';
        const yLabel = table.cellHeader || '';
        if (xLabel) {
            const text = document.createElementNS(ns, 'text');
            text.setAttribute('x', margin.left + plotW / 2); text.setAttribute('y', height - 5);
            text.setAttribute('text-anchor', 'middle'); text.setAttribute('class', 'graph-text');
            text.setAttribute('font-size', '12');
            text.textContent = xLabel;
            svg.appendChild(text);
        }
        if (yLabel) {
            const text = document.createElementNS(ns, 'text');
            text.setAttribute('x', 12); text.setAttribute('y', margin.top + plotH / 2);
            text.setAttribute('text-anchor', 'middle'); text.setAttribute('class', 'graph-text');
            text.setAttribute('font-size', '12');
            text.setAttribute('transform', `rotate(-90, 12, ${margin.top + plotH / 2})`);
            text.textContent = yLabel;
            svg.appendChild(text);
        }

        wrapper.appendChild(svg);
        this.insertRowInOrder(wrapper, table.startLine - 1);
        this._setStickyHeaderOffsets(wrapper);
    }

    /**
     * Render an SVG line graph from tableGraph data
     */
    _renderGraph(table) {
        if (!table.rawRows || table.rawRows.length === 0 || table.columns.length < 2) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'variable-row variable-table-container';
        wrapper.dataset.lineIndex = table.startLine - 1;
        wrapper.dataset.type = 'table';

        // Title
        const titleEl = this._createTableTitle(table, wrapper);
        if (titleEl) wrapper.appendChild(titleEl);

        // Extract x and y data from first two columns
        const xCol = 0, yCol = 1;
        const points = [];
        for (const row of table.rawRows) {
            const x = row[xCol], y = row[yCol];
            if (x != null && y != null && isFinite(x) && isFinite(y)) {
                points.push({ x, y });
            }
        }
        if (points.length === 0) { this.insertRowInOrder(wrapper, table.startLine - 1); return; }

        // Tick formatters using column format specifiers
        const xFmt = (v) => {
            const col = table.columns[xCol];
            return col.format ? formatVariableValue(v, col.format, false, table.formatOpts || {}) : this._formatTickLabel(v);
        };
        const yFmt = (v) => {
            const col = table.columns[yCol];
            return col.format ? formatVariableValue(v, col.format, false, table.formatOpts || {}) : this._formatTickLabel(v);
        };

        // Graph dimensions
        const width = 550, height = 360;
        const margin = { top: 20, right: 20, bottom: 45, left: 60 };
        let plotW = width - margin.left - margin.right;
        const plotH = height - margin.top - margin.bottom;

        // Data range
        let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
        for (const p of points) {
            if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x;
            if (p.y < yMin) yMin = p.y; if (p.y > yMax) yMax = p.y;
        }
        // Add padding to y range
        const yPad = (yMax - yMin) * 0.05 || 1;
        yMin -= yPad; yMax += yPad;

        const sx = (x) => margin.left + (x - xMin) / (xMax - xMin) * plotW;
        const sy = (y) => margin.top + (1 - (y - yMin) / (yMax - yMin)) * plotH;

        // Build SVG
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('class', 'mathpad-graph');
        svg.style.width = '100%';
        svg.style.maxWidth = width + 'px';

        // Grid lines and axes
        // Colors via CSS classes (graph-text, graph-grid, graph-subgrid) for theme switching
        // Data line color via CSS class (graph-line) for theme switching

        // Y-axis ticks — adjust left margin for label width
        const yTicks = this._niceTicks(yMin, yMax, 8, table.columns[yCol].format);
        const maxYLabel = Math.max(...yTicks.map(t => yFmt(t).length));
        const neededLeft = maxYLabel * 7 + 15;
        if (neededLeft > margin.left) {
            margin.left = neededLeft;
            plotW = width - margin.left - margin.right;
        }
        for (let i = 0; i < yTicks.length - 1; i++) {
            const mid = sy((yTicks[i] + yTicks[i + 1]) / 2);
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', margin.left); line.setAttribute('x2', margin.left + plotW);
            line.setAttribute('y1', mid); line.setAttribute('y2', mid);
            line.setAttribute('class', 'graph-subgrid'); line.setAttribute('stroke-width', '0.5');
            svg.appendChild(line);
        }
        for (const tick of yTicks) {
            const y = sy(tick);
            // Grid line
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', margin.left); line.setAttribute('x2', margin.left + plotW);
            line.setAttribute('y1', y); line.setAttribute('y2', y);
            line.setAttribute('class', 'graph-grid'); line.setAttribute('stroke-width', '0.5');
            svg.appendChild(line);
            // Label
            const label = document.createElementNS(ns, 'text');
            label.setAttribute('x', margin.left - 5); label.setAttribute('y', y + 4);
            label.setAttribute('text-anchor', 'end'); label.setAttribute('class', 'graph-text');
            label.setAttribute('font-size', '11');
            label.textContent = yFmt(tick);
            svg.appendChild(label);
        }

        // X-axis ticks
        const xTicks = this._niceTicks(xMin, xMax, 8, table.columns[xCol].format);
        for (let i = 0; i < xTicks.length - 1; i++) {
            const mid = sx((xTicks[i] + xTicks[i + 1]) / 2);
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', mid); line.setAttribute('x2', mid);
            line.setAttribute('y1', margin.top); line.setAttribute('y2', margin.top + plotH);
            line.setAttribute('class', 'graph-subgrid'); line.setAttribute('stroke-width', '0.5');
            svg.appendChild(line);
        }
        for (const tick of xTicks) {
            const x = sx(tick);
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', x); line.setAttribute('x2', x);
            line.setAttribute('y1', margin.top); line.setAttribute('y2', margin.top + plotH);
            line.setAttribute('class', 'graph-grid'); line.setAttribute('stroke-width', '0.5');
            svg.appendChild(line);
            const label = document.createElementNS(ns, 'text');
            label.setAttribute('x', x); label.setAttribute('y', margin.top + plotH + 15);
            label.setAttribute('text-anchor', 'middle'); label.setAttribute('class', 'graph-text');
            label.setAttribute('font-size', '11');
            label.textContent = xFmt(tick);
            svg.appendChild(label);
        }

        // Zero lines (if in range)
        if (yMin <= 0 && yMax >= 0) {
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', margin.left); line.setAttribute('x2', margin.left + plotW);
            line.setAttribute('y1', sy(0)); line.setAttribute('y2', sy(0));
            line.setAttribute('class', 'graph-zero'); line.setAttribute('stroke-width', '1');
            svg.appendChild(line);
        }
        if (xMin <= 0 && xMax >= 0) {
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', sx(0)); line.setAttribute('x2', sx(0));
            line.setAttribute('y1', margin.top); line.setAttribute('y2', margin.top + plotH);
            line.setAttribute('class', 'graph-zero'); line.setAttribute('stroke-width', '1');
            svg.appendChild(line);
        }

        // Plot border
        const border = document.createElementNS(ns, 'rect');
        border.setAttribute('x', margin.left); border.setAttribute('y', margin.top);
        border.setAttribute('width', plotW); border.setAttribute('height', plotH);
        border.setAttribute('fill', 'none'); border.setAttribute('class', 'graph-border');
        svg.appendChild(border);

        // Data line
        let pathD = '';
        for (let i = 0; i < points.length; i++) {
            const px = sx(points[i].x), py = sy(points[i].y);
            pathD += (i === 0 ? 'M' : 'L') + px.toFixed(2) + ',' + py.toFixed(2);
        }
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', pathD);
        path.setAttribute('fill', 'none');
        path.setAttribute('class', 'graph-line');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path);

        // Axis labels
        const xLabel = table.columns[xCol].header || table.columns[xCol].name;
        const yLabel = table.columns[yCol].header || table.columns[yCol].name;
        if (xLabel) {
            const text = document.createElementNS(ns, 'text');
            text.setAttribute('x', margin.left + plotW / 2); text.setAttribute('y', height - 5);
            text.setAttribute('text-anchor', 'middle'); text.setAttribute('class', 'graph-text');
            text.setAttribute('font-size', '12');
            text.textContent = xLabel;
            svg.appendChild(text);
        }
        if (yLabel) {
            const text = document.createElementNS(ns, 'text');
            text.setAttribute('x', 12); text.setAttribute('y', margin.top + plotH / 2);
            text.setAttribute('text-anchor', 'middle'); text.setAttribute('class', 'graph-text');
            text.setAttribute('font-size', '12');
            text.setAttribute('transform', `rotate(-90, 12, ${margin.top + plotH / 2})`);
            text.textContent = yLabel;
            svg.appendChild(text);
        }

        wrapper.appendChild(svg);
        this.insertRowInOrder(wrapper, table.startLine - 1);
        this._setStickyHeaderOffsets(wrapper);
    }

    /**
     * Generate nice tick values for an axis
     */
    _niceTicks(min, max, count, format) {
        const range = max - min;
        if (range === 0) return [min];

        let step;
        if (format === 'duration') {
            // Use time-friendly intervals
            const timeSteps = [1, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
                7200, 10800, 21600, 43200, 86400];
            const rough = range / count;
            step = timeSteps.find(s => s >= rough) || rough;
        } else {
            const rough = range / count;
            const mag = Math.pow(10, Math.floor(Math.log10(rough)));
            const norm = rough / mag;
            step = norm < 1.5 ? mag : norm < 3 ? 2 * mag : norm < 7 ? 5 * mag : 10 * mag;
        }
        const start = Math.ceil(min / step) * step;
        const ticks = [];
        for (let v = start; v <= max + step * 0.01; v += step) {
            ticks.push(Math.round(v / step) * step); // avoid FP drift
        }
        return ticks;
    }

    /**
     * Format a tick label (strip trailing zeros)
     */
    _formatTickLabel(value) {
        if (Number.isInteger(value)) return String(value);
        const s = value.toPrecision(6).replace(/\.?0+$/, '');
        return s;
    }

    /**
     * Render a 2D grid with row/column iterator labels
     */
    _renderTable2(table) {
        if (table.grid.length === 0 || table.colValues.length === 0) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'variable-row variable-table-container';
        wrapper.dataset.lineIndex = table.startLine - 1;
        wrapper.dataset.type = 'table';

        // Title label
        const titleEl = this._createTableTitle(table, wrapper);
        if (titleEl) wrapper.appendChild(titleEl);

        const tableEl = document.createElement('table');
        tableEl.className = 'mathpad-table mathpad-grid';
        if (table.fontSize) tableEl.style.fontSize = table.fontSize + 'px';

        const numRows = table.rowValues.length;
        const numCols = table.colValues.length;

        // Header row 1: empty + empty + iter2Label spanning columns
        const thead = document.createElement('thead');
        const headerRow1 = document.createElement('tr');
        headerRow1.appendChild(document.createElement('th')); // x label column
        headerRow1.appendChild(document.createElement('th')); // row values column
        const iter2Th = document.createElement('th');
        iter2Th.textContent = table.iter2Label;
        iter2Th.colSpan = numCols;
        iter2Th.className = 'mathpad-grid-label';
        headerRow1.appendChild(iter2Th);
        thead.appendChild(headerRow1);

        // Header row 2: cell header label (spanning 2 cols) + column values
        const headerRow2 = document.createElement('tr');
        const cellHeaderTh = document.createElement('th');
        cellHeaderTh.textContent = table.cellHeader || '';
        cellHeaderTh.colSpan = 2;
        cellHeaderTh.className = 'mathpad-grid-label';
        cellHeaderTh.style.textAlign = 'right';
        headerRow2.appendChild(cellHeaderTh);
        for (let c = 0; c < table.colValues.length; c++) {
            const th = document.createElement('th');
            th.textContent = table.colValues[c];
            th.dataset.col = c;
            th.className = 'grid-col-value';
            headerRow2.appendChild(th);
        }
        thead.appendChild(headerRow2);
        tableEl.appendChild(thead);

        // Body rows
        const tbody = document.createElement('tbody');
        const midRow = Math.floor(numRows / 2);

        for (let r = 0; r < numRows; r++) {
            const tr = document.createElement('tr');

            // iter1 label (only on first row, spanning all rows)
            if (r === 0) {
                const labelTh = document.createElement('th');
                const labelDiv = document.createElement('div');
                labelDiv.textContent = table.iter1Label;
                labelDiv.className = 'mathpad-grid-row-label-text';
                labelTh.appendChild(labelDiv);
                labelTh.rowSpan = numRows;
                labelTh.className = 'mathpad-grid-label mathpad-grid-row-label';
                tr.appendChild(labelTh);
            }

            // Row value
            const rowTh = document.createElement('th');
            rowTh.textContent = table.rowValues[r];
            rowTh.className = 'grid-row-value';
            tr.appendChild(rowTh);

            // Cell values
            for (let c = 0; c < numCols; c++) {
                const td = document.createElement('td');
                td.textContent = table.grid[r][c] || '';
                td.dataset.col = c;
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        tableEl.appendChild(tbody);

        // Column + header hover highlighting
        // Hovering a column header highlights that column
        for (const th of headerRow2.querySelectorAll('.grid-col-value')) {
            th.addEventListener('mouseenter', () => {
                const col = th.dataset.col;
                th.classList.add('col-hover');
                for (const cell of tbody.querySelectorAll(`td[data-col="${col}"]`)) {
                    cell.classList.add('col-hover');
                }
            });
            th.addEventListener('mouseleave', () => {
                const col = th.dataset.col;
                th.classList.remove('col-hover');
                for (const cell of tbody.querySelectorAll(`td[data-col="${col}"]`)) {
                    cell.classList.remove('col-hover');
                }
            });
        }

        const colHeaderRow = thead.rows[1]; // row with column values
        tableEl.addEventListener('mouseenter', (e) => {
            const td = e.target.closest('td');
            if (!td || td.dataset.col == null) return;
            const col = td.dataset.col;
            for (const cell of tbody.querySelectorAll(`td[data-col="${col}"]`)) {
                cell.classList.add('col-hover');
            }
            // Highlight column header (offset by 1 for the merged cell)
            const colHeader = colHeaderRow && headerRow2.cells[parseInt(col) + 1];
            if (colHeader) colHeader.classList.add('col-hover');
            // Highlight row header (the <th> in the same <tr>)
            const rowTh = td.parentElement.querySelector('.grid-row-value');
            if (rowTh) rowTh.classList.add('col-hover');
        }, true);
        tableEl.addEventListener('mouseleave', (e) => {
            const td = e.target.closest('td');
            if (!td || td.dataset.col == null) return;
            const col = td.dataset.col;
            for (const cell of tbody.querySelectorAll(`td[data-col="${col}"]`)) {
                cell.classList.remove('col-hover');
            }
            const colHeader = colHeaderRow && headerRow2.cells[parseInt(col) + 1];
            if (colHeader) colHeader.classList.remove('col-hover');
            const rowTh = td.parentElement.querySelector('.grid-row-value');
            if (rowTh) rowTh.classList.remove('col-hover');
        }, true);

        wrapper.appendChild(tableEl);
        this.insertRowInOrder(wrapper, table.startLine - 1);
        this._setStickyHeaderOffsets(wrapper);
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VariablesPanel };
}
