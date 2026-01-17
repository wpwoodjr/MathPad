/**
 * MathPad UI - User interface components and event handling
 */

/**
 * UI State
 */
const UI = {
    data: null,
    currentRecordId: null,
    openTabs: [],
    editors: new Map(),
    sidebar: null,
    tabBar: null,
    editorContainer: null,
    detailsPanel: null,
    statusBar: null,
    collapsedCategories: new Set()
};

/**
 * Initialize the UI
 */
function initUI(data) {
    UI.data = data;

    // Get DOM elements
    UI.sidebar = document.getElementById('sidebar');
    UI.tabBar = document.getElementById('tab-bar');
    UI.editorContainer = document.getElementById('editor-container');
    UI.detailsPanel = document.getElementById('details-panel');
    UI.statusBar = document.getElementById('status-bar');

    // Render initial UI
    renderSidebar();
    renderDetailsPanel();

    // Set up event listeners
    setupEventListeners();

    // Open first record if available
    if (data.records.length > 0) {
        openRecord(data.records[0].id);
    }

    setStatus('Ready');
}

/**
 * Render the sidebar with categories and records
 */
function renderSidebar() {
    const groups = getRecordsByCategory(UI.data);
    let html = '<div class="sidebar-header">Records</div>';

    for (const [category, records] of groups) {
        const isCollapsed = UI.collapsedCategories.has(category);
        const hasRecords = records.length > 0;

        html += `
            <div class="category-group" data-category="${escapeAttr(category)}">
                <div class="category-header ${isCollapsed ? 'collapsed' : ''}"
                     onclick="toggleCategory('${escapeAttr(category)}')">
                    <span class="category-arrow">${isCollapsed ? '▶' : '▼'}</span>
                    <span class="category-name">${escapeHtmlText(category)}</span>
                    <span class="category-count">(${records.length})</span>
                </div>
                <div class="category-records ${isCollapsed ? 'hidden' : ''}">
        `;

        for (const record of records) {
            const isActive = record.id === UI.currentRecordId;
            const isSpecial = record.title === 'Constants' || record.title === 'Functions';
            html += `
                <div class="record-item ${isActive ? 'active' : ''} ${isSpecial ? 'special' : ''}"
                     data-record-id="${record.id}"
                     onclick="openRecord('${record.id}')"
                     ondblclick="renameRecord('${record.id}')">
                    ${isSpecial ? '★ ' : ''}${escapeHtmlText(record.title || 'Untitled')}
                </div>
            `;
        }

        html += `
                </div>
            </div>
        `;
    }

    html += `
        <div class="sidebar-actions">
            <button onclick="createNewRecord()" class="btn-new-record">+ New Record</button>
        </div>
    `;

    UI.sidebar.innerHTML = html;
}

/**
 * Toggle category collapse state
 */
function toggleCategory(category) {
    if (UI.collapsedCategories.has(category)) {
        UI.collapsedCategories.delete(category);
    } else {
        UI.collapsedCategories.add(category);
    }
    renderSidebar();
}

/**
 * Render the tab bar
 */
function renderTabBar() {
    let html = '';

    for (const recordId of UI.openTabs) {
        const record = findRecord(UI.data, recordId);
        if (!record) continue;

        const isActive = recordId === UI.currentRecordId;
        html += `
            <div class="tab ${isActive ? 'active' : ''}"
                 data-record-id="${recordId}"
                 onclick="switchToTab('${recordId}')">
                <span class="tab-title">${escapeHtmlText(record.title || 'Untitled')}</span>
                <span class="tab-close" onclick="event.stopPropagation(); closeTab('${recordId}')">&times;</span>
            </div>
        `;
    }

    UI.tabBar.innerHTML = html;
}

/**
 * Open a record
 */
function openRecord(recordId) {
    const record = findRecord(UI.data, recordId);
    if (!record) return;

    // Add to open tabs if not already there
    if (!UI.openTabs.includes(recordId)) {
        UI.openTabs.push(recordId);
    }

    // Switch to this record
    UI.currentRecordId = recordId;

    // Create editor if not exists
    if (!UI.editors.has(recordId)) {
        createEditorForRecord(record);
    }

    // Show the editor
    showEditor(recordId);

    // Update UI
    renderTabBar();
    renderSidebar();
    renderDetailsPanel();
}

/**
 * Create an editor for a record
 */
function createEditorForRecord(record) {
    const container = document.createElement('div');
    container.className = 'editor-wrapper';
    container.id = `editor-${record.id}`;
    container.style.display = 'none';

    UI.editorContainer.appendChild(container);

    const editor = createEditor(container, {
        value: record.text
    });

    // Save changes on edit
    editor.onChange((value) => {
        record.text = value;
        debouncedSave(UI.data);

        // Update title if first comment changed
        updateRecordTitleFromContent(record);
    });

    UI.editors.set(record.id, { editor, container });
}

/**
 * Show a specific editor
 */
function showEditor(recordId) {
    // Hide all editors
    for (const [id, { container }] of UI.editors) {
        container.style.display = id === recordId ? 'flex' : 'none';
    }
}

/**
 * Switch to a tab
 */
function switchToTab(recordId) {
    if (UI.currentRecordId === recordId) return;
    openRecord(recordId);
}

/**
 * Close a tab
 */
function closeTab(recordId) {
    const index = UI.openTabs.indexOf(recordId);
    if (index === -1) return;

    // Remove from open tabs
    UI.openTabs.splice(index, 1);

    // Remove editor
    if (UI.editors.has(recordId)) {
        const { container } = UI.editors.get(recordId);
        container.remove();
        UI.editors.delete(recordId);
    }

    // Switch to another tab if this was the current one
    if (UI.currentRecordId === recordId) {
        if (UI.openTabs.length > 0) {
            const newIndex = Math.min(index, UI.openTabs.length - 1);
            openRecord(UI.openTabs[newIndex]);
        } else {
            UI.currentRecordId = null;
            renderDetailsPanel();
        }
    }

    renderTabBar();
}

/**
 * Render the details panel
 */
function renderDetailsPanel() {
    if (!UI.currentRecordId) {
        UI.detailsPanel.innerHTML = '<div class="no-record">No record selected</div>';
        return;
    }

    const record = findRecord(UI.data, UI.currentRecordId);
    if (!record) return;

    const categoryOptions = UI.data.categories.map(cat =>
        `<option value="${escapeAttr(cat)}" ${cat === record.category ? 'selected' : ''}>${escapeHtmlText(cat)}</option>`
    ).join('');

    const formatOptions = ['float', 'sci', 'eng'].map(fmt =>
        `<option value="${fmt}" ${fmt === record.format ? 'selected' : ''}>${fmt.charAt(0).toUpperCase() + fmt.slice(1)}</option>`
    ).join('');

    UI.detailsPanel.innerHTML = `
        <div class="details-header">Details</div>

        <div class="detail-group">
            <label>Category</label>
            <select id="detail-category" onchange="updateRecordDetail('category', this.value)">
                ${categoryOptions}
            </select>
        </div>

        <div class="detail-group">
            <label>Decimal Places</label>
            <input type="number" id="detail-places" min="0" max="15" value="${record.places ?? 2}"
                   onchange="updateRecordDetail('places', parseInt(this.value))">
        </div>

        <div class="detail-group">
            <label>Format</label>
            <select id="detail-format" onchange="updateRecordDetail('format', this.value)">
                ${formatOptions}
            </select>
        </div>

        <div class="detail-group checkbox">
            <label>
                <input type="checkbox" id="detail-strip" ${record.stripZeros ? 'checked' : ''}
                       onchange="updateRecordDetail('stripZeros', this.checked)">
                Strip trailing zeros
            </label>
        </div>

        <div class="details-actions">
            <button onclick="duplicateCurrentRecord()" class="btn-secondary">Duplicate</button>
            <button onclick="deleteCurrentRecord()" class="btn-danger">Delete</button>
        </div>
    `;
}

/**
 * Update a record detail
 */
function updateRecordDetail(field, value) {
    if (!UI.currentRecordId) return;

    const record = findRecord(UI.data, UI.currentRecordId);
    if (!record) return;

    record[field] = value;
    debouncedSave(UI.data);

    if (field === 'category') {
        renderSidebar();
    }
}

/**
 * Create a new record
 */
function createNewRecord() {
    const record = createRecord('New Record', 'Unfiled');
    UI.data.records.push(record);
    saveData(UI.data);

    renderSidebar();
    openRecord(record.id);

    // Focus editor and select title for renaming
    setTimeout(() => {
        const editorInfo = UI.editors.get(record.id);
        if (editorInfo) {
            editorInfo.editor.focus();
        }
    }, 100);
}

/**
 * Rename a record
 */
function renameRecord(recordId) {
    const record = findRecord(UI.data, recordId);
    if (!record) return;

    const newTitle = prompt('Enter new name:', record.title);
    if (newTitle && newTitle !== record.title) {
        record.title = newTitle;
        saveData(UI.data);
        renderSidebar();
        renderTabBar();
    }
}

/**
 * Update record title from content (first comment)
 */
function updateRecordTitleFromContent(record) {
    const firstLine = record.text.split('\n')[0].trim();
    const match = firstLine.match(/^"([^"]+)"$/);
    if (match && match[1] !== record.title) {
        record.title = match[1];
        renderSidebar();
        renderTabBar();
    }
}

/**
 * Duplicate the current record
 */
function duplicateCurrentRecord() {
    if (!UI.currentRecordId) return;

    const record = findRecord(UI.data, UI.currentRecordId);
    if (!record) return;

    const newRecord = {
        ...record,
        id: generateId(),
        title: record.title + ' (copy)'
    };

    UI.data.records.push(newRecord);
    saveData(UI.data);

    renderSidebar();
    openRecord(newRecord.id);
}

/**
 * Delete the current record
 */
function deleteCurrentRecord() {
    if (!UI.currentRecordId) return;

    const record = findRecord(UI.data, UI.currentRecordId);
    if (!record) return;

    if (!confirm(`Delete "${record.title}"?`)) return;

    // Close tab first
    closeTab(UI.currentRecordId);

    // Delete record
    deleteRecord(UI.data, record.id);
    saveData(UI.data);

    renderSidebar();
}

/**
 * Set status message
 */
function setStatus(message, isError = false) {
    UI.statusBar.textContent = message;
    UI.statusBar.className = 'status-bar' + (isError ? ' error' : '');
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Import button
    document.getElementById('btn-import')?.addEventListener('click', handleImport);

    // Export button
    document.getElementById('btn-export')?.addEventListener('click', handleExport);

    // Solve button
    document.getElementById('btn-solve')?.addEventListener('click', handleSolve);

    // Clear Input button
    document.getElementById('btn-clear')?.addEventListener('click', handleClearInput);

    // Degrees/Radians toggle
    document.getElementById('toggle-degrees')?.addEventListener('change', (e) => {
        UI.data.settings.degreesMode = e.target.checked;
        saveData(UI.data);
    });

    // File input for import
    document.getElementById('file-input')?.addEventListener('change', handleFileSelect);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + Enter to solve
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleSolve();
        }
        // Ctrl/Cmd + S to save (prevent default, auto-saved)
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            setStatus('All changes auto-saved');
        }
    });
}

/**
 * Handle import
 */
function handleImport() {
    document.getElementById('file-input')?.click();
}

/**
 * Handle file selection for import
 */
async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
        setStatus('Importing...');
        const text = await readTextFile(file);
        UI.data = importFromText(text, UI.data);
        saveData(UI.data);
        renderSidebar();
        setStatus(`Imported from ${file.name}`);
    } catch (err) {
        setStatus('Import failed: ' + err.message, true);
    }

    // Reset file input
    e.target.value = '';
}

/**
 * Handle export
 */
function handleExport() {
    try {
        const text = exportToText(UI.data);
        const timestamp = new Date().toISOString().slice(0, 10);
        downloadTextFile(text, `mathpad_export_${timestamp}.txt`);
        setStatus('Exported successfully');
    } catch (err) {
        setStatus('Export failed: ' + err.message, true);
    }
}

/**
 * Handle solve
 */
function handleSolve() {
    if (!UI.currentRecordId) {
        setStatus('No record selected', true);
        return;
    }

    const record = findRecord(UI.data, UI.currentRecordId);
    if (!record) return;

    const editorInfo = UI.editors.get(UI.currentRecordId);
    if (!editorInfo) return;

    try {
        setStatus('Solving...');

        // Get current text from editor
        let text = editorInfo.editor.getValue();

        // Clear output variables first so they become unknowns
        text = clearVariables(text, 'output');

        // Create evaluation context
        const context = new EvalContext();
        context.degreesMode = UI.data.settings.degreesMode;
        context.places = record.places || 14;
        context.stripZeros = record.stripZeros !== false;

        // Load constants from Constants record
        const constantsRecord = UI.data.records.find(r => r.title === 'Constants');
        if (constantsRecord) {
            const constants = parseConstantsRecord(constantsRecord.text);
            for (const [name, value] of constants) {
                context.setConstant(name, value);
            }
        }

        // Load user functions from Functions record
        const functionsRecord = UI.data.records.find(r => r.title === 'Functions');
        if (functionsRecord) {
            const functions = parseFunctionsRecord(functionsRecord.text);
            for (const [name, { params, bodyText }] of functions) {
                try {
                    const bodyAST = parseExpression(bodyText);
                    context.setUserFunction(name, params, bodyAST);
                } catch (e) {
                    console.warn(`Error parsing function ${name}:`, e);
                }
            }
        }

        // Solve the record
        const result = solveRecord(text, context, record);
        text = result.text;

        // Update editor with results
        editorInfo.editor.setValue(text);
        record.text = text;
        debouncedSave(UI.data);

        if (result.errors.length > 0) {
            setStatus('Solved with errors: ' + result.errors[0], true);
        } else if (result.solved > 0) {
            setStatus(`Solved ${result.solved} equation${result.solved > 1 ? 's' : ''}`);
        } else {
            setStatus('Nothing to solve');
        }

    } catch (err) {
        setStatus('Error: ' + err.message, true);
        console.error('Solve error:', err);
    }
}

/**
 * Handle clear input
 */
function handleClearInput() {
    if (!UI.currentRecordId) return;

    const record = findRecord(UI.data, UI.currentRecordId);
    if (!record) return;

    const editorInfo = UI.editors.get(UI.currentRecordId);
    if (!editorInfo) return;

    let text = editorInfo.editor.getValue();
    text = clearVariables(text, 'output');

    editorInfo.editor.setValue(text);
    record.text = text;
    debouncedSave(UI.data);

    setStatus('Output variables cleared');
}

/**
 * Solve a record's equations
 */
function solveRecord(text, context, record) {
    const errors = [];
    let solved = 0;
    let maxIterations = 50; // Prevent infinite loops

    // First pass: extract all variable values
    const variables = parseAllVariables(text);
    for (const [name, info] of variables) {
        if (info.value !== null) {
            context.setVariable(name, info.value);
        }
    }

    // Solve equations iteratively
    let changed = true;
    while (changed && maxIterations-- > 0) {
        changed = false;

        // Find equations
        const equations = findEquations(text);

        // Build substitution map from definition equations (var = expr)
        const substitutions = buildSubstitutionMap(equations, context);

        for (const eq of equations) {
            try {
                const result = solveEquationInContext(eq.text, context, variables, substitutions);

                if (result.solved) {
                    // Update the variable value in text
                    // Check if this variable uses full precision (->> or ::)
                    const varInfo = variables.get(result.variable);
                    const isFullPrecision = varInfo?.declaration?.fullPrecision;

                    const format = {
                        places: isFullPrecision ? 15 : (record.places || 2),
                        stripZeros: record.stripZeros !== false,
                        format: record.format || 'float'
                    };

                    text = setVariableValue(text, result.variable, result.value, format);
                    context.setVariable(result.variable, result.value);

                    // Re-parse variables after update
                    const newVars = parseAllVariables(text);
                    variables.clear();
                    for (const [n, i] of newVars) {
                        variables.set(n, i);
                    }

                    solved++;
                    changed = true;
                }
            } catch (e) {
                errors.push(e.message);
            }
        }
    }

    // Handle inline evaluations: \ expression \
    const inlineEvals = findInlineEvaluations(text);
    for (let i = inlineEvals.length - 1; i >= 0; i--) { // Reverse to preserve positions
        const evalInfo = inlineEvals[i];
        try {
            const ast = parseExpression(evalInfo.expression);
            const value = evaluate(ast, context);
            const format = {
                places: record.places || 2,
                stripZeros: record.stripZeros !== false,
                format: record.format || 'float'
            };
            const formatted = formatNumber(value, format.places, format.stripZeros, format.format, 10);
            text = text.substring(0, evalInfo.start) +
                   '\\' + formatted + '\\' +
                   text.substring(evalInfo.end);
        } catch (e) {
            errors.push(`Inline eval error: ${e.message}`);
        }
    }

    return { text, solved, errors };
}

/**
 * Solve a single equation in context
 */
function solveEquationInContext(eqText, context, variables, substitutions = new Map()) {
    // Parse the equation: left = right
    const eqMatch = eqText.match(/^(.+)=(.+)$/);
    if (!eqMatch) {
        throw new Error('Invalid equation format');
    }

    const leftText = eqMatch[1].trim();
    const rightText = eqMatch[2].trim();

    // Parse both sides
    let leftAST = parseExpression(leftText);
    let rightAST = parseExpression(rightText);

    // Find variables in equation
    let leftVars = findVariablesInAST(leftAST);
    let rightVars = findVariablesInAST(rightAST);
    let allVars = new Set([...leftVars, ...rightVars]);

    // Find unknowns (variables without values in context)
    let unknowns = [...allVars].filter(v => !context.hasVariable(v));

    if (unknowns.length === 0) {
        // All variables known - just evaluate to check
        const leftVal = evaluate(leftAST, context);
        const rightVal = evaluate(rightAST, context);
        if (Math.abs(leftVal - rightVal) > 1e-10) {
            // Equation doesn't balance - might be an error
        }
        return { solved: false };
    }

    // If multiple unknowns, try applying substitutions
    if (unknowns.length > 1 && substitutions.size > 0) {
        // Apply substitutions to reduce unknowns
        leftAST = substituteInAST(leftAST, substitutions);
        rightAST = substituteInAST(rightAST, substitutions);

        // Re-find variables after substitution
        leftVars = findVariablesInAST(leftAST);
        rightVars = findVariablesInAST(rightAST);
        allVars = new Set([...leftVars, ...rightVars]);
        unknowns = [...allVars].filter(v => !context.hasVariable(v));
    }

    if (unknowns.length === 0) {
        // All variables known after substitution
        return { solved: false };
    }

    if (unknowns.length > 1) {
        // Still too many unknowns after substitution
        return { solved: false };
    }

    // Exactly one unknown - solve for it
    const unknown = unknowns[0];

    // Get search limits if specified
    let limits = null;
    const varInfo = variables.get(unknown);
    if (varInfo?.declaration?.limits) {
        try {
            const lowAST = parseExpression(varInfo.declaration.limits.lowExpr);
            const highAST = parseExpression(varInfo.declaration.limits.highExpr);
            limits = {
                low: evaluate(lowAST, context),
                high: evaluate(highAST, context)
            };
        } catch (e) {
            // Ignore limit parsing errors
        }
    }

    // Create equation function: f(x) = left - right = 0
    const f = (x) => {
        const ctx = context.clone();
        ctx.setVariable(unknown, x);
        try {
            const leftVal = evaluate(leftAST, ctx);
            const rightVal = evaluate(rightAST, ctx);
            return leftVal - rightVal;
        } catch (e) {
            return NaN;
        }
    };

    // Solve
    const value = solveEquation(f, limits);

    return {
        solved: true,
        variable: unknown,
        value: value
    };
}

/**
 * Find variables in an AST
 */
function findVariablesInAST(node) {
    const vars = new Set();

    function walk(n) {
        if (!n) return;
        switch (n.type) {
            case 'VARIABLE':
                vars.add(n.name);
                break;
            case 'BINARY_OP':
                walk(n.left);
                walk(n.right);
                break;
            case 'UNARY_OP':
                walk(n.operand);
                break;
            case 'FUNCTION_CALL':
                n.args.forEach(walk);
                break;
        }
    }

    walk(node);
    return vars;
}

/**
 * Helper: escape HTML for text content
 */
function escapeHtmlText(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Helper: escape for HTML attributes
 */
function escapeAttr(text) {
    return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Export functions to global scope for HTML onclick handlers
window.toggleCategory = toggleCategory;
window.openRecord = openRecord;
window.renameRecord = renameRecord;
window.switchToTab = switchToTab;
window.closeTab = closeTab;
window.createNewRecord = createNewRecord;
window.updateRecordDetail = updateRecordDetail;
window.duplicateCurrentRecord = duplicateCurrentRecord;
window.deleteCurrentRecord = deleteCurrentRecord;

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        UI, initUI, renderSidebar, renderTabBar, renderDetailsPanel,
        openRecord, closeTab, setStatus, handleSolve
    };
}
