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
    statusBar: null
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

    // Open last viewed record, or first record if not available
    if (data.records.length > 0) {
        const lastRecordId = data.settings?.lastRecordId;
        const lastRecord = lastRecordId ? findRecord(data, lastRecordId) : null;
        if (lastRecord) {
            openRecord(lastRecordId);
        } else {
            openRecord(data.records[0].id);
        }
    }

    setStatus('Ready');
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
            const isSpecial = record.title === 'Constants' || record.title === 'Functions' || record.title === 'Default Settings';
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

    // Save last viewed record
    UI.data.settings.lastRecordId = recordId;
    debouncedSave(UI.data);

    // Create editor if not exists
    if (!UI.editors.has(recordId)) {
        createEditorForRecord(record);
    }

    // Show the editor
    showEditor(recordId);

    // Restore status from record
    if (record.status) {
        UI.statusBar.textContent = record.status;
        UI.statusBar.className = 'status-bar' + (record.statusIsError ? ' error' : '');
    } else {
        UI.statusBar.textContent = 'Ready';
        UI.statusBar.className = 'status-bar';
    }

    // Update UI
    renderTabBar();
    renderSidebar();
    renderDetailsPanel();
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

    // Create formulas panel (top)
    const formulasPanel = document.createElement('div');
    formulasPanel.className = 'formulas-panel';

    // Create resize divider
    const divider = document.createElement('div');
    divider.className = 'panel-divider';

    // Create variables panel (bottom)
    const variablesPanel = document.createElement('div');
    variablesPanel.className = 'variables-panel';
    variablesPanel.innerHTML = '<div class="variables-header">Variables</div><div class="variables-table"></div>';

    container.appendChild(formulasPanel);
    container.appendChild(divider);
    container.appendChild(variablesPanel);
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

    editor.onChange((value) => {
        record.text = value;
        debouncedSave(UI.data);

        // Update title if first comment changed
        updateRecordTitleFromContent(record);

        // Update variables panel (unless change originated from there)
        if (!syncFromVariables) {
            variablesManager.updateFromText(value);
        }
        syncFromVariables = false;
    });

    variablesManager.onValueChange((varName, newValue, newText) => {
        syncFromVariables = true;
        const cursorPos = editor.getCursorPosition();
        const oldLength = editor.getValue().length;
        editor.setValue(newText, true);
        // Adjust cursor position based on text length change
        const delta = newText.length - oldLength;
        editor.setCursorPosition(Math.max(0, cursorPos + delta));
    });

    // Set up divider drag
    setupPanelResizer(divider, formulasPanel, variablesPanel);

    // Initial variables render
    variablesManager.updateFromText(record.text);

    // Restore saved panel height
    if (UI.data.settings?.variablesPanelHeight) {
        variablesPanel.style.height = UI.data.settings.variablesPanelHeight + 'px';
    }

    UI.editors.set(record.id, { editor, container, variablesManager });
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
        <div class="details-header">Record Settings</div>

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
    }
}

/**
 * Update record title from content (first line, with or without quotes)
 */
function updateRecordTitleFromContent(record) {
    // Don't auto-update title for special records
    if (record.title === 'Constants' || record.title === 'Functions' || record.title === 'Default Settings') {
        return;
    }
    const firstLine = record.text.split('\n')[0].trim();

    // Extract title: strip quotes if present, otherwise use first line
    const match = firstLine.match(/^"([^"]+)"$/);
    let newTitle = match ? match[1] : (firstLine || 'Untitled');

    // Truncate long titles
    if (newTitle.length > 30) {
        newTitle = newTitle.substring(0, 30) + '...';
    }

    if (newTitle !== record.title) {
        record.title = newTitle;
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

    const newTitle = record.title + ' (copy)';
    let newText = record.text;

    // Update the title in the text if present (quoted or unquoted)
    const lines = newText.split('\n');
    const firstLine = lines[0].trim();
    const titleMatch = firstLine.match(/^"([^"]+)"$/);
    if (titleMatch && titleMatch[1] === record.title) {
        // Quoted title - update with quotes
        lines[0] = `"${newTitle}"`;
        newText = lines.join('\n');
    } else if (firstLine === record.title) {
        // Unquoted title - update without quotes
        lines[0] = newTitle;
        newText = lines.join('\n');
    }

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
    UI.statusBar.textContent = message;
    UI.statusBar.className = 'status-bar' + (isError ? ' error' : '');

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
    ).join('');

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
            <input type="number" min="0" max="15" value="${record.places ?? 2}"
                   onchange="updateRecordDetail('places', parseInt(this.value))">
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
    `;
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Import button
    document.getElementById('btn-import')?.addEventListener('click', handleImport);

    // Export button
    document.getElementById('btn-export')?.addEventListener('click', handleExport);

    // Reset button
    document.getElementById('btn-reset')?.addEventListener('click', handleReset);

    // Solve button
    document.getElementById('btn-solve')?.addEventListener('click', handleSolve);

    // Clear Input button
    document.getElementById('btn-clear')?.addEventListener('click', handleClearInput);

    // File input for import
    document.getElementById('file-input')?.addEventListener('change', handleFileSelect);

    // Mobile: Hamburger button
    document.getElementById('hamburger-btn')?.addEventListener('click', toggleSidebar);

    // Mobile: Sidebar overlay click to close
    document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebar);

    // Mobile: Settings button
    document.getElementById('settings-btn')?.addEventListener('click', toggleSettings);

    // Mobile: Settings modal close button
    document.getElementById('settings-modal-close')?.addEventListener('click', toggleSettings);

    // Mobile: Settings modal overlay click to close
    document.getElementById('settings-modal')?.addEventListener('click', (e) => {
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
        // Ctrl/Cmd + S to save (prevent default, auto-saved)
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            setStatus('All changes auto-saved');
        }
        // Escape to close modals/sidebar
        if (e.key === 'Escape') {
            const settingsModal = document.getElementById('settings-modal');
            if (settingsModal?.classList.contains('visible')) {
                toggleSettings();
            }
            const sidebar = document.querySelector('.sidebar');
            if (sidebar?.classList.contains('open')) {
                closeSidebar();
            }
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
        const selectedId = UI.data.settings?.lastRecordId;
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

        setStatus(`Imported from ${file.name}`, false, false);
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

        // Remember cursor line position
        const cursorPos = editorInfo.editor.getCursorPosition();
        const textBeforeCursor = text.substring(0, cursorPos);
        const cursorLine = textBeforeCursor.split('\n').length - 1;

        // Clear output variables first so they become unknowns
        text = clearVariables(text, 'output');

        // Create evaluation context with constants and user functions
        const context = createEvalContext(UI.data.records, record, text);

        // Solve the record
        const result = solveRecord(text, context, record);
        text = result.text;

        // Update editor with results (undoable so Ctrl+Z works)
        editorInfo.editor.setValue(text, true);

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

        // Update variables panel
        if (editorInfo.variablesManager) {
            editorInfo.variablesManager.updateFromText(text);
        }

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

    // Remember cursor line position
    const cursorPos = editorInfo.editor.getCursorPosition();
    const textBeforeCursor = text.substring(0, cursorPos);
    const cursorLine = textBeforeCursor.split('\n').length - 1;

    text = clearVariables(text, 'input');
    text = clearVariables(text, 'output');

    // Remove references section
    text = text.replace(/\n*"--- Reference Constants and Functions ---"[\s\S]*$/, '');

    // Use undoable so Ctrl+Z works
    editorInfo.editor.setValue(text, true);

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

    // Update variables panel
    if (editorInfo.variablesManager) {
        editorInfo.variablesManager.updateFromText(text);
    }

    setStatus('Cleared');
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
    let startY, startHeight;

    function onMouseDown(e) {
        startY = e.clientY;
        startHeight = bottomPanel.offsetHeight;
        divider.classList.add('dragging');
        document.body.classList.add('panel-resizing');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
    }

    function onMouseMove(e) {
        const delta = startY - e.clientY;
        const newHeight = Math.max(80, Math.min(
            bottomPanel.parentElement.offsetHeight * 0.6,
            startHeight + delta
        ));
        bottomPanel.style.height = newHeight + 'px';
    }

    function onMouseUp() {
        divider.classList.remove('dragging');
        document.body.classList.remove('panel-resizing');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        // Save preference
        if (UI.data.settings) {
            UI.data.settings.variablesPanelHeight = bottomPanel.offsetHeight;
            debouncedSave(UI.data);
        }
    }

    divider.addEventListener('mousedown', onMouseDown);

    // Touch support for mobile
    divider.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            onMouseDown({ clientY: touch.clientY, preventDefault: () => {} });
        }
    });

    document.addEventListener('touchmove', (e) => {
        if (divider.classList.contains('dragging') && e.touches.length === 1) {
            const touch = e.touches[0];
            onMouseMove({ clientY: touch.clientY });
        }
    });

    document.addEventListener('touchend', () => {
        if (divider.classList.contains('dragging')) {
            onMouseUp();
        }
    });
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

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        UI, initUI, renderSidebar, renderTabBar, renderDetailsPanel,
        openRecord, closeTab, setStatus, handleSolve
    };
}
