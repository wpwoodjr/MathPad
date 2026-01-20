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
        this.variables = new Map();
        this.changeListeners = [];
        this.inputElements = new Map();
    }

    /**
     * Update variables panel from text
     */
    updateFromText(text) {
        const newVariables = parseAllVariables(text);

        // Diff and update only changed variables
        const toAdd = [];
        const toUpdate = [];
        const toRemove = [];

        for (const [name, info] of newVariables) {
            if (!this.variables.has(name)) {
                toAdd.push({ name, info });
            } else {
                const existing = this.variables.get(name);
                if (this.variableChanged(existing, info)) {
                    toUpdate.push({ name, info });
                }
            }
        }

        for (const name of this.variables.keys()) {
            if (!newVariables.has(name)) {
                toRemove.push(name);
            }
        }

        // Apply changes
        toRemove.forEach(name => this.removeVariableRow(name));
        toAdd.forEach(({ name, info }) => this.addVariableRow(name, info));
        toUpdate.forEach(({ name, info }) => this.updateVariableRow(name, info));

        this.variables = newVariables;
    }

    /**
     * Add a variable row to the panel
     */
    addVariableRow(name, info) {
        const row = document.createElement('div');
        row.className = 'variable-row';
        row.dataset.varName = name;

        // Set data-type for CSS styling
        if (info.declaration.type === VarType.INPUT) {
            row.dataset.type = 'input';
        } else if (info.declaration.type === VarType.OUTPUT) {
            row.dataset.type = 'output';
        } else {
            row.dataset.type = 'standard';
        }

        // Type indicator
        const typeIndicator = document.createElement('span');
        typeIndicator.className = 'variable-type-indicator';
        if (info.declaration.type === VarType.INPUT) {
            typeIndicator.textContent = '\u2190'; // left arrow
            typeIndicator.title = 'Input variable';
        } else if (info.declaration.type === VarType.OUTPUT) {
            typeIndicator.textContent = '\u2192'; // right arrow
            typeIndicator.title = 'Output variable';
        } else {
            typeIndicator.textContent = '';
        }

        // Variable name label
        const nameLabel = document.createElement('span');
        nameLabel.className = 'variable-name';
        nameLabel.textContent = name;

        // Value input or display
        const isEditable = info.declaration.type !== VarType.OUTPUT;
        let valueElement;

        if (isEditable) {
            valueElement = document.createElement('input');
            valueElement.type = 'text';
            valueElement.className = 'variable-value-input';
            valueElement.value = this.formatValueForDisplay(name, info);
            valueElement.addEventListener('change', (e) => this.handleValueChange(name, e.target.value));
            valueElement.addEventListener('focus', (e) => e.target.select());
            this.inputElements.set(name, valueElement);
        } else {
            valueElement = document.createElement('span');
            valueElement.className = 'variable-value-readonly';
            valueElement.textContent = this.formatValueForDisplay(name, info);
        }

        row.appendChild(typeIndicator);
        row.appendChild(nameLabel);
        row.appendChild(valueElement);

        // Insert in order (by line number)
        this.insertRowInOrder(row, info.lineIndex);
    }

    /**
     * Update an existing variable row
     */
    updateVariableRow(name, info) {
        const row = this.container.querySelector(`[data-var-name="${name}"]`);
        if (!row) return;

        const valueElement = row.querySelector('.variable-value-input, .variable-value-readonly');
        if (valueElement && document.activeElement !== valueElement) {
            const newValue = this.formatValueForDisplay(name, info);
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
    removeVariableRow(name) {
        const row = this.container.querySelector(`[data-var-name="${name}"]`);
        if (row) row.remove();
        this.inputElements.delete(name);
    }

    /**
     * Handle value change from input
     */
    handleValueChange(varName, newValue) {
        // Parse the new value
        const parsedValue = this.parseInputValue(varName, newValue);
        if (parsedValue === null) return;

        // Format the value for display in formulas, preserving user's input precision
        const formattedValue = this.formatInputForFormulas(varName, newValue, parsedValue);

        // Get current text and update
        let text = this.editor.getValue();

        // First check if the variable has a declaration with no value
        const variables = parseAllVariables(text);
        const varInfo = variables.get(varName);

        if (varInfo && !varInfo.declaration.valueText) {
            // Use setVariableValue to fill in empty declaration
            // But we need to use our formatted value, so do it manually
            const lines = text.split('\n');
            const decl = varInfo.declaration;
            const lineIndex = varInfo.lineIndex;

            if (lineIndex >= 0 && lineIndex < lines.length) {
                const line = lines[lineIndex];
                const cleanLine = line.replace(/"[^"]*"/g, match => ' '.repeat(match.length));

                let markerIndex;
                if (decl.limits) {
                    const bracketMatch = cleanLine.match(/\w+[$%]?\s*\[[^\]]+\]\s*:/);
                    if (bracketMatch) {
                        markerIndex = bracketMatch.index + bracketMatch[0].length;
                    }
                } else {
                    const markerMatch = cleanLine.match(new RegExp(`${escapeRegex(varName)}\\s*(${escapeRegex(decl.marker)})`));
                    if (markerMatch) {
                        markerIndex = markerMatch.index + markerMatch[0].length;
                    }
                }

                if (markerIndex !== undefined) {
                    const commentMatch = line.match(/"[^"]*"$/);
                    const comment = commentMatch ? ' ' + commentMatch[0] : '';
                    const beforeValue = line.substring(0, markerIndex);
                    lines[lineIndex] = beforeValue + ' ' + formattedValue + comment;
                    text = lines.join('\n');
                }
            }
        } else if (varInfo) {
            // Need to replace existing value - find and replace the value portion
            const lines = text.split('\n');
            const decl = varInfo.declaration;
            const lineIndex = varInfo.lineIndex;

            if (lineIndex >= 0 && lineIndex < lines.length) {
                const line = lines[lineIndex];

                // Find the marker position and reconstruct line
                const cleanLine = line.replace(/"[^"]*"/g, match => ' '.repeat(match.length));
                let markerPattern;
                if (decl.limits) {
                    markerPattern = new RegExp(`(${escapeRegex(varName)}\\s*\\[[^\\]]+\\]\\s*:)\\s*(.*?)(?:\\s*"[^"]*")?$`);
                } else {
                    markerPattern = new RegExp(`(${escapeRegex(varName)}\\s*${escapeRegex(decl.marker)})\\s*(.*?)(?:\\s*"[^"]*")?$`);
                }

                // Find trailing comment
                const commentMatch = line.match(/"[^"]*"$/);
                const comment = commentMatch ? ' ' + commentMatch[0] : '';

                // Find marker in the original line
                const match = cleanLine.match(markerPattern);
                if (match) {
                    const beforeMarker = line.substring(0, match.index + match[1].length);
                    lines[lineIndex] = beforeMarker + ' ' + formattedValue + comment;
                    text = lines.join('\n');
                }
            }
        }

        // Notify listeners
        for (const listener of this.changeListeners) {
            listener(varName, parsedValue, text);
        }
    }

    /**
     * Format user input for writing back to formulas, preserving precision
     */
    formatInputForFormulas(varName, inputText, parsedValue) {
        let text = inputText.trim();

        // Handle money variables
        if (varName.endsWith('$') || text.includes('$')) {
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
        if (varName.endsWith('%') || text.endsWith('%')) {
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
     * Format a value for display in the panel
     * Uses the original text value when available to preserve full precision
     */
    formatValueForDisplay(name, info) {
        if (info.value === null || info.value === undefined) return '';

        // If we have the original value text, use it directly to preserve precision
        // This handles cases like 6.125% which would otherwise round to 6.13%
        if (info.declaration.valueText) {
            return info.declaration.valueText;
        }

        // Fallback to formatting from numeric value with high precision
        return formatNumber(
            info.value,
            14,  // Use high precision to preserve value
            true, // Strip trailing zeros
            this.record.format || 'float',
            info.declaration.base || 10,
            this.record.groupDigits || false,
            name
        );
    }

    /**
     * Parse user input value (handling $, %, commas)
     */
    parseInputValue(varName, inputText) {
        let text = inputText.trim();
        if (!text) return null;

        let multiplier = 1;

        // Handle money format: $1,234.56 or -$1,234.56
        if (text.includes('$')) {
            text = text.replace(/[$,]/g, '');
        }

        // Handle percentage format: 7.5%
        // Also check if variable name ends with % (percentage variable)
        if (text.endsWith('%')) {
            text = text.slice(0, -1);
            multiplier = 0.01; // Convert percentage display to decimal
        } else if (varName.endsWith('%')) {
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
     * Check if a variable has changed
     */
    variableChanged(existing, newInfo) {
        return existing.value !== newInfo.value ||
               existing.declaration.type !== newInfo.declaration.type ||
               existing.lineIndex !== newInfo.lineIndex;
    }

    /**
     * Insert row in correct order by line number
     */
    insertRowInOrder(row, lineIndex) {
        const rows = Array.from(this.container.children);
        let inserted = false;

        for (const existingRow of rows) {
            const existingName = existingRow.dataset.varName;
            const existingInfo = this.variables.get(existingName);
            if (existingInfo && existingInfo.lineIndex > lineIndex) {
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
