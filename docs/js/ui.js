/**
 * MathPad UI - User interface components and event handling
 */

/**
 * Application state (separate from DOM references)
 */
const UIState = {
    data: null,              // Persisted data from storage
    currentRecordId: null,   // Currently active record
    openTabs: [],            // List of open tab record IDs
    editors: new Map(),      // Map of recordId -> editor info
    collapsedCategories: new Set() // Collapsed category names in sidebar
};

/**
 * DOM references (cached for performance)
 */
const UI = {
    // Legacy accessor for state - allows UI.data, UI.currentRecordId, etc.
    get data() { return UIState.data; },
    set data(v) { UIState.data = v; },
    get currentRecordId() { return UIState.currentRecordId; },
    set currentRecordId(v) { UIState.currentRecordId = v; },
    get openTabs() { return UIState.openTabs; },
    set openTabs(v) { UIState.openTabs = v; },
    get editors() { return UIState.editors; },
    set editors(v) { UIState.editors = v; },
    get collapsedCategories() { return UIState.collapsedCategories; },
    set collapsedCategories(v) { UIState.collapsedCategories = v; },

    // DOM elements (populated in initUI)
    sidebar: null,
    tabBar: null,
    editorContainer: null,
    detailsPanel: null,
    statusBar: null,

    // Last persistent status (for undo entry capture — ignores transient messages)
    lastPersistentStatus: { message: '', isError: false }
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

    // Restore open tabs, or open last viewed record, or first record
    if (data.records.length > 0) {
        const savedTabs = (data.settings && data.settings.openTabs) || [];
        const lastRecordId = data.settings && data.settings.lastRecordId;

        // Filter to only valid record IDs
        const validTabs = savedTabs.filter(id => findRecord(data, id));

        if (validTabs.length > 0) {
            // Restore all saved tabs
            for (const tabId of validTabs) {
                openRecord(tabId);
            }
            // Switch to last viewed tab if it's open, otherwise stay on last opened
            if (lastRecordId && validTabs.includes(lastRecordId)) {
                openRecord(lastRecordId);
            }
        } else {
            openRecord(data.records[0].id);
        }
    }

    const count = data.records.length;
    setStatus(`Loaded ${count} record${count !== 1 ? 's' : ''}`, false, false);
}

/**
 * Render the sidebar with categories and records
 */
function renderSidebar() {
    // Preserve scroll position
    const sidebarContent = UI.sidebar.querySelector('.sidebar-content');
    const scrollTop = sidebarContent ? sidebarContent.scrollTop : 0;

    const groups = getRecordsByCategory(UI.data);
    let html = '<div class="sidebar-header">Records</div>';
    html += '<div class="sidebar-content">';

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
            const isSpecial = isReferenceRecord(record);
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

    html += '</div>'; // close sidebar-content

    html += `
        <div class="sidebar-actions">
            <button onclick="createNewRecord()" class="btn-new-record">+ New Record</button>
            <div class="sidebar-actions-row">
                <button onclick="handleImport()" class="btn-secondary">Import</button>
                <button onclick="handleExport()" class="btn-secondary">Export</button>
                <button onclick="handleReset()" class="btn-secondary">Reset</button>
            </div>
            <div class="sidebar-actions-row sidebar-help-row">
                <button onclick="showHelp()" class="btn-secondary" title="Help">? Help</button>
            </div>
            <div class="sidebar-actions-row sidebar-theme-row">
                <button onclick="toggleTheme()" class="btn-secondary btn-theme-toggle" title="Toggle light/dark theme">${document.documentElement.getAttribute('data-theme') === 'light' ? '\u263D' : '\u2604'}</button>
            </div>
        </div>
    `;

    UI.sidebar.innerHTML = html;

    // Restore scroll position
    const newSidebarContent = UI.sidebar.querySelector('.sidebar-content');
    if (newSidebarContent) {
        newSidebarContent.scrollTop = scrollTop;
    }

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

    // Scroll active tab into view
    const activeTab = UI.tabBar.querySelector('.tab.active');
    if (activeTab) {
        activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
}

/**
 * Open a record
 */
function openRecord(recordId) {
    const record = findRecord(UI.data, recordId);
    if (!record) return;

    // Close sidebar on mobile
    closeSidebar();

    // Add to open tabs if not already there
    if (!UI.openTabs.includes(recordId)) {
        UI.openTabs.push(recordId);
    }

    // Switch to this record
    UI.currentRecordId = recordId;

    // Save last viewed record and open tabs (metadata only, don't mark Drive dirty)
    UI.data.settings.lastRecordId = recordId;
    UI.data.settings.openTabs = [...UI.openTabs];
    debouncedSave(UI.data, 500, false);

    // Create editor if not exists
    if (!UI.editors.has(recordId)) {
        createEditorForRecord(record);
    }

    // Show the editor
    showEditor(recordId);

    // Restore status from record (don't re-save — it's already persisted)
    if (record.status) {
        setStatus(record.status, !!record.statusIsError, false);
        UI.lastPersistentStatus = { message: record.status, isError: !!record.statusIsError };
    } else {
        setStatus('Ready', false, false);
        UI.lastPersistentStatus = { message: 'Ready', isError: false };
    }

    // Update UI
    renderTabBar();
    renderSidebar();
    renderDetailsPanel();
}

/**
 * Get reference constants and functions from the Constants and Functions records
 * @returns {{ constants: Set, functions: Set }}
 */
function getReferenceInfo() {
    const constantNames = new Set();
    const functionNames = new Set();
    let parsedConstants = null;
    let parsedFunctions = null;

    if (UI.data && UI.data.records) {
        // Parse Constants record (reuse editor tokens if available)
        const constantsRecord = UI.data.records.find(r => isReferenceRecord(r, 'Constants'));
        if (constantsRecord) {
            const editorInfo = UI.editors.get(constantsRecord.id);
            const tokens = editorInfo ? editorInfo.editor.parserTokens : null;
            parsedConstants = parseConstantsRecord(constantsRecord.text, tokens);
            for (const name of parsedConstants.keys()) {
                constantNames.add(name);
            }
        }

        // Parse Functions record (reuse editor tokens if available)
        const functionsRecord = UI.data.records.find(r => isReferenceRecord(r, 'Functions'));
        if (functionsRecord) {
            const editorInfo = UI.editors.get(functionsRecord.id);
            const tokens = editorInfo ? editorInfo.editor.parserTokens : null;
            parsedFunctions = parseFunctionsRecord(functionsRecord.text, tokens);
            for (const name of parsedFunctions.keys()) {
                functionNames.add(name.toLowerCase());
            }
        }
    }

    return { constants: constantNames, functions: functionNames, parsedConstants, parsedFunctions };
}

/**
 * Update reference info on all editors
 * Call this when Constants or Functions records are modified, or when shadowConstants changes
 */
function updateAllEditorsReferenceInfo() {
    const { constants, functions, parsedConstants, parsedFunctions } = getReferenceInfo();
    for (const [id, { editor }] of UI.editors) {
        const record = UI.data.records.find(r => r.id === id);
        const shadowConstants = (record && record.shadowConstants) || false;
        editor.setReferenceInfo(constants, functions, shadowConstants, parsedConstants, parsedFunctions);
    }
}

/**
 * Create an editor for a record
 */
function createEditorForRecord(record) {
    // Create split container
    const container = document.createElement('div');
    container.className = 'editor-split-container';
    container.id = `editor-${record.id}`;
    container.style.display = 'none';

    // Create formulas panel
    const formulasPanel = document.createElement('div');
    formulasPanel.className = 'formulas-panel';
    const formulasHeader = document.createElement('div');
    formulasHeader.className = 'formulas-header';
    formulasHeader.textContent = 'Formulas';
    formulasPanel.appendChild(formulasHeader);

    // Create resize divider
    const divider = document.createElement('div');
    divider.className = 'panel-divider';

    // Create variables panel (top)
    const variablesPanel = document.createElement('div');
    variablesPanel.className = 'variables-panel';
    const variablesHeader = document.createElement('div');
    variablesHeader.className = 'variables-header';
    variablesHeader.textContent = getTitleFromContent(record.text);
    variablesPanel.appendChild(variablesHeader);
    const variablesTable = document.createElement('div');
    variablesTable.className = 'variables-table';
    variablesPanel.appendChild(variablesTable);

    container.appendChild(variablesPanel);
    container.appendChild(divider);
    container.appendChild(formulasPanel);
    UI.editorContainer.appendChild(container);

    // Create SimpleEditor in formulas panel
    const editor = createEditor(formulasPanel, {
        value: record.text
    });

    // Create VariablesPanel manager
    const variablesManager = new VariablesPanel(
        variablesPanel.querySelector('.variables-table'),
        record,
        editor
    );

    // Set up bidirectional sync
    let syncFromVariables = false;

    editor.onChange((value, metadata, undoRedo) => {
        record.text = value;
        debouncedSave(UI.data);

        // Update title if first comment changed
        updateRecordTitleFromContent(record);
        updateVariablesHeader(record);

        // Update variables panel (unless change originated from variables panel)
        if (!syncFromVariables) {
            if (undoRedo) variablesManager.enableFlash();
            variablesManager.updateFromText(value);
            // Restore cached highlights and status on undo/redo, clear on normal edits
            if (metadata) {
                if (metadata.errors || metadata.equationVarStatus) {
                    variablesManager.setErrors(metadata.errors, metadata.equationVarStatus);
                } else {
                    variablesManager.clearErrors();
                }
                if (metadata.statusMessage != null) {
                    setStatus(metadata.statusMessage, metadata.statusIsError);
                }
            } else {
                variablesManager.clearErrors();
            }
        }
        syncFromVariables = false;

        // If Constants or Functions record changed, update all editors' reference highlighting
        if (isReferenceRecord(record) && (record.title === 'Constants' || record.title === 'Functions')) {
            updateAllEditorsReferenceInfo();
        }
    });

    variablesManager.onValueChange((varName, newValue, newText) => {
        syncFromVariables = true;
        const cursorPos = editor.getCursorPosition();
        const oldLength = editor.getValue().length;
        editor.setValue(newText, true);  // undoable=true for granular undo of each change
        syncFromVariables = false;  // Reset immediately so undo can update vars panel
        const delta = newText.length - oldLength;
        editor.setCursorPosition(Math.max(0, cursorPos + delta));
    });

    variablesManager.onSolve((undoable) => {
        handleSolve(undoable);
    });

    // Save scroll position when user scrolls (metadata only, don't mark Drive dirty)
    editor.onScrollChange((scrollTop) => {
        record.scrollTop = scrollTop;
        debouncedSave(UI.data, 500, false);
    });

    // Set up divider drag
    setupPanelResizer(divider, variablesPanel, formulasPanel);

    // Panel expand/collapse for mobile keyboard is handled by the
    // visualViewport resize handler in setupEventListeners()

    // Initial variables render
    variablesManager.updateFromText(record.text);

    // Set reference info for highlighting
    const { constants, functions, parsedConstants, parsedFunctions } = getReferenceInfo();
    editor.setReferenceInfo(constants, functions, record.shadowConstants || false, parsedConstants, parsedFunctions);

    // Update undo/redo button states when stacks change
    editor.onUndoStateChange((canUndo, canRedo) => {
        if (UI.currentRecordId === record.id) {
            updateUndoButtons(canUndo, canRedo);
        }
    });

    UI.editors.set(record.id, { editor, container, variablesManager });
}

/**
 * Update undo/redo button enabled states
 */
function updateUndoButtons(canUndo, canRedo) {
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.disabled = !canUndo;
    if (redoBtn) redoBtn.disabled = !canRedo;
}

/**
 * Show a specific editor
 */
function showEditor(recordId) {
    // Hide all editors
    for (const [id, { container }] of UI.editors) {
        container.style.display = id === recordId ? 'flex' : 'none';
    }

    // Hide the "no editor" message when showing an editor
    const noEditorMsg = document.querySelector('.no-editor-message');
    if (noEditorMsg) {
        noEditorMsg.style.display = recordId ? 'none' : 'block';
    }

    // Restore scroll and divider positions after showing
    const editorInfo = UI.editors.get(recordId);
    const record = findRecord(UI.data, recordId);
    if (editorInfo && record) {
        // Restore or auto-fit divider position
        const variablesPanel = editorInfo.container.querySelector('.variables-panel');
        if (record.dividerHeight) {
            if (variablesPanel) {
                // Clamp saved height to current container bounds
                const containerHeight = editorInfo.container.offsetHeight;
                const divider = editorInfo.container.querySelector('.panel-divider');
                const formulasPanel = editorInfo.container.querySelector('.formulas-panel');
                const varHeader = variablesPanel.querySelector('.variables-header');
                const fmtHeader = formulasPanel ? formulasPanel.querySelector('.formulas-header') : null;
                const minTop = varHeader ? varHeader.offsetHeight : 0;
                const maxTop = containerHeight - (divider ? divider.offsetHeight : 0) - (fmtHeader ? fmtHeader.offsetHeight : 0);
                const clamped = Math.max(minTop, Math.min(maxTop, record.dividerHeight));
                variablesPanel.style.height = clamped + 'px';
            }
        } else if (variablesPanel) {
            // Auto-fit: size to content, clamped between 1/4 and 3/4 of container
            requestAnimationFrame(() => {
                const containerHeight = editorInfo.container.offsetHeight;
                const table = variablesPanel.querySelector('.variables-table');
                const header = variablesPanel.querySelector('.variables-header');
                const headerHeight = header ? header.offsetHeight : 0;
                const contentHeight = (table ? table.scrollHeight : 0) + headerHeight;
                const minHeight = containerHeight * 0.25;
                const maxHeight = containerHeight * 0.75;
                const fitHeight = Math.max(minHeight, Math.min(maxHeight, contentHeight));
                variablesPanel.style.height = fitHeight + 'px';
            });
        }
        // Restore scroll position and set cursor to end of first visible line
        requestAnimationFrame(() => {
            if (record.scrollTop) {
                editorInfo.editor.setScrollPosition(record.scrollTop);
            }
            // Calculate cursor position at end of first visible line
            const lineHeight = editorInfo.editor.getLineHeight();
            const scrollTop = record.scrollTop || 0;
            const firstVisibleLine = Math.floor(scrollTop / lineHeight);
            const lines = record.text.split('\n');
            let cursorPos = 0;
            for (let i = 0; i < firstVisibleLine && i < lines.length; i++) {
                cursorPos += lines[i].length + 1; // +1 for newline
            }
            if (firstVisibleLine < lines.length) {
                cursorPos += lines[firstVisibleLine].length; // end of line
            }
            editorInfo.editor.setCursorPosition(cursorPos);
        });

        // Update undo/redo button states for this editor
        updateUndoButtons(editorInfo.editor.canUndo(), editorInfo.editor.canRedo());
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

    // Save open tabs (metadata only, don't mark Drive dirty)
    UI.data.settings.openTabs = [...UI.openTabs];
    debouncedSave(UI.data, 500, false);

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
    ).join('') + '<option value="__new__">+ Add new...</option>';

    const formatOptions = ['float', 'sci', 'eng'].map(fmt =>
        `<option value="${fmt}" ${fmt === record.format ? 'selected' : ''}>${fmt.charAt(0).toUpperCase() + fmt.slice(1)}</option>`
    ).join('');

    UI.detailsPanel.innerHTML = `
        <div class="details-header">Record Settings</div>

        <div class="detail-group">
            <label>Category</label>
            <select id="detail-category" onchange="updateRecordDetail('category', this.value)">
                ${categoryOptions}
            </select>
        </div>

        <div class="detail-group">
            <label>Decimal Places</label>
            <div class="number-with-buttons">
                <button onclick="var i=document.getElementById('detail-places'); i.stepDown(); i.dispatchEvent(new Event('change'))">−</button>
                <input type="number" id="detail-places" min="0" max="15" value="${record.places != null ? record.places : 2}"
                       onchange="updateRecordDetail('places', parseInt(this.value))">
                <button onclick="var i=document.getElementById('detail-places'); i.stepUp(); i.dispatchEvent(new Event('change'))">+</button>
            </div>
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

        <div class="detail-group checkbox">
            <label>
                <input type="checkbox" id="detail-group" ${record.groupDigits ? 'checked' : ''}
                       onchange="updateRecordDetail('groupDigits', this.checked)">
                Group digits with commas
            </label>
        </div>

        <div class="detail-group checkbox">
            <label>
                <input type="checkbox" id="detail-degrees" ${record.degreesMode ? 'checked' : ''}
                       onchange="updateRecordDetail('degreesMode', this.checked)">
                Degrees mode (vs radians)
            </label>
        </div>

        <div class="detail-group checkbox">
            <label>
                <input type="checkbox" id="detail-shadow" ${record.shadowConstants ? 'checked' : ''}
                       onchange="updateRecordDetail('shadowConstants', this.checked)">
                Shadow constants
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

    // Handle adding a new category
    if (field === 'category' && value === '__new__') {
        const newCategory = prompt('Enter new category name:');
        if (newCategory && newCategory.trim()) {
            const trimmed = newCategory.trim();
            if (!UI.data.categories.includes(trimmed)) {
                UI.data.categories.push(trimmed);
            }
            value = trimmed;
        } else {
            // User cancelled - revert to current category
            renderDetailsPanel();
            renderSettingsModal();
            return;
        }
    }

    record[field] = value;
    debouncedSave(UI.data);

    if (field === 'category') {
        // Moving a Constants/Functions record to/from Reference changes what's available
        if (isReferenceTitle(record.title)) {
            updateAllEditorsReferenceInfo();
        }
        // If moved out of Reference, auto-update title from content like a normal record
        if (value !== 'Reference') {
            updateRecordTitleFromContent(record);
        }
        renderSidebar();
        renderDetailsPanel();
        renderSettingsModal();
    }

    // Update editor highlighting when shadowConstants changes
    if (field === 'shadowConstants') {
        const editorInfo = UI.editors.get(record.id);
        if (editorInfo) {
            const { constants, functions, parsedConstants, parsedFunctions } = getReferenceInfo();
            editorInfo.editor.setReferenceInfo(constants, functions, value, parsedConstants, parsedFunctions);
        }
    }
}

/**
 * Create a new record
 */
function createNewRecord() {
    const record = createRecord(UI.data);
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
        updateVariablesHeader(record);
    }
}

/**
 * Extract title from the first line of record text, using tokens if available
 */
function getTitleFromContent(text, tokens) {
    if (tokens) {
        const firstLine = tokens[0] || [];
        const firstComment = firstLine.find(t => t.type === TokenType.COMMENT && !t.lineComment);
        if (firstComment) return firstComment.value || 'Untitled';
    }
    // Fallback: parse first line
    const firstLine = (text || '').split('\n')[0].trim();
    const completeQuote = firstLine.match(/^"([^"]+)"$/);
    const startQuote = firstLine.match(/^"(.+)$/);
    if (completeQuote) return completeQuote[1];
    if (startQuote) return startQuote[1];
    return firstLine || 'Untitled';
}

/**
 * Update the variables panel header with the record title
 */
function updateVariablesHeader(record) {
    const editorInfo = UI.editors.get(record.id);
    if (!editorInfo) return;
    const header = editorInfo.container.querySelector('.variables-header');
    if (header) {
        header.textContent = getTitleFromContent(record.text, editorInfo.editor.parserTokens);
    }
}

/**
 * Update record title from content (first line, with or without quotes)
 */
function updateRecordTitleFromContent(record) {
    // Don't auto-update title for special records
    if (isReferenceRecord(record)) {
        return;
    }
    const editorInfo = UI.editors.get(record.id);
    const tokens = editorInfo ? editorInfo.editor.parserTokens : null;
    let newTitle = getTitleFromContent(record.text, tokens);

    // Truncate long titles
    if (newTitle.length > 30) {
        newTitle = newTitle.substring(0, 30) + '...';
    }

    if (newTitle !== record.title) {
        record.title = newTitle;
        renderSidebar();
        renderTabBar();
        updateVariablesHeader(record);
    }
}

/**
 * Duplicate the current record
 */
function duplicateCurrentRecord() {
    if (!UI.currentRecordId) return;

    const record = findRecord(UI.data, UI.currentRecordId);
    if (!record) return;

    let newText = record.text;

    // Update the title in the text if present (quoted or plain text, not code)
    const lines = newText.split('\n');
    const firstLine = lines[0].trim();
    const completeQuote = firstLine.match(/^"([^"]+)"$/);
    const startQuote = firstLine.match(/^"(.+)$/);

    // Check if first line is a title (quoted comment or plain text, not code)
    // Use LineParser to determine if it's code
    const parser = new LineParser(firstLine);
    const parsed = parser.parse();
    const isCodeLine = parsed !== null; // null means plain text, not a declaration/expression

    if (completeQuote) {
        // Complete quoted title - append (copy) inside quotes
        lines[0] = `"${completeQuote[1]} (copy)"`;
        newText = lines.join('\n');
    } else if (startQuote) {
        // Multi-line comment - append (copy) after opening quote content
        lines[0] = `"${startQuote[1]} (copy)`;
        newText = lines.join('\n');
    } else if (!isCodeLine && firstLine) {
        // Plain text title - append (copy)
        lines[0] = firstLine + ' (copy)';
        newText = lines.join('\n');
    }

    // The display title will be truncated if needed by updateRecordTitleFromContent
    const newTitle = record.title + ' (copy)';

    const newRecord = {
        ...record,
        id: generateId(),
        title: newTitle,
        text: newText
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
 * @param {string} message - The status message
 * @param {boolean} isError - Whether this is an error message
 * @param {boolean} persist - Whether to save to the record (default true)
 */
function setStatus(message, isError = false, persist = true) {
    const statusText = document.getElementById('status-text');
    if (statusText) {
        statusText.textContent = message;
    } else {
        UI.statusBar.textContent = message;
    }
    UI.statusBar.className = 'status-bar' + (isError ? ' error' : '');

    if (persist) {
        UI.lastPersistentStatus = { message, isError };
    }

    // Save status to current record (unless persist is false)
    if (persist && UI.currentRecordId) {
        const record = findRecord(UI.data, UI.currentRecordId);
        if (record) {
            record.status = message;
            record.statusIsError = isError;
            debouncedSave(UI.data);
        }
    }
}

/**
 * Toggle sidebar visibility (for mobile)
 */
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('visible');
}

/**
 * Close sidebar (for mobile)
 */
function closeSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
}

/**
 * Toggle settings modal visibility
 */
function toggleSettings() {
    const modal = document.getElementById('settings-modal');
    const isVisible = modal.classList.contains('visible');

    if (!isVisible) {
        // Populate the modal with current settings
        renderSettingsModal();
    }

    modal.classList.toggle('visible');
}

/**
 * Render settings modal content
 */
function renderSettingsModal() {
    const body = document.getElementById('settings-modal-body');
    if (!UI.currentRecordId) {
        body.innerHTML = '<div class="no-record">No record selected</div>';
        return;
    }

    const record = findRecord(UI.data, UI.currentRecordId);
    if (!record) return;

    const categoryOptions = UI.data.categories.map(cat =>
        `<option value="${escapeAttr(cat)}" ${cat === record.category ? 'selected' : ''}>${escapeHtmlText(cat)}</option>`
    ).join('') + '<option value="__new__">+ Add new...</option>';

    const formatOptions = ['float', 'sci', 'eng'].map(fmt =>
        `<option value="${fmt}" ${fmt === record.format ? 'selected' : ''}>${fmt.charAt(0).toUpperCase() + fmt.slice(1)}</option>`
    ).join('');

    body.innerHTML = `
        <div class="detail-group">
            <label>Category</label>
            <select onchange="updateRecordDetail('category', this.value); renderSettingsModal();">
                ${categoryOptions}
            </select>
        </div>

        <div class="detail-group">
            <label>Decimal Places</label>
            <div class="number-with-buttons">
                <button onclick="var i=this.parentElement.querySelector('input'); i.stepDown(); i.dispatchEvent(new Event('change'))">−</button>
                <input type="number" min="0" max="15" value="${record.places != null ? record.places : 2}"
                       onchange="updateRecordDetail('places', parseInt(this.value))">
                <button onclick="var i=this.parentElement.querySelector('input'); i.stepUp(); i.dispatchEvent(new Event('change'))">+</button>
            </div>
        </div>

        <div class="detail-group">
            <label>Format</label>
            <select onchange="updateRecordDetail('format', this.value)">
                ${formatOptions}
            </select>
        </div>

        <div class="detail-group checkbox">
            <label>
                <input type="checkbox" ${record.stripZeros ? 'checked' : ''}
                       onchange="updateRecordDetail('stripZeros', this.checked)">
                Strip trailing zeros
            </label>
        </div>

        <div class="detail-group checkbox">
            <label>
                <input type="checkbox" ${record.groupDigits ? 'checked' : ''}
                       onchange="updateRecordDetail('groupDigits', this.checked)">
                Group digits with commas
            </label>
        </div>

        <div class="detail-group checkbox">
            <label>
                <input type="checkbox" ${record.degreesMode ? 'checked' : ''}
                       onchange="updateRecordDetail('degreesMode', this.checked)">
                Degrees mode (vs radians)
            </label>
        </div>

        <div class="detail-group checkbox">
            <label>
                <input type="checkbox" ${record.shadowConstants ? 'checked' : ''}
                       onchange="updateRecordDetail('shadowConstants', this.checked)">
                Shadow constants
            </label>
        </div>

        <div class="details-actions">
            <button onclick="duplicateCurrentRecord(); toggleSettings();" class="btn-secondary">Duplicate</button>
            <button onclick="deleteCurrentRecord(); toggleSettings();" class="btn-danger">Delete</button>
        </div>

        <div class="settings-modal-footer">
            <button onclick="toggleSettings()" class="btn-primary">Done</button>
        </div>
    `;
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Helper to safely add event listeners to elements that may not exist
    function addListener(id, event, handler) {
        var el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
    }

    // Import button
    addListener('btn-import', 'click', handleImport);

    // Export button
    addListener('btn-export', 'click', handleExport);

    // Reset button
    addListener('btn-reset', 'click', handleReset);

    // Undo button
    addListener('btn-undo', 'click', () => {
        const editorInfo = UI.editors.get(UI.currentRecordId);
        if (editorInfo) {
            editorInfo.editor.undo();
        }
    });

    // Redo button
    addListener('btn-redo', 'click', () => {
        const editorInfo = UI.editors.get(UI.currentRecordId);
        if (editorInfo) {
            editorInfo.editor.redo();
        }
    });

    // Solve button
    addListener('btn-solve', 'click', handleSolve);

    // Clear Input button
    addListener('btn-clear', 'click', handleClearInput);

    // File input for import
    addListener('file-input', 'change', handleFileSelect);

    // Mobile: Hamburger button
    addListener('hamburger-btn', 'click', toggleSidebar);

    // Mobile: Sidebar overlay click to close
    addListener('sidebar-overlay', 'click', closeSidebar);

    // Mobile: Settings button
    addListener('settings-btn', 'click', toggleSettings);

    // Mobile: Settings modal close button
    addListener('settings-modal-close', 'click', toggleSettings);

    // Mobile: Settings modal overlay click to close
    addListener('settings-modal', 'click', (e) => {
        if (e.target.id === 'settings-modal') {
            toggleSettings();
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + Enter to solve
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleSolve();
        }
        // Ctrl/Cmd + Shift + S to clear
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            handleClearInput();
            return;
        }
        // Ctrl/Cmd + S to solve
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            handleSolve();
        }
        // Escape to close modals/sidebar
        if (e.key === 'Escape') {
            const settingsModal = document.getElementById('settings-modal');
            if (settingsModal && settingsModal.classList.contains('visible')) {
                toggleSettings();
            }
            const sidebar = document.querySelector('.sidebar');
            if (sidebar && sidebar.classList.contains('open')) {
                closeSidebar();
            }
        }
    });

    // Mobile keyboard handling: shrink entire UIA to fit above keyboard
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            const vpHeight = window.visualViewport.height;
            const keyboardShowing = vpHeight < window.innerHeight * 0.85;
            const appContainer = document.querySelector('.app-container');
            if (!appContainer) return;

            if (keyboardShowing) {
                appContainer.style.height = vpHeight + 'px';
                // Expand focused panel if not already expanded (handles re-focus in same field)
                const info = UI.editors.get(UI.currentRecordId);
                if (info && info.savedDividerHeight == null) {
                    const active = document.activeElement;
                    const variablesPanel = info.container.querySelector('.variables-panel');
                    const formulasPanel = info.container.querySelector('.formulas-panel');
                    if (variablesPanel && formulasPanel && info.container.contains(active)) {
                        info.savedDividerHeight = variablesPanel.style.height;
                        const varsHeader = variablesPanel.querySelector('.variables-header');
                        const varsHeaderH = varsHeader ? varsHeader.offsetHeight : 0;
                        const divider = info.container.querySelector('.panel-divider');
                        const dividerH = divider ? divider.offsetHeight : 0;
                        const fmtHeader = formulasPanel.querySelector('.formulas-header');
                        const fmtHeaderH = fmtHeader ? fmtHeader.offsetHeight : 0;

                        if (variablesPanel.contains(active)) {
                            const maxH = info.container.offsetHeight - dividerH - fmtHeaderH;
                            variablesPanel.style.height = Math.max(varsHeaderH, maxH) + 'px';
                        } else if (formulasPanel.contains(active)) {
                            variablesPanel.style.height = varsHeaderH + 'px';
                        }
                    }
                }
            } else {
                appContainer.style.removeProperty('height');
                // Restore divider position when keyboard dismisses
                const info = UI.editors.get(UI.currentRecordId);
                if (info && info.savedDividerHeight != null) {
                    const variablesPanel = info.container.querySelector('.variables-panel');
                    if (variablesPanel) {
                        variablesPanel.style.height = info.savedDividerHeight;
                    }
                    info.savedDividerHeight = null;
                }
            }
        });
    }
}

/**
 * Handle import
 */
function handleImport() {
    var fileInput = document.getElementById('file-input');
    if (fileInput) fileInput.click();
}

/**
 * Handle file selection for import
 */
async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Warn user that import will replace all records
    const confirmed = confirm('This will replace all existing records.\n\nContinue?');
    if (!confirmed) {
        e.target.value = '';
        return;
    }

    try {
        setStatus('Importing...', false, false);
        const text = await readTextFile(file);
        UI.data = importFromText(text, UI.data, { clearExisting: true });
        saveData(UI.data);

        // Clear all editors since records may have changed
        for (const [id, { container }] of UI.editors) {
            container.remove();
        }
        UI.editors.clear();
        UI.openTabs = [];
        UI.currentRecordId = null;

        // Re-render UI
        renderSidebar();
        renderTabBar();
        renderDetailsPanel();

        // Open the selected record from the imported file, or first record
        const selectedId = UI.data.settings && UI.data.settings.lastRecordId;
        const recordToOpen = selectedId ? findRecord(UI.data, selectedId) : null;
        if (recordToOpen) {
            openRecord(recordToOpen.id);
        } else if (UI.data.records.length > 0) {
            openRecord(UI.data.records[0].id);
        } else {
            // No records - show the "no editor" message
            const noEditorMsg = document.querySelector('.no-editor-message');
            if (noEditorMsg) noEditorMsg.style.display = 'block';
        }

        const count = UI.data.records.length;
        setStatus(`Imported ${count} record${count !== 1 ? 's' : ''} from ${file.name}`, false, false);
    } catch (err) {
        setStatus('Import failed: ' + err.message, true, false);
    }

    // Reset file input
    e.target.value = '';
}

/**
 * Handle export
 */
function handleExport() {
    try {
        const text = exportToText(UI.data, { selectedRecordId: UI.currentRecordId });
        const d = new Date();
        const timestamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        downloadTextFile(text, `mathpad_export_${timestamp}.txt`);
        setStatus('Exported successfully', false, false);
    } catch (err) {
        setStatus('Export failed: ' + err.message, true, false);
    }
}

/**
 * Handle reset to defaults
 */
function handleReset() {
    const confirmed = confirm(
        'Reset to default records?\n\n' +
        'This will DELETE ALL your records and restore the original examples.\n\n' +
        'Consider exporting your records first if you want to keep them.'
    );

    if (confirmed) {
        // Clear all editors
        for (const [id, { container }] of UI.editors) {
            container.remove();
        }
        UI.editors.clear();
        UI.openTabs = [];
        UI.currentRecordId = null;

        // Reset data to defaults
        UI.data = createDefaultData();
        saveData(UI.data);

        // Re-render UI
        renderSidebar();
        renderTabBar();
        renderDetailsPanel();

        // Open the first record
        if (UI.data.records.length > 0) {
            openRecord(UI.data.records[0].id);
        }

        setStatus('Reset to default records', false, false);
    }
}

/**
 * Handle solve
 */
function handleSolve(undoable = true) {
    if (!UI.currentRecordId) {
        setStatus('No record selected', true);
        return;
    }

    const record = findRecord(UI.data, UI.currentRecordId);
    if (!record) return;

    const editorInfo = UI.editors.get(UI.currentRecordId);
    if (!editorInfo) return;

    try {
        // Capture pre-solve status before it changes
        const preStatus = { ...UI.lastPersistentStatus };

        setStatus('Solving...', false, false);

        // Get current text from editor
        let text = editorInfo.editor.getValue();

        // Remember cursor line position
        const cursorPos = editorInfo.editor.getCursorPosition();
        const textBeforeCursor = text.substring(0, cursorPos);
        const cursorLine = textBeforeCursor.split('\n').length - 1;

        // Create evaluation context with constants and user functions
        const parserTokens = editorInfo.editor.parserTokens;
        const context = createEvalContext(record,
            editorInfo.editor.parsedConstants, editorInfo.editor.parsedFunctions,
            text, parserTokens);

        // Solve the record (captures pre-solve values and clears outputs internally)
        const result = solveRecord(text, context, record, parserTokens);
        text = result.text;

        // Enable flash before setValue so onChange's updateFromText highlights changed values
        editorInfo.variablesManager.enableFlash();

        // Update editor with results (undoable so Ctrl+Z works)
        // Pass pre-solve status so undo restores it on the entry being left behind
        const textChanged = editorInfo.editor.setValue(text, undoable, {
            statusMessage: preStatus.message,
            statusIsError: preStatus.isError
        });

        // Set status (persistent only if text changed, transient otherwise)
        if (result.errors.length > 0) {
            setStatus(result.errors.join('\n'), true, textChanged);
        } else if (result.solved > 0) {
            setStatus(`Solved ${result.solved} equation${result.solved > 1 ? 's' : ''}`, false, textChanged);
        } else {
            setStatus('Nothing to solve', false, false);
        }

        // Cache solve results on undo entry so undo/redo can restore highlights
        if (textChanged) {
            editorInfo.editor.setTopMetadata({
                errors: result.errors,
                equationVarStatus: result.equationVarStatus,
                statusMessage: UI.lastPersistentStatus.message,
                statusIsError: UI.lastPersistentStatus.isError
            });
        }

        // Restore cursor to end of same line (keeps scroll position)
        const newLines = text.split('\n');
        const targetLine = Math.min(cursorLine, newLines.length - 1);
        let newPos = 0;
        for (let i = 0; i < targetLine; i++) {
            newPos += newLines[i].length + 1; // +1 for newline
        }
        newPos += newLines[targetLine].length; // end of line
        editorInfo.editor.setCursorPosition(newPos);

        // Don't leave focus in the textarea
        editorInfo.editor.textarea.blur();
        record.text = text;
        debouncedSave(UI.data);

        // Set error/equation highlights and clear edit tracking
        editorInfo.variablesManager.setErrors(result.errors, result.equationVarStatus);
        editorInfo.variablesManager.clearLastEdited();

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

    // Capture pre-clear status before it changes
    const preStatus = { ...UI.lastPersistentStatus };

    let text = editorInfo.editor.getValue();

    // Remember cursor line position
    const cursorPos = editorInfo.editor.getCursorPosition();
    const textBeforeCursor = text.substring(0, cursorPos);
    const cursorLine = textBeforeCursor.split('\n').length - 1;

    let clearResult = clearVariables(text, 'input', editorInfo.editor.parserTokens);
    clearResult = clearVariables(clearResult.text, 'output', clearResult.allTokens);
    text = clearResult.text;

    // Remove references section
    text = text.replace(/\n*"--- Reference Constants and Functions ---"[\s\S]*$/, '');

    // Enable flash before setValue so onChange's updateFromText highlights changed values
    editorInfo.variablesManager.enableFlash();

    // Use undoable so Ctrl+Z works
    // Pass pre-clear status so undo restores it on the entry being left behind
    const textChanged = editorInfo.editor.setValue(text, true, {
        statusMessage: preStatus.message,
        statusIsError: preStatus.isError
    });

    // Always clear error highlights (even if text unchanged, e.g. failed solve left no values)
    editorInfo.variablesManager.clearErrors();

    // Only update persistent status and undo metadata if text actually changed
    if (textChanged) {
        setStatus('Cleared');
        editorInfo.editor.setTopMetadata({
            statusMessage: 'Cleared',
            statusIsError: false
        });
    } else {
        // Text unchanged but still clear the error status
        setStatus('Cleared', false, false);
    }

    // Restore cursor to end of same line (keeps scroll position)
    const newLines = text.split('\n');
    const targetLine = Math.min(cursorLine, newLines.length - 1);
    let newPos = 0;
    for (let i = 0; i < targetLine; i++) {
        newPos += newLines[i].length + 1; // +1 for newline
    }
    newPos += newLines[targetLine].length; // end of line
    editorInfo.editor.setCursorPosition(newPos);

    // Don't leave focus in the textarea
    editorInfo.editor.textarea.blur();
    record.text = text;
    debouncedSave(UI.data);
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

/**
 * Setup panel resizer for the divider
 */
function setupPanelResizer(divider, topPanel, bottomPanel) {
    let startY, startHeight, maxHeight;

    // Prevent browser from taking over touch gestures
    divider.style.touchAction = 'none';

    divider.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        divider.setPointerCapture(e.pointerId);
        startY = e.clientY;
        startHeight = topPanel.offsetHeight;
        // Cache container height to avoid layout thrashing during drag
        maxHeight = topPanel.parentElement.offsetHeight;
        divider.classList.add('dragging');
        document.body.classList.add('panel-resizing');
    });

    // Minimum heights to keep headers visible
    function getMinTop() {
        const header = topPanel.querySelector('.variables-header');
        return header ? header.offsetHeight : 0;
    }
    function getMinBottom() {
        const header = bottomPanel.querySelector('.formulas-header');
        return header ? header.offsetHeight : 0;
    }

    divider.addEventListener('pointermove', (e) => {
        if (!divider.hasPointerCapture(e.pointerId)) return;
        const delta = e.clientY - startY;
        const minTop = getMinTop();
        const maxTop = maxHeight - divider.offsetHeight - getMinBottom();
        const newHeight = Math.max(minTop, Math.min(maxTop, startHeight + delta));
        topPanel.style.height = newHeight + 'px';
    });

    function endDrag() {
        divider.classList.remove('dragging');
        document.body.classList.remove('panel-resizing');

        // Save divider position to current record (metadata only, don't mark Drive dirty)
        const record = findRecord(UI.data, UI.currentRecordId);
        if (record) {
            record.dividerHeight = topPanel.offsetHeight;
            debouncedSave(UI.data, 500, false);
        }

    }

    divider.addEventListener('pointerup', endDrag);
    divider.addEventListener('pointercancel', endDrag);

    // Clamp panel height on window resize so divider stays visible
    window.addEventListener('resize', () => {
        const containerHeight = topPanel.parentElement.offsetHeight;
        const minTop = getMinTop();
        const maxTop = containerHeight - divider.offsetHeight - getMinBottom();
        const current = topPanel.offsetHeight;
        const clamped = Math.max(minTop, Math.min(maxTop, current));
        if (clamped !== current) {
            topPanel.style.height = clamped + 'px';
            const record = findRecord(UI.data, UI.currentRecordId);
            if (record) {
                record.dividerHeight = clamped;
                debouncedSave(UI.data, 500, false);
            }
        }
    });
}

/**
 * Reload the entire UI with new data (e.g. from Drive).
 * Replaces localStorage, clears editors, re-renders everything.
 */
function reloadUIWithData(newData) {
    // Clear all editors
    for (const [id, { container }] of UI.editors) {
        container.remove();
    }
    UI.editors.clear();
    UI.openTabs = [];
    UI.currentRecordId = null;

    // Replace data
    UI.data = newData;
    saveData(UI.data);

    // Re-render UI
    renderSidebar();
    renderTabBar();
    renderDetailsPanel();

    // Open the last viewed record or the first record
    const lastRecordId = UI.data.settings && UI.data.settings.lastRecordId;
    const recordToOpen = lastRecordId ? findRecord(UI.data, lastRecordId) : null;
    if (recordToOpen) {
        openRecord(recordToOpen.id);
    } else if (UI.data.records.length > 0) {
        openRecord(UI.data.records[0].id);
    }
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
window.toggleSidebar = toggleSidebar;
window.closeSidebar = closeSidebar;
window.toggleSettings = toggleSettings;
window.renderSettingsModal = renderSettingsModal;
window.handleImport = handleImport;
window.handleExport = handleExport;
window.handleReset = handleReset;
window.reloadUIWithData = reloadUIWithData;

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        UI, initUI, renderSidebar, renderTabBar, renderDetailsPanel,
        openRecord, closeTab, setStatus, handleSolve, reloadUIWithData
    };
}
