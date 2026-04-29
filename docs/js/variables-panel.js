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
        this.hasClearedInput = false; // True if user cleared an input since last solve/clear
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
        // Detect --Variables-- section marker
        const varsSectionStart = text.indexOf('--Variables--');
        const varsSectionLineIndex = varsSectionStart >= 0
            ? text.substring(0, varsSectionStart).split('\n').length - 1
            : -1; // -1 means no marker → current behavior

        // Table Outputs section is always excluded from the panel.
        // References section is excluded by default. It's shown only when
        // BOTH Ctrl+Solve was used (Trace section in text is the signal) AND
        // --Variables-- is present (so the header line can render as a
        // labeled section). Solve Trace itself always renders as a label.
        // Append order in solveRecord: refs → tableOutputs → trace, so refs
        // and tableOutputs are contiguous and end at the trace marker.
        const tableOutputStart = text.indexOf('"--- Table Outputs ---"');
        const tableOutputLineIndex = tableOutputStart >= 0
            ? text.substring(0, tableOutputStart).split('\n').length - 1
            : Infinity;
        const traceMatch = text.match(/"\*?--- Solve Trace ---"/);
        const traceSectionLineIndex = traceMatch
            ? text.substring(0, traceMatch.index).split('\n').length - 1
            : Infinity;
        const refsMatch = text.match(/"\*?--- Reference Constants and Functions ---"/);
        const showRefs = traceMatch && varsSectionLineIndex >= 0;
        const refsSectionLineIndex = (refsMatch && !showRefs)
            ? text.substring(0, refsMatch.index).split('\n').length - 1
            : Infinity;

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

        // Remove References + Table Outputs section items from panel (shown in
        // formulas only). Trace section after them is preserved.
        const excludeStart = Math.min(refsSectionLineIndex, tableOutputLineIndex);
        for (const lineIndex of [...newDeclMap.keys()]) {
            if (lineIndex >= excludeStart && lineIndex < traceSectionLineIndex) {
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
                // In References or Table Outputs section (but not Solve Trace after them)
                if (i >= excludeStart && i < traceSectionLineIndex) continue;
                if (consumedLines.has(i)) continue; // Part of a multi-line comment
                if (tableSkipLines.has(i + 1)) continue; // Inside table definition

                const line = lines[i];
                const trimmed = line.trim();

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
        const limitsStr = decl.limits
            ? `[${tokensToText(decl.limits.lowTokens).trim()}:${tokensToText(decl.limits.highTokens).trim()}${decl.limits.stepTokens ? ':' + tokensToText(decl.limits.stepTokens).trim() : ''}]`
            : '';
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
                if (!e.target.value.trim()) this.hasClearedInput = true;
                // Skip the quick-solve blur callback if the user is about to Ctrl+click
                // the solve button (the click handler will fire a trace solve instead).
                if (this._skipNextBlurSolve) { this._skipNextBlurSolve = false; return; }
                if (this.blurCallback && !this.hasClearedInput) this.blurCallback();
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
            // mousedown sets a flag so the upcoming blur (fired before click
            // when an input is focused) doesn't trigger a quick-solve before
            // the click handler runs its own solve.
            solveBtn.addEventListener('mousedown', () => {
                this._skipNextBlurSolve = true;
            });
            solveBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this._skipNextBlurSolve = false; // clear flag set by mousedown
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
                // Ctrl+click enables the solve trace output;
                // Shift+click appends the "--- Table Outputs ---" text section
                this.lastEditedVar = null;
                if (this.solveCallback) {
                    this.solveCallback(!cleared, !!e.ctrlKey, !!e.shiftKey);
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
        if (varFormat === 'money' || /[$€£¥₹₩₱₺₴₫₡₽₸₼₾৳]/.test(text)) {
            const sym = this.record.currencySymbol || '$';
            let num = text.replace(/[$€£¥₹₩₱₺₴₫₡₽₸₼₾৳,]/g, '').trim();
            const negative = num.startsWith('-');
            if (negative) num = num.substring(1).trim();
            const isSuffix = suffixCurrencies.includes(sym);
            return (negative ? '-' : '') + (isSuffix ? addCommaGrouping(num) + sym : sym + addCommaGrouping(num));
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

        // Handle date variables — reformat to full locale date
        if (varFormat === 'date') {
            return formatDateValue(parsedValue, text.includes(':'));
        }

        // Handle duration variables — format as H:MM:SS
        if (varFormat === 'duration') {
            if (text.includes(':')) return text; // already colon format
            return formatDuration(parsedValue, false);
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

        // Handle money format: $1,234.56 or -€1,234.56 etc.
        if (/[$€£¥₹₩₱₺₴₫₡₽₸₼₾৳,]/.test(text)) {
            text = text.replace(/[$€£¥₹₩₱₺₴₫₡₽₸₼₾৳,]/g, '');
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

        // Handle date format
        if (varFormat === 'date') {
            const dateVal = parseDateText(text);
            if (dateVal !== null) return dateVal;
        }

        // Handle duration format
        if (varFormat === 'duration') {
            const durVal = parseDurationText(text);
            if (durVal !== null) return durVal;
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
     * Register a callback for input field blur (quick solve)
     */
    onBlur(callback) {
        this.blurCallback = callback;
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

        // Apply green/orange highlighting unless there are non-balance errors (red)
        const hasHardErrors = errors && errors.some(e => !e.includes("doesn't balance"));
        if (!hasHardErrors && equationVarStatus) {
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
        this.hasClearedInput = false;
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
        titleEl.style.fontSize = (table.fontSize || 14) + 'px';

        // View-toggle button (placed BEFORE the title text so horizontal
        // scroll doesn't push it off-screen): swaps source keyword between
        // table↔tableGraph or grid↔gridGraph. Persisted in the source itself.
        const swapTarget = {
            'table': 'tableGraph',
            'tablegraph': 'table',
            'grid': 'gridGraph',
            'gridgraph': 'grid',
        }[(table.keyword || '').toLowerCase()];
        // Hide the swap-to-graph toggle when the data wouldn't make a useful
        // line graph (need ≥2 X-axis points). Always allow swap-to-data.
        let allowSwap = swapTarget && this.editor && table.startLine != null;
        if (allowSwap && swapTarget === 'tableGraph') {
            allowSwap = (table.rows && table.rows.length >= 2);
        } else if (allowSwap && swapTarget === 'gridGraph') {
            allowSwap = (table.rowValues && table.rowValues.length >= 2);
        }
        if (allowSwap) {
            const toggleBtn = document.createElement('span');
            toggleBtn.className = 'table-view-toggle';
            const targetLabel = swapTarget.endsWith('Graph')
                ? 'graph'
                : (swapTarget === 'grid' ? 'grid' : 'table');
            toggleBtn.textContent = `as ${targetLabel}`;
            toggleBtn.title = `Show as ${swapTarget}`;
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const text = this.editor.getValue();
                const lines = text.split('\n');
                const lineIdx = table.startLine - 1;
                const line = lines[lineIdx];
                if (!line) return;
                const m = line.match(/^(\s*)(table|grid|tablegraph|gridgraph)(\s*\()/i);
                if (!m) return;
                lines[lineIdx] = m[1] + swapTarget + m[3] + line.substring(m[0].length);
                // Push the keyword change as a single undo entry, then ask
                // solve to mutate that same entry (undoable=false on solve)
                // so one Ctrl+Z reverts both keyword and re-solve at once.
                this.editor.setValue(lines.join('\n'), true);
                if (this.solveCallback) this.solveCallback(false, false);
            });
            titleEl.appendChild(toggleBtn);
        }

        const titleText = document.createElement('span');
        titleText.className = 'mathpad-table-title-text';
        titleText.textContent = displayTitle;
        titleEl.appendChild(titleText);

        if (table.solveInfo) {
            const indicator = document.createElement('span');
            indicator.className = 'table-solve-info';
            indicator.textContent = ` (${table.solveInfo.solved}/${table.solveInfo.total} solved)`;
            titleEl.appendChild(indicator);
        }

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
                    const match = line.match(/^((?:table|grid|tablegraph|gridgraph|vectordraw)\s*\(\s*")(.*)("\s*[;)])/i);
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
                // Route gridGraph through tableGraph's _renderGraph — solve-engine
                // emits a flat rawRows shape and forces col 1 as the grouping
                // column to preserve gridGraph's positional contract.
                this._renderGraph(table);
                continue;
            }
            if (table.type === 'vectorDraw') {
                this._renderVectorDraw(table);
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

        // X from first column, Y from all remaining columns
        const xCol = 0;
        const yCols = [];
        for (let c = 1; c < table.columns.length; c++) yCols.push(c);
        if (yCols.length === 0) { this.insertRowInOrder(wrapper, table.startLine - 1); return; }

        // Color palette for multiple lines
        const colors = ['#4fc1ff', '#ff6b6b', '#51cf66', '#ffd43b', '#cc5de8', '#ff922b', '#20c997',
                         '#748ffc', '#f783ac', '#a9e34b', '#66d9e8', '#e599f7'];

        // Build the list of lines to draw. Each line: { label, yc, rowIndexes }.
        //
        // Grouping columns = output columns whose variable name matches an
        // iterator other than the X-axis variable (col 0). Their presence as
        // declared outputs is what enables grouping — without `y->`, an inner
        // iterator just sweeps silently and produces no separate lines.
        // Each grouping column contributes its header to the legend label
        // ("Y = 1.0" when the column is `Y y->`).
        //
        // Y-series columns = remaining output columns past col 0 (those not
        // claimed by grouping). Each (group × Y-series) pair becomes one line.
        const iteratorNames = new Set(table.iteratorNames || []);
        const xColName = table.columns[xCol].name;
        const groupingCols = [];
        for (let c = 1; c < table.columns.length; c++) {
            const col = table.columns[c];
            if (col.name !== xColName && iteratorNames.has(col.name)) {
                groupingCols.push({ colIdx: c, col });
            }
        }
        // Don't promote so many columns to grouping that nothing's left to plot.
        // Catches the 2-column "iterator on Y axis" case (col 0 = X, col 1 =
        // iterator output the user wants AS the Y series). Without this, all
        // yCols get classified as grouping, ySeriesCols ends up empty, yMin
        // stays Infinity, and _renderGraph silently early-returns with no SVG.
        if (groupingCols.length >= yCols.length) {
            groupingCols.pop();
        }
        const groupingIdxSet = new Set(groupingCols.map(g => g.colIdx));
        const ySeriesCols = yCols.filter(c => !groupingIdxSet.has(c));

        // Auto-promote a Y-series column to grouping when it cycles in lockstep
        // with an inner iterator that has no output of its own. Example:
        // `nHours: 1..4..0.25` (no `nHours->`) + `hours = nHours*3600` +
        // `Hours hours@t->` — `hours` isn't an iterator name, but its values
        // form the same regular grid as `nHours`, so it should drive grouping
        // instead of being plotted as a Y-series. Only triggers when no name-
        // based grouping was found, exactly one column qualifies, and at least
        // one Y-series remains.
        if (groupingCols.length === 0 && ySeriesCols.length >= 2 && table.rawRows.length > 0) {
            const xGroups = new Map();
            for (const row of table.rawRows) {
                const x = row[xCol];
                if (!xGroups.has(x)) xGroups.set(x, []);
                xGroups.get(x).push(row);
            }
            const xKeys = [...xGroups.keys()];
            if (xKeys.length > 1) {
                const candidates = [];
                for (const yc of ySeriesCols) {
                    const sets = xKeys.map(x =>
                        new Set(xGroups.get(x).map(r => r[yc]).filter(v => v != null && isFinite(v)))
                    );
                    if (sets[0].size < 2) continue;
                    const ref = sets[0];
                    const same = sets.every(s => s.size === ref.size && [...s].every(v => ref.has(v)));
                    if (same) candidates.push(yc);
                }
                if (candidates.length === 1) {
                    const yc = candidates[0];
                    groupingCols.push({ colIdx: yc, col: table.columns[yc] });
                    groupingIdxSet.add(yc);
                    ySeriesCols.splice(ySeriesCols.indexOf(yc), 1);
                }
            }
        }

        // Legend partitioned by Y series. Each first-in-series line carries
        // a bold rowPrefix; subsequent lines in the same series contribute
        // value-only items.
        //   single Y series  → prefix "y, z:" then items "0, 0", "0, 3", ...
        //   multi  Y series  → prefix "First (y, z):" / "Second (y, z):"
        //                       per series, items as value tuples
        // No grouping cols: one line per Y col, no prefix (label = Y name).
        const lines = [];
        if (groupingCols.length > 0 && ySeriesCols.length > 0) {
            const groups = new Map();
            for (let r = 0; r < table.rawRows.length; r++) {
                const vals = groupingCols.map(g => table.rawRows[r][g.colIdx]);
                const key = JSON.stringify(vals);
                if (!groups.has(key)) groups.set(key, { values: vals, rowIndexes: [] });
                groups.get(key).rowIndexes.push(r);
            }
            const fmt = table.formatOpts || {};
            const groupHeaders = groupingCols.map(g => g.col.header || g.col.name).join(', ');
            for (const yc of ySeriesCols) {
                const yColName = table.columns[yc].header || table.columns[yc].name;
                let firstInSeries = true;
                for (const group of groups.values()) {
                    const valueLabel = groupingCols.map((g, i) => {
                        const v = group.values[i];
                        return v != null && isFinite(v)
                            ? formatVariableValue(v, g.col.format, g.col.fullPrecision, fmt)
                            : String(v);
                    }).join(', ');
                    const rowPrefix = firstInSeries
                        ? (ySeriesCols.length > 1 ? `${yColName} (${groupHeaders}):` : `${groupHeaders}:`)
                        : null;
                    firstInSeries = false;
                    lines.push({ label: valueLabel, yc, rowIndexes: group.rowIndexes, rowPrefix });
                }
            }
        } else {
            // Fallback: one line per Y column over all rows (single-iter or
            // multi-iter with no grouping outputs declared).
            for (const yc of yCols) {
                lines.push({
                    label: table.columns[yc].header || table.columns[yc].name,
                    yc,
                    rowIndexes: table.rawRows.map((_, i) => i),
                    rowPrefix: null
                });
            }
        }
        const multiLine = lines.length > 1;

        // Tick formatters
        const xFmt = (v) => {
            const col = table.columns[xCol];
            return col.format ? formatVariableValue(v, col.format, col.fullPrecision, table.formatOpts || {}) : this._formatTickLabel(v);
        };
        // Y-axis format comes from the first Y-series column, not the first
        // non-X column — when col 1 is a grouping column (e.g. gridGraph's
        // forced col-1 grouping), its format would mis-format the Y ticks.
        const yFmtCol = ySeriesCols.length > 0 ? table.columns[ySeriesCols[0]] : table.columns[yCols[0]];
        const yFmt = (v) => yFmtCol.format
            ? formatVariableValue(v, yFmtCol.format, yFmtCol.fullPrecision, table.formatOpts || {})
            : this._formatTickLabel(v);

        // Graph dimensions
        const width = 550;
        let height = multiLine ? 384 : 360;
        const legendHeight = multiLine ? 28 : 0;
        const margin = { top: legendHeight + (multiLine ? 5 : 20), right: 20, bottom: 45, left: 60 };
        let plotW = width - margin.left - margin.right;
        let plotH = height - margin.top - margin.bottom;

        // Data range across Y-series columns only — grouping columns hold
        // iterator values (one line per group), not points to plot, so their
        // range shouldn't stretch the y-axis.
        let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
        for (const row of table.rawRows) {
            const x = row[xCol];
            if (x != null && isFinite(x)) { if (x < xMin) xMin = x; if (x > xMax) xMax = x; }
            for (const yc of ySeriesCols) {
                const y = row[yc];
                if (y != null && isFinite(y)) { if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
            }
        }
        if (!isFinite(xMin) || !isFinite(yMin)) { this.insertRowInOrder(wrapper, table.startLine - 1); return; }
        const yPad = (yMax - yMin) * 0.05 || 1;
        yMin -= yPad; yMax += yPad;

        const sx = (x) => margin.left + (x - xMin) / (xMax - xMin) * plotW;
        const sy = (y) => margin.top + (1 - (y - yMin) / (yMax - yMin)) * plotH;

        // Build SVG
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('class', 'mathpad-graph');
        svg.style.width = '100%';
        svg.style.maxWidth = width + 'px';

        // Pre-compute y-axis margin from tick label width
        const yTicks = this._niceTicks(yMin, yMax, 8, yFmtCol.format);
        const maxYLabel = Math.max(...yTicks.map(t => yFmt(t).length));
        const neededLeft = maxYLabel * 7 + 15;
        if (neededLeft > margin.left) {
            margin.left = neededLeft;
            plotW = width - margin.left - margin.right;
        }

        // Legend for multi-line graphs
        if (multiLine) {
            let legendX = margin.left;
            let legendY = 20;
            const legendLineHeight = 16;
            const legendMaxX = width - margin.right;
            let rowIndent = margin.left;
            for (let i = 0; i < lines.length; i++) {
                const lineMeta = lines[i];
                if (lineMeta.rowPrefix) {
                    if (i > 0) { legendY += legendLineHeight; }
                    legendX = margin.left;
                    const text = document.createElementNS(ns, 'text');
                    text.setAttribute('x', legendX); text.setAttribute('y', legendY);
                    text.setAttribute('class', 'graph-text'); text.setAttribute('font-size', '11');
                    text.setAttribute('font-weight', 'bold');
                    text.textContent = lineMeta.rowPrefix;
                    svg.appendChild(text);
                    legendX += lineMeta.rowPrefix.length * 7 + 10;
                    rowIndent = legendX;
                }
                const label = lineMeta.label;
                const itemWidth = label.length * 6 + 25;
                if (legendX + itemWidth > legendMaxX && legendX > rowIndent) {
                    legendX = rowIndent;
                    legendY += legendLineHeight;
                }
                const color = colors[i % colors.length];
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
            const legendRows = Math.ceil((legendY - 20) / legendLineHeight) + 1;
            if (legendRows > 1) {
                const extraHeight = (legendRows - 1) * legendLineHeight;
                margin.top += extraHeight;
                height += extraHeight;
                plotH = height - margin.top - margin.bottom;
            }
        }
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

        const xTicks = this._niceTicks(xMin, xMax, 8, table.columns[xCol].format);
        this._drawGraphAxes({ svg, ns, margin, plotW, plotH, xMin, xMax, yMin, yMax, sx, sy, xTicks, yTicks, xFmt, yFmt, showZeroLines: true });

        // Data lines — one per entry in `lines`
        for (let li = 0; li < lines.length; li++) {
            const { yc, rowIndexes } = lines[li];
            let pathD = '';
            let started = false;
            for (const r of rowIndexes) {
                const row = table.rawRows[r];
                const x = row[xCol], y = row[yc];
                if (x == null || y == null || !isFinite(x) || !isFinite(y)) { started = false; continue; }
                const px = sx(x), py = sy(y);
                pathD += (started ? 'L' : 'M') + px.toFixed(2) + ',' + py.toFixed(2);
                started = true;
            }
            if (pathD) {
                const path = document.createElementNS(ns, 'path');
                path.setAttribute('d', pathD);
                path.setAttribute('fill', 'none');
                if (multiLine) {
                    path.setAttribute('stroke', colors[li % colors.length]);
                } else {
                    path.setAttribute('class', 'graph-line');
                }
                path.setAttribute('stroke-width', '2');
                path.setAttribute('stroke-linejoin', 'round');
                svg.appendChild(path);
            }
        }

        // Axis labels — show Y label when all lines plot the same Y column.
        // Use ySeriesCols (excludes grouping cols) so a graph with
        // `X x->`, `Y y->`, `Z z->` still labels the Y axis as "Z".
        const xLabel = table.columns[xCol].header || table.columns[xCol].name;
        const yAxisCols = ySeriesCols.length > 0 ? ySeriesCols : yCols;
        const yLabel = yAxisCols.length === 1 ? (table.columns[yAxisCols[0]].header || table.columns[yAxisCols[0]].name) : '';
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
     * Render a vectorDraw block: SVG diagram of vectors with arrowheads.
     * Each vector has start and end. The pair semantics depend on table.vectorType:
     *   navigation — (dir, mag) bearing; 0° = up, +° clockwise
     *   polar      — (dir, mag) math; 0° = right, +° counter-clockwise
     *   cartesian  — (x, y) raw coordinates
     * Both halves of each pair are SVG y-down coordinates.
     */
    _renderVectorDraw(table) {
        if (!table.vectors || table.vectors.length === 0) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'variable-row variable-table-container';
        wrapper.dataset.lineIndex = table.startLine - 1;
        wrapper.dataset.type = 'table';

        const titleEl = this._createTableTitle(table, wrapper);
        if (titleEl) wrapper.appendChild(titleEl);

        const colors = ['#4ade80', '#60a5fa', '#fb923c', '#f472b6', '#a78bfa', '#facc15', '#34d399'];

        // Pick the (a, b) → (x, y) conversion based on vectorType. SVG's
        // y-axis points down, so we negate the up-direction component.
        const vectorType = table.vectorType || 'navigation';
        const degreesMode = table.formatOpts && table.formatOpts.degreesMode !== false;
        const toRad = (angle) => degreesMode ? angle * Math.PI / 180 : angle;
        const pairToXY = (a, b) => {
            if (a == null || b == null || !isFinite(a) || !isFinite(b)) return null;
            if (vectorType === 'cartesian') {
                return { x: a, y: -b };
            }
            const r = toRad(a);
            if (vectorType === 'polar') {
                // 0° = +x (right), 90° = +y (up). Standard math convention.
                return { x: Math.cos(r) * b, y: -Math.sin(r) * b };
            }
            // navigation (default): 0° = up (north), 90° = right (east). Bearing.
            return { x: Math.sin(r) * b, y: -Math.cos(r) * b };
        };

        // Each vector has a start point in absolute coords. The end pair's
        // semantics depend on type: navigation/polar give it as a relative
        // (direction, magnitude) displacement (added to start); cartesian
        // gives it as an absolute (end_x, end_y) destination.
        const segs = [];
        let minX = 0, maxX = 0, minY = 0, maxY = 0;
        for (let i = 0; i < table.vectors.length; i++) {
            const v = table.vectors[i];
            const start = pairToXY(v.startDir, v.startMag);
            const endPair = pairToXY(v.endDir, v.endMag);
            if (!start || !endPair) {
                segs.push(null);
                continue;
            }
            const end = vectorType === 'cartesian'
                ? endPair
                : { x: start.x + endPair.x, y: start.y + endPair.y };
            segs.push({ start, end, color: colors[i % colors.length], vector: v });
            for (const p of [start, end]) {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
            }
        }
        // Always include origin in viewport
        minX = Math.min(minX, 0); maxX = Math.max(maxX, 0);
        minY = Math.min(minY, 0); maxY = Math.max(maxY, 0);

        // SVG layout
        const width = 550;
        const margin = { top: 30, right: 20, bottom: 20, left: 20 };
        // Legend
        const legendLineHeight = 18;
        const legendH = table.vectors.length * legendLineHeight + 16;
        const plotH = 360;
        const height = margin.top + plotH + legendH + margin.bottom;
        const plotW = width - margin.left - margin.right;

        const spanX = (maxX - minX) || 1;
        const spanY = (maxY - minY) || 1;
        const pad = 30;
        const scale = Math.min((plotW - 2 * pad) / spanX, (plotH - 2 * pad) / spanY);
        const offX = margin.left + pad + ((plotW - 2 * pad) - spanX * scale) / 2 - minX * scale;
        const offY = margin.top + pad + ((plotH - 2 * pad) - spanY * scale) / 2 - minY * scale;
        const tx = (x) => offX + x * scale;
        const ty = (y) => offY + y * scale;

        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('class', 'mathpad-graph');
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.style.width = '100%';
        svg.style.maxWidth = width + 'px';

        // Arrowhead markers — unique IDs via global counter to avoid DOM collisions
        // across multiple vectorDraws (when switching records the old SVG stays in
        // a hidden editor container; identical marker IDs would clash).
        if (!VariablesPanel._vdArrowCounter) VariablesPanel._vdArrowCounter = 0;
        const markerPrefix = `vd-arrow-${++VariablesPanel._vdArrowCounter}`;
        const defs = document.createElementNS(ns, 'defs');
        for (let i = 0; i < segs.length; i++) {
            const seg = segs[i];
            if (!seg) continue;
            const marker = document.createElementNS(ns, 'marker');
            marker.setAttribute('id', `${markerPrefix}-${i}`);
            marker.setAttribute('markerWidth', '7');
            marker.setAttribute('markerHeight', '5');
            marker.setAttribute('refX', '7');
            marker.setAttribute('refY', '2.5');
            marker.setAttribute('orient', 'auto');
            const poly = document.createElementNS(ns, 'polygon');
            poly.setAttribute('points', '0 0, 7 2.5, 0 5');
            poly.setAttribute('fill', seg.color);
            marker.appendChild(poly);
            defs.appendChild(marker);
        }
        svg.appendChild(defs);

        // Type-specific backdrop, drawn before vectors so they render on top.
        // All backdrops are intentionally faint (low opacity, thin strokes)
        // so the vectors stay the visual focus.
        const plotLeft = margin.left;
        const plotRight = margin.left + plotW;
        const plotTop = margin.top;
        const plotBottom = margin.top + plotH;
        const cx0 = tx(0), cy0 = ty(0);

        if (vectorType === 'cartesian') {
            // Visible data range — invert tx/ty to get the data-coord values
            // at the plot rect's edges. Stored data Y is in SVG y-down (the
            // pairToXY conversion above flips user-space y), so smaller plot
            // svgY corresponds to smaller data y here.
            //   tx(x) = offX + x*scale  →  x = (svgX - offX) / scale
            //   ty(y) = offY + y*scale  →  y = (svgY - offY) / scale
            const xLeftData = (plotLeft - offX) / scale;
            const xRightData = (plotRight - offX) / scale;
            const yTopData = (plotTop - offY) / scale;
            const yBottomData = (plotBottom - offY) / scale;
            // Compute nice ticks per axis, then unify to a single step (the
            // larger of the two) so both axes use the same spacing — graph
            // paper, not independent scales.
            const xTicksRaw = this._niceTicks(xLeftData, xRightData, 8);
            const yTicksRaw = this._niceTicks(yTopData, yBottomData, 8);
            const stepOf = (ticks) => ticks.length >= 2 ? Math.abs(ticks[1] - ticks[0]) : 1;
            const step = Math.max(stepOf(xTicksRaw), stepOf(yTicksRaw));
            const ticksAt = (min, max, step) => {
                const start = Math.ceil(min / step) * step;
                const out = [];
                for (let v = start; v <= max + step * 0.01; v += step) {
                    out.push(Math.round(v / step) * step);
                }
                return out;
            };
            const xTicks = ticksAt(xLeftData, xRightData, step);
            const yTicks = ticksAt(yTopData, yBottomData, step);
            const addLine = (x1, y1, x2, y2, isAxis) => {
                const ln = document.createElementNS(ns, 'line');
                ln.setAttribute('x1', x1); ln.setAttribute('y1', y1);
                ln.setAttribute('x2', x2); ln.setAttribute('y2', y2);
                ln.setAttribute('stroke', 'currentColor');
                ln.setAttribute('opacity', isAxis ? '0.4' : '0.15');
                ln.setAttribute('stroke-width', isAxis ? '0.8' : '0.5');
                svg.appendChild(ln);
            };
            for (const xv of xTicks) addLine(tx(xv), plotTop, tx(xv), plotBottom, xv === 0);
            for (const yv of yTicks) addLine(plotLeft, ty(yv), plotRight, ty(yv), yv === 0);
            // Tick value labels along the axes. Place X-axis labels just
            // below the y=0 line (clamped to plot bottom if y=0 isn't in
            // view); Y-axis labels just left of the x=0 line. The origin
            // label is skipped to avoid clutter at (0, 0). Y values are
            // negated to show user-space coordinates (the data store is in
            // SVG y-down — see pairToXY above).
            const xAxisSvgY = Math.max(plotTop + 6, Math.min(plotBottom - 12, ty(0)));
            const yAxisSvgX = Math.max(plotLeft + 18, Math.min(plotRight - 4, tx(0)));
            const addLabel = (x, y, anchor, text) => {
                const t = document.createElementNS(ns, 'text');
                t.setAttribute('x', x); t.setAttribute('y', y);
                t.setAttribute('text-anchor', anchor);
                t.setAttribute('class', 'graph-text');
                t.setAttribute('font-size', '9');
                t.setAttribute('opacity', '0.55');
                t.textContent = text;
                svg.appendChild(t);
            };
            for (const xv of xTicks) {
                if (xv === 0) continue;
                addLabel(tx(xv), xAxisSvgY + 11, 'middle', this._formatTickLabel(xv));
            }
            for (const yv of yTicks) {
                if (yv === 0) continue;
                // Negate yv → user-space (positive up).
                addLabel(yAxisSvgX - 4, ty(yv) + 3, 'end', this._formatTickLabel(-yv));
            }
        } else if (vectorType === 'polar') {
            // Concentric circles + radial spokes every 30°. Use the data
            // extent's max radius so rings reach the data; spokes extend to
            // the outermost ring.
            const rMax = Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY));
            const rTicks = rMax > 0 ? this._niceTicks(0, rMax, 5).filter(r => r > 0) : [];
            for (const r of rTicks) {
                const c = document.createElementNS(ns, 'circle');
                c.setAttribute('cx', cx0); c.setAttribute('cy', cy0);
                c.setAttribute('r', Math.abs(r * scale));
                c.setAttribute('fill', 'none');
                c.setAttribute('stroke', 'currentColor');
                c.setAttribute('opacity', '0.18');
                c.setAttribute('stroke-width', '0.5');
                svg.appendChild(c);
            }
            const spokeR = (rTicks.length > 0 ? rTicks[rTicks.length - 1] : rMax) * scale;
            for (let deg = 0; deg < 360; deg += 30) {
                const r = deg * Math.PI / 180;
                // Polar convention: 0° = +x, 90° = +y. SVG y-down → -sin.
                const x2 = cx0 + Math.cos(r) * spokeR;
                const y2 = cy0 - Math.sin(r) * spokeR;
                const ln = document.createElementNS(ns, 'line');
                ln.setAttribute('x1', cx0); ln.setAttribute('y1', cy0);
                ln.setAttribute('x2', x2); ln.setAttribute('y2', y2);
                ln.setAttribute('stroke', 'currentColor');
                ln.setAttribute('opacity', '0.18');
                ln.setAttribute('stroke-width', '0.5');
                svg.appendChild(ln);
            }
            // Angle labels at each spoke (every 30°), just outside the
            // outermost ring. Always shown in degrees (with °) regardless of
            // the record's degrees/radians mode — the spokes are at fixed
            // 30° intervals so the labels are conceptual reference markers.
            const angleLabelR = spokeR + 12;
            for (let deg = 0; deg < 360; deg += 30) {
                const r = deg * Math.PI / 180;
                const lx = cx0 + Math.cos(r) * angleLabelR;
                const ly = cy0 - Math.sin(r) * angleLabelR;
                const t = document.createElementNS(ns, 'text');
                t.setAttribute('x', lx);
                t.setAttribute('y', ly + 3);
                t.setAttribute('text-anchor', 'middle');
                t.setAttribute('class', 'graph-text');
                t.setAttribute('font-size', '9');
                t.setAttribute('opacity', '0.55');
                t.textContent = deg + '°';
                svg.appendChild(t);
            }
            // Radius labels along whichever cardinal axis has the largest
            // data extent — ensures the labels land inside the visible plot.
            // (A vector going to 180° has maxX = 0, so labels on +x would
            // sit outside the viewport.) Placed just INSIDE each ring so
            // they don't collide with the angle label sitting OUTSIDE the
            // outermost ring on the same axis.
            //   axis dx, dy is the SVG-space unit vector pointing OUT along
            //   the chosen direction. Step inward by `pad` pixels.
            // Labels are nudged off their spoke so the spoke line stays
            // visible. Horizontal axes (+x/-x): label sits just ABOVE the
            // spoke (yOff -3 raises baseline above cy0). Vertical axes
            // (+y/-y): label sits just to the LEFT of the spoke (xOff -3,
            // anchor 'end' so text extends leftward).
            const extents = [
                { ext: maxX,  dx:  1, dy:  0, anchor: 'end',   xOff:  0, yOff: -3 }, // +x
                { ext: -minX, dx: -1, dy:  0, anchor: 'start', xOff:  0, yOff: -3 }, // -x
                { ext: -minY, dx:  0, dy: -1, anchor: 'end',   xOff: -3, yOff: 11 }, // +y user-up (SVG low y)
                { ext: maxY,  dx:  0, dy:  1, anchor: 'end',   xOff: -3, yOff: -3 }, // -y user-down
            ];
            const labelAxis = extents.reduce((a, b) => b.ext > a.ext ? b : a);
            const pad = 3;
            for (const r of rTicks) {
                const d = r * scale - pad;
                const t = document.createElementNS(ns, 'text');
                t.setAttribute('x', cx0 + labelAxis.dx * d + labelAxis.xOff);
                t.setAttribute('y', cy0 + labelAxis.dy * d + labelAxis.yOff);
                t.setAttribute('text-anchor', labelAxis.anchor);
                t.setAttribute('class', 'graph-text');
                t.setAttribute('font-size', '9');
                t.setAttribute('opacity', '0.55');
                t.textContent = this._formatTickLabel(r);
                svg.appendChild(t);
            }
        } else if (vectorType === 'navigation') {
            // Compass rose at a nice data radius:
            //   - single outer ring
            //   - degree labels every 10° just outside the ring (0..350)
            //   - radial tick marks pointing inward, every 5°
            //     (major at every-10° label positions, minor at intermediate 5°)
            // Navigation convention: 0° = up = N, +° clockwise.
            const rMax = Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY));
            const rTicks = rMax > 0 ? this._niceTicks(0, rMax, 5).filter(r => r > 0) : [];
            const roseR = rTicks.length > 0 ? rTicks[rTicks.length - 1] * scale : 26;
            const navUnit = (deg) => {
                const r = deg * Math.PI / 180;
                return { dx: Math.sin(r), dy: -Math.cos(r) };
            };
            // Outer ring
            const ring = document.createElementNS(ns, 'circle');
            ring.setAttribute('cx', cx0); ring.setAttribute('cy', cy0);
            ring.setAttribute('r', roseR);
            ring.setAttribute('fill', 'none');
            ring.setAttribute('stroke', 'currentColor');
            ring.setAttribute('opacity', '0.30');
            ring.setAttribute('stroke-width', '0.7');
            svg.appendChild(ring);
            // Radial tick marks pointing inward from the ring (every 5°)
            const tickBandLen = roseR * 0.10;
            for (let deg = 0; deg < 360; deg += 5) {
                const isMajor = deg % 10 === 0;
                const tickLen = tickBandLen * (isMajor ? 1.0 : 0.4);
                const u = navUnit(deg);
                const ln = document.createElementNS(ns, 'line');
                ln.setAttribute('x1', cx0 + u.dx * (roseR - tickLen));
                ln.setAttribute('y1', cy0 + u.dy * (roseR - tickLen));
                ln.setAttribute('x2', cx0 + u.dx * roseR);
                ln.setAttribute('y2', cy0 + u.dy * roseR);
                ln.setAttribute('stroke', 'currentColor');
                ln.setAttribute('opacity', isMajor ? '0.45' : '0.18');
                ln.setAttribute('stroke-width', isMajor ? '0.8' : '0.5');
                svg.appendChild(ln);
            }
            // Degree labels every 10° just outside the ring
            const labelR = roseR + 10;
            for (let deg = 0; deg < 360; deg += 10) {
                const u = navUnit(deg);
                const t = document.createElementNS(ns, 'text');
                t.setAttribute('x', cx0 + u.dx * labelR);
                t.setAttribute('y', cy0 + u.dy * labelR + 3);
                t.setAttribute('text-anchor', 'middle');
                t.setAttribute('class', 'graph-text');
                t.setAttribute('font-size', '9');
                t.setAttribute('opacity', '0.55');
                t.textContent = String(deg);
                svg.appendChild(t);
            }
        }

        // Origin dot
        const originDot = document.createElementNS(ns, 'circle');
        originDot.setAttribute('cx', cx0);
        originDot.setAttribute('cy', cy0);
        originDot.setAttribute('r', '3');
        originDot.setAttribute('class', 'graph-text');
        originDot.setAttribute('fill', 'currentColor');
        svg.appendChild(originDot);

        for (let i = 0; i < segs.length; i++) {
            const seg = segs[i];
            if (!seg) continue;
            const x1 = tx(seg.start.x), y1 = ty(seg.start.y);
            const x2 = tx(seg.end.x), y2 = ty(seg.end.y);
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', x1.toFixed(1));
            line.setAttribute('y1', y1.toFixed(1));
            line.setAttribute('x2', x2.toFixed(1));
            line.setAttribute('y2', y2.toFixed(1));
            line.setAttribute('stroke', seg.color);
            line.setAttribute('stroke-width', '2.5');
            line.setAttribute('marker-end', `url(#${markerPrefix}-${i})`);
            svg.appendChild(line);
        }

        // Legend below the plot
        const fmtOpts = table.formatOpts || {};
        const fmtVal = (val, col) => {
            if (val == null || !isFinite(val)) return '—';
            const fmt = col && col.format ? col.format : null;
            return formatVariableValue(val, fmt, false, fmtOpts);
        };
        const legendTop = margin.top + plotH + 8;
        for (let i = 0; i < table.vectors.length; i++) {
            const v = table.vectors[i];
            const seg = segs[i];
            const color = colors[i % colors.length];
            const y = legendTop + i * legendLineHeight + 12;
            // Color swatch line
            const swatch = document.createElementNS(ns, 'line');
            swatch.setAttribute('x1', margin.left + 4);
            swatch.setAttribute('x2', margin.left + 24);
            swatch.setAttribute('y1', y - 4);
            swatch.setAttribute('y2', y - 4);
            swatch.setAttribute('stroke', color);
            swatch.setAttribute('stroke-width', '3');
            svg.appendChild(swatch);
            // Label text — use column format info for proper places/degrees/money
            const dirLabel = v.dirLabel || v.dirName;
            const magLabel = v.magLabel || v.magName;
            const edCol = v.cols ? v.cols[2] : null;
            const emCol = v.cols ? v.cols[3] : null;
            const dirText = fmtVal(v.endDir, edCol);
            const magText = fmtVal(v.endMag, emCol);
            const text = document.createElementNS(ns, 'text');
            text.setAttribute('x', margin.left + 30);
            text.setAttribute('y', y);
            text.setAttribute('class', 'graph-text');
            text.setAttribute('font-size', '12');
            text.setAttribute('fill', color);
            text.setAttribute('font-weight', 'bold');
            text.textContent = `${dirLabel} = ${dirText}, ${magLabel} = ${magText}`;
            svg.appendChild(text);
        }

        wrapper.appendChild(svg);
        this.insertRowInOrder(wrapper, table.startLine - 1);
        this._setStickyHeaderOffsets(wrapper);
    }

    /**
     * Generate nice tick values for an axis
     */
    /**
     * Draw axes, grid lines, tick labels, and border for a graph.
     * @param {object} opts - { svg, ns, margin, plotW, plotH, xMin, xMax, yMin, yMax, sx, sy, xTicks, yTicks, xFmt, yFmt, showZeroLines }
     */
    _drawGraphAxes(opts) {
        const { svg, ns, margin, plotW, plotH, xMin, xMax, yMin, yMax, sx, sy, xTicks, yTicks, xFmt, yFmt, showZeroLines } = opts;

        // Y-axis secondary grid
        for (let i = 0; i < yTicks.length - 1; i++) {
            const mid = sy((yTicks[i] + yTicks[i + 1]) / 2);
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', margin.left); line.setAttribute('x2', margin.left + plotW);
            line.setAttribute('y1', mid); line.setAttribute('y2', mid);
            line.setAttribute('class', 'graph-subgrid'); line.setAttribute('stroke-width', '0.5');
            svg.appendChild(line);
        }
        // Y-axis primary grid + labels
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

        // X-axis: skip labels if they'd overlap
        const maxXLabelLen = Math.max(...xTicks.map(t => xFmt(t).length));
        const xLabelWidth = maxXLabelLen * 7;
        const xLabelSkip = Math.max(1, Math.ceil(xLabelWidth * xTicks.length / plotW));
        // Secondary grid
        for (let i = 0; i < xTicks.length - 1; i++) {
            const mid = sx((xTicks[i] + xTicks[i + 1]) / 2);
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', mid); line.setAttribute('x2', mid);
            line.setAttribute('y1', margin.top); line.setAttribute('y2', margin.top + plotH);
            line.setAttribute('class', 'graph-subgrid'); line.setAttribute('stroke-width', '0.5');
            svg.appendChild(line);
        }
        // Primary grid + labels
        for (let ti = 0; ti < xTicks.length; ti++) {
            const x = sx(xTicks[ti]);
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', x); line.setAttribute('x2', x);
            line.setAttribute('y1', margin.top); line.setAttribute('y2', margin.top + plotH);
            line.setAttribute('class', 'graph-grid'); line.setAttribute('stroke-width', '0.5');
            svg.appendChild(line);
            if (ti % xLabelSkip === 0) {
                const label = document.createElementNS(ns, 'text');
                label.setAttribute('x', x); label.setAttribute('y', margin.top + plotH + 15);
                label.setAttribute('text-anchor', 'middle'); label.setAttribute('class', 'graph-text');
                label.setAttribute('font-size', '11');
                label.textContent = xFmt(xTicks[ti]);
                svg.appendChild(label);
            }
        }

        // Zero lines
        if (showZeroLines) {
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
        }

        // Plot border
        const border = document.createElementNS(ns, 'rect');
        border.setAttribute('x', margin.left); border.setAttribute('y', margin.top);
        border.setAttribute('width', plotW); border.setAttribute('height', plotH);
        border.setAttribute('fill', 'none'); border.setAttribute('class', 'graph-border');
        svg.appendChild(border);
    }

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
     * Format an axis tick label. Tick values are clean round numbers from
     * _niceTicks; toPrecision just scrubs FP noise (e.g. 0.30000000000000004).
     */
    _formatTickLabel(value) {
        if (Number.isInteger(value)) return String(value);
        return value.toPrecision(6).replace(/\.?0+$/, '');
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
