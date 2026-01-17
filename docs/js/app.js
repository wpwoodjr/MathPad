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

    // Load data from localStorage
    const data = loadData();
    console.log(`Loaded ${data.records.length} records`);

    // Initialize the UI
    initUI(data);

    // Set up degrees mode toggle
    const degreesToggle = document.getElementById('toggle-degrees');
    if (degreesToggle) {
        degreesToggle.checked = data.settings.degreesMode;
    }

    console.log('MathPad ready');
});

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
    // Auto-save is enabled, so we don't need to warn
    // But we'll flush any pending saves
    if (typeof UI !== 'undefined' && UI.data) {
        saveData(UI.data);
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
  * / %          Multiply, Divide, Modulo
  **             Power (right-associative)
  - + ~ !        Unary minus, plus, NOT, logical NOT

BUILT-IN FUNCTIONS:
  Math: Abs, Sign, Int, Frac, Round, Floor, Ceil
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
