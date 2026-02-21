/**
 * MathPad Web Application - Main Entry Point
 *
 * This file initializes the application and ties all modules together.
 */

/**
 * Application initialization
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log('MathPad Web Application starting...');

    // Phase 1: Load from localStorage, render UI (instant)
    const data = loadData();
    console.log(`Loaded ${data.records.length} records`);
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

    console.log('MathPad ready');
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
    // Flush any pending saves
    if (typeof UI !== 'undefined' && UI.data) {
        saveData(UI.data);
    }
    // Flush Drive sync if dirty
    if (typeof flushDriveSync === 'function') {
        flushDriveSync();
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
    const helpText = `
MathPad Web - Quick Reference

VARIABLE DECLARATIONS:
  varname: value      Standard variable
  varname<- value     Input variable (cleared on load)
  varname-> value     Output variable (cleared on solve)
  varname:: value     Full precision output
  varname->> value    Full precision output variable
  varname[lo:hi]: val Variable with search limits

EQUATIONS:
  expression = expression
  {multi-line equation}

OPERATORS (by precedence):
  || ^^          Logical OR, XOR
  &&             Logical AND
  == != < <= > >= Comparison
  | ^            Bitwise OR, XOR
  &              Bitwise AND
  << >>          Shift
  + -            Add, Subtract
  * /            Multiply, Divide
  **             Power (right-associative)
  - + ~ !        Unary minus, plus, NOT, logical NOT

BUILT-IN FUNCTIONS:
  Math: Abs, Sign, Int, Frac, Round, Floor, Ceil, Mod
        Sqrt, Cbrt, Root, Exp, Ln, Log, Fact, Pi
  Trig: Sin, ASin, SinH, ASinH, Cos, ACos, CosH, ACosH
        Tan, ATan, TanH, ATanH, Radians, Degrees
  Date: Now, Days, JDays, Date, JDate, Year, Month, Day
        Weekday, Hour, Minute, Second, Hours, HMS
  Control: If(cond;then;else), Choose(n;v1;v2;...)
  Other: Min, Max, Avg, Sum, Rand

SPECIAL RECORDS:
  "Constants" - Variables available in all records
  "Functions" - User-defined functions: f(x;y) = expr

INLINE EVALUATION:
  \\expression\\  - Evaluates and replaces with result

KEYBOARD SHORTCUTS:
  Ctrl+Enter    Solve current record
  Ctrl+S        (Auto-saved)

NUMBERS:
  123, 3.14, 1.5e-10    Decimal
  0xFF, 0b1010, 0o77    Hex, Binary, Octal

COMMENTS:
  "Text in double quotes"
`;

    alert(helpText);
}

// Export to global scope
window.showAbout = showAbout;
window.showHelp = showHelp;
window.APP_INFO = APP_INFO;
