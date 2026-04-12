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
    visitHistory: [],        // Recently visited record IDs (most recent last)
    editors: new Map(),      // Map of recordId -> editor info
    collapsedCategories: new Set() // Collapsed category names in sidebar (loaded from data.settings)
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
    UI.initComplete = false;

    // Get DOM elements
    UI.sidebar = document.getElementById('sidebar');
    UI.tabBar = document.getElementById('tab-bar');
    UI.editorContainer = document.getElementById('editor-container');
    UI.detailsPanel = document.getElementById('details-panel');
    UI.statusBar = document.getElementById('status-bar');

    // Render initial UI
    // Restore collapsed categories from settings
    if (data.settings && data.settings.collapsedCategories) {
        UI.collapsedCategories = new Set(data.settings.collapsedCategories);
    }

    renderSidebar();
    renderDetailsPanel();

    // Set up event listeners
    setupEventListeners();

    // Set up sidebar resizer and restore width
    setupSidebarResizer();

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
    restoreStatusAfterDelay();
    // Set after scroll restoration RAFs have fired
    setTimeout(() => { UI.initComplete = true; }, 50);
}

function restoreStatusAfterDelay() {
    setTimeout(() => {
        if (UI.lastPersistentStatus) {
            setStatus(UI.lastPersistentStatus.message, UI.lastPersistentStatus.isError, false);
        }
    }, 4000);
}

/**
 * Render the sidebar with categories and records
 */
function renderSidebar(useSavedScroll = false) {
    // Capture current scroll position before DOM is rebuilt
    const sidebarContent = UI.sidebar.querySelector('.sidebar-content');
    const scrollTop = sidebarContent ? sidebarContent.scrollTop : null;

    const groups = getRecordsByCategory(UI.data);
    let html = '<div class="sidebar-header">Records</div>';
    html += '<div class="sidebar-content">';

    const sortPrefs = (UI.data.settings && UI.data.settings.categorySortOrder) || {};

    for (const [category, records] of groups) {
        const isCollapsed = UI.collapsedCategories.has(category);
        const hasRecords = records.length > 0;
        const isAlpha = sortPrefs[category] === 'alpha';
        const canDelete = !hasRecords && category !== 'Unfiled' && category !== 'Reference';
        const escapedCat = escapeAttr(category);

        html += `
            <div class="category-group" data-category="${escapedCat}">
                <div class="category-header ${isCollapsed ? 'collapsed' : ''}"
                     onclick="toggleCategory('${escapedCat}')">
                    <span class="category-arrow">${isCollapsed ? '▶' : '▼'}</span>
                    <span class="category-name">${escapeHtmlText(category)}</span>
                    <span class="category-count">(${records.length})</span>
                    <span class="category-sort ${isAlpha ? 'active' : ''}"
                          onclick="event.stopPropagation(); toggleCategorySort('${escapedCat}')"
                          title="${isAlpha ? 'Sorted alphabetically (click for insertion order)' : 'Insertion order (click for alphabetical)'}">A↓</span>${canDelete ? `<span class="category-delete"
                          onclick="event.stopPropagation(); deleteSidebarCategory('${escapedCat}')"
                          title="Delete empty category">✕</span>` : ''}
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
            <div class="sidebar-actions-row sidebar-theme-help-row">
                <button onclick="showHelp()" class="btn-secondary" title="Help">? Help</button>
                <button onclick="toggleTheme()" class="btn-secondary btn-theme-toggle" title="Toggle light/dark theme">${document.documentElement.getAttribute('data-theme') === 'light' ? '\u263D' : '<span style="font-size:1.3em;line-height:1">\u263C</span>'} Theme</button>
            </div>
            <button onclick="createNewRecord()" class="btn-new-record">+ New Record</button>
            <div class="sidebar-actions-row">
                <button onclick="handleImport()" class="btn-secondary">Import</button>
                <button onclick="handleExport()" class="btn-secondary">Export</button>
                <button onclick="handleReset()" class="btn-secondary">Reset</button>
            </div>
        </div>
    `;

    UI.sidebar.innerHTML = html;

    // Restore scroll position
    const newSidebarContent = UI.sidebar.querySelector('.sidebar-content');
    if (newSidebarContent) {
        newSidebarContent.scrollTop = (scrollTop !== null && !useSavedScroll) ? scrollTop : (UI.data.settings && UI.data.settings.sidebarScrollTop) || 0;
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
    UI.data.settings.collapsedCategories = [...UI.collapsedCategories];
    debouncedSave(UI.data);
    renderSidebar();
}

/**
 * Toggle category sort between alphabetical and insertion order
 */
function toggleCategorySort(category) {
    if (!UI.data.settings) UI.data.settings = {};
    if (!UI.data.settings.categorySortOrder) UI.data.settings.categorySortOrder = {};

    const current = UI.data.settings.categorySortOrder[category];
    if (current === 'alpha') {
        delete UI.data.settings.categorySortOrder[category];
    } else {
        UI.data.settings.categorySortOrder[category] = 'alpha';
    }

    debouncedSave(UI.data);
    renderSidebar();
}

/**
 * Delete an empty category from the sidebar
 */
function deleteSidebarCategory(category) {
    if (!confirm(`Delete category "${category}"?`)) return;

    deleteCategory(UI.data, category);
    debouncedSave(UI.data);
    renderSidebar();
    renderDetailsPanel();
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

    // Track visit history (remove if already present, push to end)
    const histIdx = UIState.visitHistory.indexOf(recordId);
    if (histIdx !== -1) UIState.visitHistory.splice(histIdx, 1);
    UIState.visitHistory.push(recordId);

    // Switch to this record
    UI.currentRecordId = recordId;

    // Save last viewed record and open tabs
    UI.data.settings.lastRecordId = recordId;
    UI.data.settings.openTabs = [...UI.openTabs];
    debouncedSave(UI.data);

    // Create editor if not exists
    if (!UI.editors.has(recordId)) {
        createEditorForRecord(record);
    }

    // Show the editor
    showEditor(recordId);

    // Scroll sidebar to show current record
    const activeItem = document.querySelector(`.record-item[data-record-id="${recordId}"]`);
    if (activeItem) activeItem.scrollIntoView({ block: 'nearest' });

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
 * Call this when Constants or Functions records are modified
 */
function updateAllEditorsReferenceInfo() {
    const { constants, functions, parsedConstants, parsedFunctions } = getReferenceInfo();
    for (const [id, { editor }] of UI.editors) {
        const record = UI.data.records.find(r => r.id === id);
        const isFnRecord = record && isReferenceRecord(record, 'Functions');
        editor.setReferenceInfo(constants, isFnRecord ? null : functions, parsedConstants, isFnRecord ? null : parsedFunctions);
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

    // Strip stale table output section (table data not persisted — re-solve to regenerate)
    let initialText = record.text;
    initialText = initialText.replace(/\n*"--- Table Outputs ---"[\s\S]*$/, '');
    if (initialText !== record.text) {
        record.text = initialText;
        debouncedSave(UI.data);
    }

    // Create SimpleEditor in formulas panel
    const editor = createEditor(formulasPanel, {
        value: initialText
    });
    // Seed lastUserEditAt from record so the initial undo state has the right modifiedAt
    editor.lastUserEditAt = record.modified ?? null;
    if (editor.undoStack.length > 0) {
        editor.undoStack[0].modifiedAt = editor.lastUserEditAt;
    }

    // Create VariablesPanel manager
    const variablesManager = new VariablesPanel(
        variablesPanel.querySelector('.variables-table'),
        record,
        editor
    );

    // Set up bidirectional sync
    let syncFromVariables = false;

    editor.onChange((value, metadata, undoRedo, userInput, modifiedAt) => {
        record.text = value;
        // Track modification time:
        //   - direct user input (typing, Tab, Ctrl+/) → now
        //   - undo/redo → restored state's modifiedAt
        //   - solve/clear/programmatic → no change
        let modifiedChanged = false;
        if (userInput) {
            record.modified = Date.now();
            modifiedChanged = true;
        } else if (undoRedo) {
            record.modified = modifiedAt ?? null;
            modifiedChanged = true;
        }
        if (modifiedChanged) {
            const modEl = document.getElementById('detail-modified');
            if (modEl) {
                const newText = formatRecordDate(record.modified);
                if (modEl.textContent !== newText) modEl.textContent = newText;
            }
        }
        debouncedSave(UI.data);

        // Update title if first comment changed
        updateRecordTitleFromContent(record);
        updateVariablesHeader(record);

        // Update variables panel (unless change originated from variables panel)
        if (!syncFromVariables) {
            if (undoRedo) variablesManager.enableFlash();
            variablesManager.updateFromText(value);
            // Restore cached highlights and status on undo/redo
            if (metadata) {
                if (metadata.errors || metadata.equationVarStatus) {
                    variablesManager.setErrors(metadata.errors, metadata.equationVarStatus);
                } else {
                    variablesManager.clearErrors();
                }
                variablesManager.setTableData(metadata.tables || null);
                if (metadata.statusMessage != null) {
                    setStatus(metadata.statusMessage, metadata.statusIsError);
                }
            }
            // Strip stale sections and clear solve state only on user keyboard input
            if (userInput) {
                variablesManager.clearErrors();
                let stripped = value;
                stripped = stripped.replace(/\n*"--- Table Outputs ---"[\s\S]*$/, '');
                stripped = stripped.replace(/\n*"--- Reference Constants and Functions ---"[\s\S]*$/, '');
                if (stripped !== value) {
                    editor.saveToHistoryNow();
                    editor.setValue(stripped, false);
                }
                variablesManager.setTableData(null);
                // Cache cleared state so redo restores it correctly
                editor.setTopMetadata({ tables: null });
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
        if (document.activeElement === editor.textarea) {
            const delta = newText.length - oldLength;
            editor.setCursorPosition(Math.max(0, cursorPos + delta));
        }
    });

    variablesManager.onSolve((undoable) => {
        handleSolve(undoable);
    });

    variablesManager.onBlur(() => {
        handleSolve(true);
    });

    // Save scroll position when user scrolls
    editor.onScrollChange((scrollTop) => {
        record.scrollTop = scrollTop;
        debouncedSave(UI.data, 500, true);
    });

    // Set up divider drag
    setupPanelResizer(divider, variablesPanel, formulasPanel);

    // Panel expand/collapse for mobile keyboard is handled by the
    // visualViewport resize handler in setupEventListeners()

    // Initial variables render
    variablesManager.updateFromText(record.text);

    // Set reference info for highlighting
    // Functions record doesn't load its own functions as references (they're definitions, not builtins)
    const { constants, functions, parsedConstants, parsedFunctions } = getReferenceInfo();
    const isFnRecord = isReferenceRecord(record, 'Functions');
    editor.setReferenceInfo(constants, isFnRecord ? null : functions, parsedConstants, isFnRecord ? null : parsedFunctions);

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
/**
 * Restore divider height for a record, clamped to current container bounds.
 * Only applies record.dividerHeight (set by user drag); auto-fits if not set.
 */
function restoreDividerHeight(recordId) {
    const editorInfo = UI.editors.get(recordId);
    const record = findRecord(UI.data, recordId);
    if (!editorInfo || !record) return;

    const variablesPanel = editorInfo.container.querySelector('.variables-panel');
    if (!variablesPanel) return;

    if (record.dividerHeight) {
        const containerHeight = editorInfo.container.offsetHeight;
        const divider = editorInfo.container.querySelector('.panel-divider');
        const formulasPanel = editorInfo.container.querySelector('.formulas-panel');
        const varHeader = variablesPanel.querySelector('.variables-header');
        const fmtHeader = formulasPanel ? formulasPanel.querySelector('.formulas-header') : null;
        const minTop = varHeader ? varHeader.offsetHeight : 0;
        const maxTop = containerHeight - (divider ? divider.offsetHeight : 0) - (fmtHeader ? fmtHeader.offsetHeight : 0);
        variablesPanel.style.height = Math.max(minTop, Math.min(maxTop, record.dividerHeight)) + 'px';
    } else {
        // Auto-fit: size to content, clamped between 1/4 and 3/4 of container
        variablesPanel.style.height = 0 + 'px';     // ensures scrollHeight reflects true content height, not the container height
        const containerHeight = editorInfo.container.offsetHeight;
        const table = variablesPanel.querySelector('.variables-table');
        const header = variablesPanel.querySelector('.variables-header');
        const headerHeight = header ? header.offsetHeight : 0;
        const contentHeight = (table ? table.scrollHeight : 0) + headerHeight;
        const minHeight = containerHeight * 0.25;
        const maxHeight = containerHeight * 0.75;
        const fitHeight = Math.max(minHeight, Math.min(maxHeight, contentHeight));
        variablesPanel.style.height = fitHeight + 'px';
        record.dividerHeight = fitHeight;
        debouncedSave(UI.data);
    }
}

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

    // Re-align variable name widths now that the container is visible
    // (offsetWidth returns 0 when container has display:none during initial creation)
    const shown = UI.editors.get(recordId);
    if (shown) shown.variablesManager.alignNameWidths();

    // Restore scroll and divider positions after showing
    restoreDividerHeight(recordId);
    const editorInfo = UI.editors.get(recordId);
    const record = findRecord(UI.data, recordId);
    if (editorInfo && record) {
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

    // Save open tabs
    UI.data.settings.openTabs = [...UI.openTabs];
    debouncedSave(UI.data);

    // Remove editor
    if (UI.editors.has(recordId)) {
        const { container } = UI.editors.get(recordId);
        container.remove();
        UI.editors.delete(recordId);
    }

    // Remove from visit history
    const histIdx = UIState.visitHistory.indexOf(recordId);
    if (histIdx !== -1) UIState.visitHistory.splice(histIdx, 1);

    // Switch to another tab if this was the current one
    if (UI.currentRecordId === recordId) {
        // Find most recently visited record that's still open
        let nextId = null;
        for (let i = UIState.visitHistory.length - 1; i >= 0; i--) {
            if (UI.openTabs.includes(UIState.visitHistory[i])) {
                nextId = UIState.visitHistory[i];
                break;
            }
        }
        if (nextId) {
            openRecord(nextId);
        } else if (UI.openTabs.length > 0) {
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

        <div class="detail-group">
            <label>Currency</label>
            <select id="detail-currency" onchange="updateRecordDetail('currencySymbol', this.value)">
                ${['$', '€', '£', '¥', '₹', '₩', '₱', '₺', '₴', '₫', '₡', '₽', '₸', '₼', '₾', '৳'].map(s => `<option value="${s}" ${(record.currencySymbol || '$') === s ? 'selected' : ''}>${s}</option>`).join('')}
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

        <div class="detail-group detail-info">
            <div><span class="detail-info-label">Created:</span> ${formatRecordDate(record.created)}</div>
            <div><span class="detail-info-label">Modified:</span> <span id="detail-modified">${formatRecordDate(record.modified)}</span></div>
        </div>

        <div class="details-actions">
            <button onclick="duplicateCurrentRecord()" class="btn-secondary">Duplicate</button>
            <button onclick="deleteCurrentRecord()" class="btn-danger">Delete</button>
        </div>
    `;
}

/**
 * Format a record's timestamp for display in details panel.
 * Returns "—" for missing timestamps (legacy records).
 */
function formatRecordDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

    // Re-tokenize when places changes (affects ° literal snapping via modClose)
    if (field === 'places') {
        const editorInfo = UI.editors.get(record.id);
        if (editorInfo) {
            editorInfo.editor.updateHighlighting();
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
function getTitleFromContent(text) {
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
        header.textContent = getTitleFromContent(record.text);
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
    const newTitle = getTitleFromContent(record.text);

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
        text: newText,
        created: Date.now(),
        modified: null
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
    clearDriveStatusFlash();
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

        <div class="detail-group">
            <label>Currency</label>
            <select onchange="updateRecordDetail('currencySymbol', this.value)">
                ${['$', '€', '£', '¥', '₹', '₩', '₱', '₺', '₴', '₫', '₡', '₽', '₸', '₼', '₾', '৳'].map(s => `<option value="${s}" ${(record.currencySymbol || '$') === s ? 'selected' : ''}>${s}</option>`).join('')}
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

    // Clamp divider and re-align variable name widths on window resize
    let kbdTimeout = null;
    window.addEventListener('resize', () => {
        // chrome needs time to settle on orientation changes
        if (kbdTimeout) clearTimeout(kbdTimeout);
        kbdTimeout = setTimeout(() => {
            kbdTimeout = null;
            restoreDividerHeight(UI.currentRecordId);
            const editorInfo = UI.editors.get(UI.currentRecordId);
            if (editorInfo) editorInfo.variablesManager.alignNameWidths();
        }, 100);
    });
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
        backfillRecordTimestamps(UI.data);
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
        // First pass always skips tables — re-solve below computes them once
        const result = solveRecord(text, context, record, parserTokens, true);
        text = result.text;

        // Re-solve formatted output: idempotency check, rounding detection, table evaluation,
        // and a second chance when the first solve filled in cleared variables with balance errors
        const verifyTokens = new Tokenizer(text).tokenize();
        const verifyContext = createEvalContext(record,
            editorInfo.editor.parsedConstants, editorInfo.editor.parsedFunctions,
            text, verifyTokens);
        verifyContext.preSolveValues = context.preSolveValues; // preserve x~ values so counters don't double-increment
        const verifyResult = solveRecord(text, verifyContext, record, verifyTokens);
        text = verifyResult.text;
        let errors = verifyResult.errors;
        let equationVarStatus = verifyResult.equationVarStatus;
        let tables = verifyResult.tables || [];

        // Enable flash before setValue so onChange's updateFromText highlights changed values
        editorInfo.variablesManager.enableFlash();

        // Update editor with results (undoable so Ctrl+Z works)
        // Pass pre-solve status so undo restores it on the entry being left behind
        const textChanged = editorInfo.editor.setValue(text, undoable, {
            statusMessage: preStatus.message,
            statusIsError: preStatus.isError
        });

        // Always persist status from solve
        if (errors.length > 0) {
            setStatus(errors.join('\n'), true);
        } else if (result.solved > 0) {
            setStatus(`Solved ${result.solved} equation${result.solved > 1 ? 's' : ''}`);
        } else {
            setStatus('Nothing to solve');
        }

        // Cache solve results on undo entry so undo/redo can restore highlights
        if (textChanged) {
            editorInfo.editor.setTopMetadata({
                errors: errors,
                equationVarStatus: equationVarStatus,
                tables: tables,
                statusMessage: UI.lastPersistentStatus.message,
                statusIsError: UI.lastPersistentStatus.isError
            });
        }

        // Restore cursor to end of same line only if textarea has focus
        if (document.activeElement === editorInfo.editor.textarea) {
            const newLines = text.split('\n');
            const targetLine = Math.min(cursorLine, newLines.length - 1);
            let newPos = 0;
            for (let i = 0; i < targetLine; i++) {
                newPos += newLines[i].length + 1; // +1 for newline
            }
            newPos += newLines[targetLine].length; // end of line
            editorInfo.editor.setCursorPosition(newPos);
            editorInfo.editor.textarea.blur();
        }
        record.text = text;
        debouncedSave(UI.data);

        // Set error/equation highlights and clear edit tracking
        editorInfo.variablesManager.setErrors(errors, equationVarStatus);
        editorInfo.variablesManager.clearLastEdited();

        // Display table results
        editorInfo.variablesManager.setTableData(tables);

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

    // Remove table outputs and references sections
    text = text.replace(/\n*"--- Table Outputs ---"[\s\S]*$/, '');
    text = text.replace(/\n*"--- Reference Constants and Functions ---"[\s\S]*$/, '');

    // Enable flash before setValue so onChange's updateFromText highlights changed values
    editorInfo.variablesManager.enableFlash();

    // Use undoable so Ctrl+Z works
    // Pass pre-clear status so undo restores it on the entry being left behind
    const textChanged = editorInfo.editor.setValue(text, true, {
        statusMessage: preStatus.message,
        statusIsError: preStatus.isError
    });

    // Always clear error highlights and table data
    editorInfo.variablesManager.clearErrors();
    editorInfo.variablesManager.clearLastEdited();
    editorInfo.variablesManager.setTableData(null);

    setStatus('Cleared');
    if (textChanged) {
        editorInfo.editor.setTopMetadata({
            statusMessage: 'Cleared',
            statusIsError: false
        });
    }

    // Restore cursor only if textarea has focus
    if (document.activeElement === editorInfo.editor.textarea) {
        const newLines = text.split('\n');
        const targetLine = Math.min(cursorLine, newLines.length - 1);
        let newPos = 0;
        for (let i = 0; i < targetLine; i++) {
            newPos += newLines[i].length + 1; // +1 for newline
        }
        newPos += newLines[targetLine].length; // end of line
        editorInfo.editor.setCursorPosition(newPos);
        editorInfo.editor.textarea.blur();
    }
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
    let startY, startHeight, maxHeight, dragging = false;

    // Prevent browser from taking over touch gestures
    divider.style.touchAction = 'none';

    divider.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        dragging = true;
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

    // Listen on document so drag continues even if pointer leaves the divider
    document.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const delta = e.clientY - startY;
        const minTop = getMinTop();
        const maxTop = maxHeight - divider.offsetHeight - getMinBottom();
        const newHeight = Math.max(minTop, Math.min(maxTop, startHeight + delta));
        topPanel.style.height = newHeight + 'px';
    });

    function endDrag() {
        if (!dragging) return;
        dragging = false;
        divider.classList.remove('dragging');
        document.body.classList.remove('panel-resizing');

        // Save divider position to current record
        const record = findRecord(UI.data, UI.currentRecordId);
        if (record) {
            record.dividerHeight = topPanel.offsetHeight;
            debouncedSave(UI.data);
        }
    }

    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
}

/**
 * Setup sidebar resizer
 */
function setupSidebarResizer() {
    const divider = document.getElementById('sidebar-divider');
    const sidebar = document.getElementById('sidebar');
    if (!divider || !sidebar) return;

    // Restore saved width
    const savedWidth = UI.data && UI.data.settings && UI.data.settings.sidebarWidth;
    if (savedWidth) {
        sidebar.style.width = savedWidth + 'px';
    }

    let startX, startWidth, dragging = false;

    divider.style.touchAction = 'none';

    divider.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        divider.classList.add('dragging');
        document.body.classList.add('sidebar-resizing');
    });

    document.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const delta = e.clientX - startX;
        const newWidth = Math.max(100, Math.min(350, startWidth + delta));
        sidebar.style.width = newWidth + 'px';
    });

    function endDrag() {
        if (!dragging) return;
        dragging = false;
        divider.classList.remove('dragging');
        document.body.classList.remove('sidebar-resizing');

        if (UI.data && UI.data.settings) {
            UI.data.settings.sidebarWidth = sidebar.offsetWidth;
            debouncedSave(UI.data);
        }
    }

    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
}

/**
 * Reload the entire UI with new data (e.g. from Drive).
 * Replaces localStorage, clears editors, re-renders everything.
 */
function reloadUIWithData(newData) {
    cancelPendingSave();
    // Suppress dirty marking — we're loading from Drive, not making local changes
    UI.initComplete = false;

    // Clear all editors
    for (const [id, { container }] of UI.editors) {
        container.remove();
    }
    UI.editors.clear();
    UI.openTabs = [];
    UI.currentRecordId = null;

    // Backfill missing timestamps with sentinel default
    backfillRecordTimestamps(newData);

    // Replace data
    UI.data = newData;
    saveData(UI.data, true);

    // Re-render UI (useSavedScroll so renderSidebar uses Drive's scroll position)
    renderSidebar(true);
    renderTabBar();
    renderDetailsPanel();

    // Restore sidebar width from new data
    const sidebar = document.getElementById('sidebar');
    const savedWidth = UI.data.settings && UI.data.settings.sidebarWidth;
    if (sidebar) {
        sidebar.style.width = savedWidth ? savedWidth + 'px' : '';
    }

    // Open the last viewed record or the first record
    const lastRecordId = UI.data.settings && UI.data.settings.lastRecordId;
    const recordToOpen = lastRecordId ? findRecord(UI.data, lastRecordId) : null;
    if (recordToOpen) {
        openRecord(recordToOpen.id);
    } else if (UI.data.records.length > 0) {
        openRecord(UI.data.records[0].id);
    }

    setTimeout(() => { UI.initComplete = true; }, 50);
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
window.restoreStatusAfterDelay = restoreStatusAfterDelay;

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        UI, initUI, renderSidebar, renderTabBar, renderDetailsPanel,
        openRecord, closeTab, setStatus, handleSolve, reloadUIWithData
    };
}
