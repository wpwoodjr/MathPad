/**
 * MathPad Variables Panel - Structured view of extracted variables
 */

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
        this.inputElements = new Map();
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

        const newDeclarations = parseAllVariables(text);

        // Build map keyed by lineIndex for diffing
        const newDeclMap = new Map();
        for (const info of newDeclarations) {
            newDeclMap.set(info.lineIndex, info);
        }

        // Also include expression outputs (expr:, expr::, expr->, expr->>)
        if (typeof findExpressionOutputs === 'function') {
            const exprOutputs = findExpressionOutputs(text);
            for (const output of exprOutputs) {
                // Convert expression output to declaration-like format
                newDeclMap.set(output.startLine, {
                    name: output.text,  // The expression text
                    declaration: {
                        marker: output.marker,
                        type: output.recalculates ? VarType.OUTPUT : VarType.STANDARD,
                        clearBehavior: output.recalculates ? ClearBehavior.ON_SOLVE : ClearBehavior.NONE,
                        fullPrecision: output.fullPrecision,
                        format: null,
                        comment: null
                    },
                    lineIndex: output.startLine,
                    value: null,
                    valueText: output.existingValue,
                    isExpressionOutput: true
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
                // If name, marker, or comment changed, remove old row and add new one
                if (existing.name !== info.name || existing.declaration.marker !== info.declaration.marker || existing.declaration.comment !== info.declaration.comment) {
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
    }

    /**
     * Add a variable row to the panel
     */
    addVariableRow(info) {
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
        } else if (clearBehavior === ClearBehavior.ON_CLEAR || decl.type === VarType.INPUT) {
            row.dataset.type = 'input';
        } else if (clearBehavior === ClearBehavior.ON_SOLVE || decl.type === VarType.OUTPUT) {
            row.dataset.type = 'output';
        } else {
            row.dataset.type = 'standard';
        }

        // Variable name label (includes format suffix and marker to distinguish declarations)
        const formatSuffix = decl.format === 'money' ? '$' : decl.format === 'percent' ? '%' : '';
        const nameLabel = document.createElement('span');
        nameLabel.className = 'variable-name';
        nameLabel.textContent = info.name + formatSuffix + (decl.marker || ':');
        // Add tooltip explaining variable type
        if (isInRefSection) {
            nameLabel.title = 'Reference (from Constants/Functions)';
        } else if (clearBehavior === ClearBehavior.ON_CLEAR || decl.type === VarType.INPUT) {
            nameLabel.title = 'Input variable (cleared on Clear)';
        } else if (clearBehavior === ClearBehavior.ON_SOLVE || decl.type === VarType.OUTPUT) {
            nameLabel.title = 'Output variable (cleared on Solve)';
        }

        // Value input or display
        // Output types (-> and ->>) are read-only
        // References section values are also read-only (auto-generated)
        // Expression outputs are always read-only
        const isOutput = clearBehavior === ClearBehavior.ON_SOLVE || decl.type === VarType.OUTPUT;
        const isExpressionOutput = info.isExpressionOutput || false;
        const isEditable = !isOutput && !isInRefSection && !isExpressionOutput;
        let valueElement;

        if (isEditable) {
            valueElement = document.createElement('input');
            valueElement.type = 'text';
            valueElement.className = 'variable-value-input';
            valueElement.value = this.formatValueForDisplay(info);
            // Update formula pane on blur (when user is done typing), not during typing
            valueElement.addEventListener('blur', (e) => this.handleValueChange(info.lineIndex, e.target.value));
            valueElement.addEventListener('focus', (e) => e.target.select());
            // Also handle Enter key to commit the value
            valueElement.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.target.blur();
                }
            });
            this.inputElements.set(info.lineIndex, valueElement);
        } else {
            valueElement = document.createElement('span');
            valueElement.className = 'variable-value-readonly';
            valueElement.textContent = this.formatValueForDisplay(info);
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
            if (valueElement.tagName === 'INPUT') {
                valueElement.value = newValue;
            } else {
                valueElement.textContent = newValue;
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
        let text = this.editor.getValue();
        const lines = text.split('\n');

        if (lineIndex >= 0 && lineIndex < lines.length) {
            const newLine = replaceValueOnLine(lines[lineIndex], varName, decl.marker, !!decl.limits, formattedValue);
            if (newLine !== null) {
                lines[lineIndex] = newLine;
                text = lines.join('\n');
            }
        }

        // Notify listeners
        for (const listener of this.changeListeners) {
            listener(varName, parsedValue, text);
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
            // Format as money: $1,234.56
            const absValue = Math.abs(parsedValue);
            // Detect decimal places from input
            const inputWithoutMoney = text.replace(/[$,]/g, '');
            const decimalMatch = inputWithoutMoney.match(/\.(\d+)/);
            const places = decimalMatch ? Math.max(2, decimalMatch[1].length) : 2;

            const formatted = absValue.toFixed(places);
            const parts = formatted.split('.');
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
            const result = parts.join('.');
            return parsedValue < 0 ? '-$' + result : '$' + result;
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
        return info.valueText || '';
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

        const value = parseFloat(text);
        return isNaN(value) ? null : value * multiplier;
    }

    /**
     * Register a callback for value changes
     */
    onValueChange(callback) {
        this.changeListeners.push(callback);
    }

    /**
     * Check if a declaration has changed
     */
    declarationChanged(existing, newInfo) {
        return existing.value !== newInfo.value ||
               existing.valueText !== newInfo.valueText ||
               existing.declaration.type !== newInfo.declaration.type ||
               existing.name !== newInfo.name;
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

// Note: escapeRegex function is defined in variables.js

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VariablesPanel };
}
