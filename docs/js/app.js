/**
 * MathPad Web Application - Main Entry Point
 *
 * This file initializes the application and ties all modules together.
 */

/**
 * Application initialization
 */
document.addEventListener('DOMContentLoaded', () => {
    // Phase 1: Load from localStorage, render UI (instant)
    const data = loadData();
    initUI(data);

    // Phase 2: Async Drive init (non-blocking)
    if (typeof initDriveModule === 'function') {
        initDriveModule().then(async (ready) => {
            if (!ready) return;
            showDriveControls();
            setupDriveListeners();

            // Show avatar immediately if user was previously signed in.
            // Don't try to get a token here — browsers block popups
            // not triggered by user clicks. Token is obtained on first
            // user interaction (clicking avatar or Sign In button).
            updateDriveUI();

            if (isDriveSignedIn()) {
                startDriveSync();
            }
        });
    }

    // Global undo/redo handler - works unless focus is in a vars panel input
    document.addEventListener('keydown', (e) => {
        // Check for Ctrl+Z (undo) or Ctrl+Y/Ctrl+Shift+Z (redo)
        const isUndo = (e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey;
        const isRedo = (e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey) || (e.key === 'Z' && e.shiftKey));

        if (!isUndo && !isRedo) return;

        // Let vars panel inputs use native undo
        const active = document.activeElement;
        if (active && active.closest('.variables-panel') && active.tagName === 'INPUT') {
            return;
        }

        // Route to current editor
        const editorInfo = UI.editors.get(UI.currentRecordId);
        if (editorInfo) {
            e.preventDefault();
            if (isUndo) {
                editorInfo.editor.undo();
            } else {
                editorInfo.editor.redo();
            }
        }
    });

    // Close Drive dropdown on outside click or Escape
    document.addEventListener('click', (e) => {
        if (typeof closeDriveDropdown === 'function') {
            const dropdown = document.getElementById('drive-dropdown');
            const avatarBtn = document.getElementById('btn-drive-menu');
            if (dropdown && dropdown.classList.contains('visible') &&
                !dropdown.contains(e.target) && e.target !== avatarBtn) {
                closeDriveDropdown();
            }
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && typeof closeDriveDropdown === 'function') {
            closeDriveDropdown();
        }
    });

});

/**
 * Set up event listeners for Drive controls
 */
function setupDriveListeners() {
    const signInBtn = document.getElementById('btn-drive-signin');
    if (signInBtn) {
        signInBtn.addEventListener('click', async () => {
            const ok = await driveSignIn();
            if (ok) {
                updateDriveUI();
                await runSyncCycle();
                startDriveSync();
                updateDriveStatus();
            }
        });
    }

    const avatarBtn = document.getElementById('btn-drive-menu');
    if (avatarBtn) {
        avatarBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!isDriveAuthenticated()) {
                const ok = await driveSignIn();
                if (ok) {
                    updateDriveUI();
                    await runSyncCycle();
                    startDriveSync();
                    updateDriveStatus();
                }
            }
            toggleDriveDropdown();
        });
    }

    const openBtn = document.getElementById('btn-drive-open');
    if (openBtn) {
        openBtn.addEventListener('click', () => {
            closeDriveDropdown();
            handleDriveOpen();
        });
    }

    const saveAsBtn = document.getElementById('btn-drive-saveas');
    if (saveAsBtn) {
        saveAsBtn.addEventListener('click', () => {
            closeDriveDropdown();
            handleDriveSaveAs();
        });
    }

    const signOutBtn = document.getElementById('btn-drive-signout');
    if (signOutBtn) {
        signOutBtn.addEventListener('click', () => {
            handleDriveSignOut();
        });
    }
}


/**
 * Global error handler
 */
window.onerror = function(message, source, lineno, colno, error) {
    console.error('Global error:', message, source, lineno, colno, error);
    if (typeof setStatus === 'function') {
        setStatus('Error: ' + message, true);
    }
    return false;
};

/**
 * Handle unhandled promise rejections
 */
window.onunhandledrejection = function(event) {
    console.error('Unhandled promise rejection:', event.reason);
    if (typeof setStatus === 'function') {
        setStatus('Error: ' + event.reason, true);
    }
};

/**
 * Warn before leaving with unsaved changes
 * (Not strictly necessary since we auto-save, but good UX)
 */
window.addEventListener('beforeunload', (e) => {
    // Flush any pending debounced save (debouncedSave sets driveDirty immediately)
    if (typeof UI !== 'undefined' && UI.data && DriveState.driveDirty) {
        saveData(UI.data, true);
    }
});

/**
 * Application info
 */
const APP_INFO = {
    name: 'MathPad Web',
    version: '1.0.0',
    description: 'Algebraic equation solver based on MathPad for PalmOS',
    author: 'Based on original MathPad by Rick Huebner'
};

/**
 * Show about dialog
 */
function showAbout() {
    alert(`${APP_INFO.name} v${APP_INFO.version}\n\n${APP_INFO.description}\n\n${APP_INFO.author}`);
}

/**
 * Show help
 */
function showHelp() {
    window.open('help.html', '_blank');
}

// Export to global scope
window.showAbout = showAbout;
window.showHelp = showHelp;
window.APP_INFO = APP_INFO;
