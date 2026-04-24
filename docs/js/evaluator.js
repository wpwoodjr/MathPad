/**
 * MathPad Evaluator - Expression evaluation with all built-in functions
 */

/**
 * Evaluation context - holds variables and settings
 */
class EvalContext {
    constructor() {
        this.variables = new Map();
        this.constants = new Map();
        this.constantComments = new Map(); // Store comments for constants
        this.shadowedConstants = new Set(); // Constants shadowed by local declarations
        this.declaredVariables = new Set(); // Variables declared (may or may not have value)
        this.userFunctions = new Map();
        this.degreesMode = false; // false = radians, true = degrees
        this.usedConstants = new Set();
        this.usedFunctions = new Set();
        this.preSolveValues = null; // Map of variable name → {value, isOutput} before solve started
        this.places = 4; // Decimal places for tolerance calculations
    }

    setVariable(name, value) {
        this.variables.set(name, value);
        this.declaredVariables.add(name);
    }

    declareVariable(name) {
        this.declaredVariables.add(name);
    }

    isDeclared(name) {
        return this.declaredVariables.has(name);
    }

    getVariable(name) {
        if (this.variables.has(name)) {
            return this.variables.get(name);
        }
        // Return constant value only if not shadowed
        if (this.constants.has(name) && !this.shadowedConstants.has(name)) {
            this.usedConstants.add(name); // Track constant usage
            return this.constants.get(name);
        }
        return undefined;
    }

    /** Return the pre-solve value of a variable (value before this solve started) */
    getPreSolveValue(name) {
        return this.preSolveValues.get(name);
    }

    hasVariable(name) {
        // Shadowed constants don't count as "having" a variable
        if (this.shadowedConstants.has(name)) {
            return this.variables.has(name);
        }
        return this.variables.has(name) || this.constants.has(name);
    }

    shadowConstant(name) {
        if (this.constants.has(name)) {
            this.shadowedConstants.add(name);
        }
    }

    setConstant(name, value, comment = null) {
        this.constants.set(name, value);
        if (comment) {
            this.constantComments.set(name, comment);
        }
    }

    setUserFunction(name, params, body, sourceText = null) {
        this.userFunctions.set(name.toLowerCase(), { params, body, sourceText });
    }

    getUserFunction(name) {
        const func = this.userFunctions.get(name.toLowerCase());
        if (func) {
            this.usedFunctions.add(name.toLowerCase()); // Track function usage
        }
        return func;
    }

    getUsedConstants() {
        return this.usedConstants;
    }

    getUsedFunctions() {
        return this.usedFunctions;
    }

    clearUsageTracking() {
        this.usedConstants.clear();
        this.usedFunctions.clear();
    }

    clone() {
        const ctx = new EvalContext();
        ctx.variables = new Map(this.variables);
        ctx.constants = this.constants;
        ctx.constantComments = this.constantComments;
        ctx.shadowedConstants = this.shadowedConstants; // Share shadowing with parent
        ctx.declaredVariables = this.declaredVariables; // Share declared vars with parent
        ctx.userFunctions = this.userFunctions;
        ctx.degreesMode = this.degreesMode;
        ctx.usedConstants = this.usedConstants; // Share tracking with parent
        ctx.usedFunctions = this.usedFunctions;
        ctx.preSolveValues = this.preSolveValues; // Share pre-solve values
        return ctx;
    }

    /**
     * Create a context for user function evaluation.
     * Functions can only access constants, built-in functions, and other user functions.
     * They cannot access variables from the calling environment.
     */
    cloneForFunction() {
        const ctx = new EvalContext();
        // No variables - only function parameters will be added
        ctx.constants = this.constants;
        ctx.constantComments = this.constantComments;
        // No shadowing in function context - constants are always visible
        ctx.userFunctions = this.userFunctions;
        ctx.degreesMode = this.degreesMode;
        ctx.usedConstants = this.usedConstants; // Share tracking with parent
        ctx.usedFunctions = this.usedFunctions;
        return ctx;
    }
}

/**
 * Evaluation error
 */
class EvalError extends Error {
    constructor(message) {
        super(message);
        this.name = 'EvalError';
    }
}

/**
 * Convert angle based on mode
 */
function toRadians(angle, degreesMode) {
    return degreesMode ? angle * Math.PI / 180 : angle;
}

function fromRadians(angle, degreesMode) {
    return degreesMode ? angle * 180 / Math.PI : angle;
}

/**
 * Factorial function
 */
function factorial(n) {
    if (n < 0) return NaN;
    if (n === 0 || n === 1) return 1;
    if (n > 170) return Infinity; // Overflow
    if (!Number.isInteger(n)) {
        // Use gamma function for non-integers
        return gamma(n + 1);
    }
    let result = 1;
    for (let i = 2; i <= n; i++) {
        result *= i;
    }
    return result;
}

/**
 * Gamma function approximation (Lanczos)
 */
function gamma(z) {
    if (z < 0.5) {
        return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    }
    z -= 1;
    const g = 7;
    const c = [
        0.99999999999980993,
        676.5203681218851,
        -1259.1392167224028,
        771.32342877765313,
        -176.61502916214059,
        12.507343278686905,
        -0.13857109526572012,
        9.9843695780195716e-6,
        1.5056327351493116e-7
    ];
    let x = c[0];
    for (let i = 1; i < g + 2; i++) {
        x += c[i] / (z + i);
    }
    const t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

/**
 * Detect locale date field order by formatting a known date.
 * Returns 'mdy', 'dmy', or 'ymd' and the separator character.
 */
const _dateLocale = (() => {
    try {
        // Format Jan 2, 2003 — all fields distinct so we can detect order
        const parts = new Intl.DateTimeFormat(undefined, {
            month: '2-digit', day: '2-digit', year: 'numeric'
        }).formatToParts(new Date(2003, 0, 2));
        const order = parts.filter(p => p.type !== 'literal').map(p => p.type[0]); // ['m','d','y'] etc
        const sep = (parts.find(p => p.type === 'literal') || { value: '-' }).value;
        return { order: order.join(''), sep };
    } catch (e) {
        return { order: 'mdy', sep: '/' };
    }
})();

/**
 * Parse date text to epoch seconds, using locale-detected field order.
 * Accepts any separator between date fields (-, /, .).
 * Optional time: HH:MM[:SS[.mmm]]
 * Returns null if text doesn't match.
 */
function parseDateText(text) {
    // Try 3-part date (M/D/Y or locale equivalent)
    let m = text.trim().match(/^(\d{1,4})[\/\-.](\d{1,4})[\/\-.](\d{1,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?$/);
    // Try 2-part date (M/D — use current year)
    if (!m) {
        m = text.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?$/);
        if (m) {
            // Insert current year as third group, shift time groups
            const yr = String(new Date().getFullYear());
            m = [m[0], m[1], m[2], yr, m[3], m[4], m[5]];
        }
    }
    if (!m) return null;
    let month, day, year;
    if (_dateLocale.order === 'dmy') {
        day = parseInt(m[1]); month = parseInt(m[2]); year = parseInt(m[3]);
    } else if (_dateLocale.order === 'ymd') {
        year = parseInt(m[1]); month = parseInt(m[2]); day = parseInt(m[3]);
    } else { // mdy
        month = parseInt(m[1]); day = parseInt(m[2]); year = parseInt(m[3]);
    }
    // 2-digit year: assume current century
    if (year < 100) year += Math.floor(new Date().getFullYear() / 100) * 100;
    const hour = m[4] ? parseInt(m[4]) : 0;
    const minute = m[5] ? parseInt(m[5]) : 0;
    const second = m[6] ? parseFloat(m[6]) : 0;
    const wholeSec = Math.floor(second);
    const ms = Math.round((second - wholeSec) * 1000);
    return new Date(year, month - 1, day, hour, minute, wholeSec, ms).getTime() / 1000;
}

/**
 * Parse duration text to seconds. Accepts:
 *   H:MM:SS[.mmm], H:MM, or plain number (hours)
 * Returns null if text doesn't match.
 */
function parseDurationText(text) {
    const t = text.trim();
    // H:MM:SS[.mmm]
    const m3 = t.match(/^(-?)(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
    if (m3) {
        const sign = m3[1] === '-' ? -1 : 1;
        return sign * (parseInt(m3[2]) * 3600 + parseInt(m3[3]) * 60 + parseFloat(m3[4]));
    }
    // H:MM
    const m2 = t.match(/^(-?)(\d+):(\d{2})$/);
    if (m2) {
        const sign = m2[1] === '-' ? -1 : 1;
        return sign * (parseInt(m2[2]) * 3600 + parseInt(m2[3]) * 60);
    }
    // Plain number (hours)
    const num = Number(t);
    if (!isNaN(num) && t !== '') return num * 3600;
    return null;
}

/**
 * Format epoch seconds as a locale-formatted date, with optional time.
 * includeTime: true = always show HH:MM:SS, false = date only
 */
function formatDateValue(epochSeconds, includeTime) {
    const d = new Date(epochSeconds * 1000);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    const sep = _dateLocale.sep;
    let result;
    if (_dateLocale.order === 'dmy') {
        result = `${dd}${sep}${mm}${sep}${yyyy}`;
    } else if (_dateLocale.order === 'ymd') {
        result = `${yyyy}${sep}${mm}${sep}${dd}`;
    } else {
        result = `${mm}${sep}${dd}${sep}${yyyy}`;
    }
    if (includeTime) {
        const hh = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        result += ` ${hh}:${min}:${ss}`;
    }
    return result;
}

/**
 * Format seconds as duration: H:MM:SS or H:MM:SS.mmm
 * fractional: true = show milliseconds if present
 */
function formatDuration(seconds, fractional) {
    const neg = seconds < 0;
    let total = Math.abs(seconds);
    // Without fractional output, round to the nearest whole second up front so
    // values like 46.623 display as :47 (not :46). Rounding here also lets a
    // 59.5→60 carry propagate naturally into minutes (and 3599.5→3600 into hours).
    if (!fractional) total = Math.round(total);
    const h = Math.floor(total / 3600);
    total -= h * 3600;
    const m = Math.floor(total / 60);
    total -= m * 60;
    const s = Math.floor(total);
    const ms = Math.round((total - s) * 1000);
    let result = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    if (fractional && ms) {
        result += `.${String(ms).padStart(3, '0')}`;
    }
    return neg ? '-' + result : result;
}

/**
 * Built-in functions
 */
/**
 * Check if two values are equal within tolerance.
 * Uses relative tolerance normally, absolute tolerance when comparing against zero.
 */
function checkBalance(a, b, places) {
    const tolPlaces = Math.max(3, places + 1);
    const balanceTolerance = 5 * Math.pow(10, -tolPlaces);
    // Exact equality short-circuit. Handles Infinity === Infinity (where the
    // diff arithmetic would otherwise produce NaN and incorrectly report "doesn't
    // balance"). NaN === NaN is false in JS so NaN values still fall through to
    // the arithmetic-based check, which correctly reports them as unbalanced.
    if (a === b) {
        return { balanced: true, relative: false, difference: 0, tolerance: balanceTolerance, tolPlaces };
    }
    const diff = Math.abs(a - b);
    if (a === 0 || b === 0) {
        // No fixed cap: the absolute branch fires whenever one side is exactly
        // zero (e.g. `f(x) = 0` after Brent's solves). Brent's-grade residuals
        // for steep functions can exceed any small fixed cap, so we let the
        // user's `places` control sensitivity via balanceTolerance.
        // Catastrophic mismatches (NaN, large diffs) still fail any tolerance.
        return { balanced: diff < balanceTolerance, relative: false, difference: diff, tolerance: balanceTolerance, tolPlaces };
    } else {
        const maxVal = Math.max(Math.abs(a), Math.abs(b));
        const relDiff = diff / maxVal;
        return { balanced: relDiff < balanceTolerance, relative: true, difference: relDiff, tolerance: balanceTolerance, tolPlaces };
    }
}

/**
 * Normalize two values modulo n for comparison.
 * Minimizes distance between values, then maps the higher to n
 * for consistent tolerance. Returns [aNorm, bNorm].
 */
function modNormalize(a, b, n) {
    // Reduce to [0, n)
    a = a - n * Math.floor(a / n);
    b = b - n * Math.floor(b / n);
    // Minimize distance
    if (a - b > n / 2) b += n;
    else if (b - a > n / 2) a += n;
    // Map higher value to n for consistent tolerance
    const shift = n - Math.max(a, b);
    return [a + shift, b + shift];
}

/**
 * Mod-aware balance check: compares a and b modulo n.
 * Handles wrap-around at the mod boundary (e.g., 359.99 vs 0.01 mod 360).
 */
function modCheckBalance(a, b, n, places) {
    return checkBalance(...modNormalize(a, b, n), places);
}

// Argument count constraints for built-in functions: [min, max]
// [min, max] or [min] for variable-arg functions; sum/prod validated separately
const builtinArgCounts = {
    abs: [1, 1], sign: [1, 1], int: [1, 1], frac: [1, 1],
    round: [1, 2], floor: [1, 1], ceil: [1, 1],
    sqrt: [1, 1], cbrt: [1, 1], root: [2, 2],
    exp: [1, 1], ln: [1, 1], log: [1, 2], fact: [1, 1],
    pi: [0, 0], tau: [0, 0], perigon: [0, 0],
    sin: [1, 1], asin: [1, 1], sinh: [1, 1], asinh: [1, 1],
    cos: [1, 1], acos: [1, 1], cosh: [1, 1], acosh: [1, 1],
    tan: [1, 1], atan: [1, 2], tanh: [1, 1], atanh: [1, 1],
    radians: [1, 1], degrees: [1, 1],
    now: [0, 0], days: [2, 2], date: [3, 6],
    year: [1, 1], month: [1, 1], day: [1, 1], weekday: [1, 1],
    hour: [1, 1], minute: [1, 1], second: [1, 1],
    hours: [1, 1], timepart: [1, 1],
    if: [2, 3], rand: [0, 2], mod: [2, 2],
    isclose: [3, 3], modisclose: [4, 4], places: [0, 0],
    min: [1], max: [1], avg: [1], choose: [2],
};

function validateArgCount(funcName, argCount) {
    const counts = builtinArgCounts[funcName];
    if (!counts) return;
    const [min, max] = counts;
    if (argCount < min) {
        if (max !== undefined && min === max) {
            throw new EvalError(`${funcName}() requires ${min} argument${min !== 1 ? 's' : ''}, got ${argCount}`);
        }
        throw new EvalError(`${funcName}() requires at least ${min} argument${min !== 1 ? 's' : ''}, got ${argCount}`);
    }
    if (max !== undefined && argCount > max) {
        if (min === max) {
            throw new EvalError(`${funcName}() requires ${min} argument${min !== 1 ? 's' : ''}, got ${argCount}`);
        }
        throw new EvalError(`${funcName}() requires at most ${max} argument${max !== 1 ? 's' : ''}, got ${argCount}`);
    }
}

const builtinFunctions = {
    // Math functions
    abs: (args) => Math.abs(args[0]),
    sign: (args) => Math.sign(args[0]),
    int: (args) => Math.trunc(args[0]),
    frac: (args) => args[0] - Math.trunc(args[0]),
    round: (args) => {
        // Round half away from zero (symmetric for positive/negative)
        // Uses string-based exponential shift to avoid IEEE 754 midpoint errors
        // (same approach as toFixed: Number('0.075e2') → 7.5 exact)
        const x = args[0];
        const places = args.length > 1 ? args[1] : 0;
        const shifted = Number(x + 'e' + places);
        const rounded = Math.sign(shifted) * Math.round(Math.abs(shifted));
        return Number(rounded + 'e-' + places);
    },
    floor: (args) => Math.floor(args[0]),
    ceil: (args) => Math.ceil(args[0]),
    sqrt: (args) => Math.sqrt(args[0]),
    cbrt: (args) => Math.cbrt(args[0]),
    root: (args) => Math.pow(args[0], 1 / args[1]),
    exp: (args) => Math.exp(args[0]),
    ln: (args) => Math.log(args[0]),
    log: (args) => {
        if (args.length === 1) return Math.log10(args[0]);
        return Math.log(args[0]) / Math.log(args[1]);
    },
    fact: (args) => factorial(args[0]),
    pi: (args) => Math.PI,

    // Trig functions (context-aware for degrees/radians)
    sin: (args, ctx) => Math.sin(toRadians(args[0], ctx.degreesMode)),
    asin: (args, ctx) => fromRadians(Math.asin(args[0]), ctx.degreesMode),
    sinh: (args) => Math.sinh(args[0]),
    asinh: (args) => Math.asinh(args[0]),

    cos: (args, ctx) => Math.cos(toRadians(args[0], ctx.degreesMode)),
    acos: (args, ctx) => fromRadians(Math.acos(args[0]), ctx.degreesMode),
    cosh: (args) => Math.cosh(args[0]),
    acosh: (args) => Math.acosh(args[0]),

    tan: (args, ctx) => Math.tan(toRadians(args[0], ctx.degreesMode)),
    atan: (args, ctx) => {
        if (args.length === 2) {
            // atan2 variant
            return fromRadians(Math.atan2(args[0], args[1]), ctx.degreesMode);
        }
        return fromRadians(Math.atan(args[0]), ctx.degreesMode);
    },
    tanh: (args) => Math.tanh(args[0]),
    atanh: (args) => Math.atanh(args[0]),

    // Conversion
    radians: (args) => args[0] * Math.PI / 180,
    degrees: (args) => args[0] * 180 / Math.PI,

    // Date/Time functions — all dates are epoch seconds
    now: (args) => Date.now() / 1000,

    date: (args) => {
        // Date(year, month, day [, hour, minute, second]) → epoch seconds
        const year = args[0], month = args[1], day = args[2];
        const hour = args.length > 3 ? args[3] : 0;
        const minute = args.length > 4 ? args[4] : 0;
        const second = args.length > 5 ? args[5] : 0;
        return new Date(year, month - 1, day, hour, minute, second).getTime() / 1000;
    },

    days: (args) => (args[1] - args[0]) / 86400,

    year: (args) => new Date(args[0] * 1000).getFullYear(),
    month: (args) => new Date(args[0] * 1000).getMonth() + 1,
    day: (args) => new Date(args[0] * 1000).getDate(),

    weekday: (args) => {
        const d = new Date(args[0] * 1000);
        return d.getDay() + 1; // 1=Sunday, 7=Saturday
    },

    hour: (args) => new Date(args[0] * 1000).getHours(),
    minute: (args) => new Date(args[0] * 1000).getMinutes(),
    second: (args) => new Date(args[0] * 1000).getSeconds(),

    hours: (args) => {
        // Decimal hours from epoch seconds
        const d = new Date(args[0] * 1000);
        return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    },

    timepart: (args) => {
        // Seconds since midnight (local time) for a given epoch seconds value
        const d = new Date(args[0] * 1000);
        return args[0] - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000;
    },

    // Control functions
    if: (args) => args[0] ? args[1] : (args.length > 2 ? args[2] : 0),

    choose: (args) => {
        const index = Math.floor(args[0]);
        if (index < 1 || index >= args.length) {
            return 0;
        }
        return args[index];
    },

    // Additional useful functions
    min: (args) => Math.min(...args),
    max: (args) => Math.max(...args),
    avg: (args) => args.reduce((a, b) => a + b, 0) / args.length,
    sum: (args) => args.reduce((a, b) => a + b, 0),

    // Random
    rand: (args) => {
        if (args.length === 0) return Math.random();
        if (args.length === 1) return Math.random() * args[0];
        return args[0] + Math.random() * (args[1] - args[0]);
    },

    // Modulo (true modulo, always non-negative for positive divisor)
    // Snap to 0 when result is within FP noise of the divisor (e.g., mod(359.9999999999999, 360) → 0)
    mod: (args) => {
        const result = args[0] - args[1] * Math.floor(args[0] / args[1]);
        return (Math.abs(result - Math.abs(args[1])) < 256 * Number.EPSILON * Math.abs(args[1])) ? 0 : result;
    },

    // Balance check: isClose(a; b; places) returns 1 if equal within tolerance, 0 otherwise
    isclose: (args) => checkBalance(args[0], args[1], args[2]).balanced ? 1 : 0,

    // Mod-aware balance check: modIsClose(a; b; n; places) returns 1 if equal mod n within tolerance
    modisclose: (args) => modCheckBalance(args[0], args[1], args[2], args[3]).balanced ? 1 : 0,

    // Current decimal places setting
    places: (args, context) => context.places,

    // τ = 2π
    tau: (args) => 2 * Math.PI,

    // Perigon (full rotation): 360 in degrees mode, 2π in radians mode
    perigon: (args, context) => context.degreesMode ? 360 : 2 * Math.PI,

    // Reserved keywords — not callable, but included so they can't be overridden as function defs
    table: null,
    grid: null,
    tablegraph: null,
    gridgraph: null,
    vectordraw: null
};

/**
 * Evaluate an AST node
 */
function evaluate(node, context) {
    if (node === null) return 0;

    switch (node.type) {
        case 'NUMBER':
            return node.value;

        case 'VARIABLE': {
            const value = context.getVariable(node.name);
            if (value !== undefined) {
                return value;
            }
            // Check if declared but no value vs truly undefined
            if (context.isDeclared(node.name)) {
                throw new EvalError(`Variable '${node.name}' has no value`);
            }
            throw new EvalError(`Undefined variable: ${node.name}`);
        }

        case 'UNARY_OP': {
            const operand = evaluate(node.operand, context);
            switch (node.op) {
                case '-': return -operand;
                case '+': return +operand;
                case '~': return ~Math.trunc(operand);
                case '!': return operand ? 0 : 1;
                default:
                    throw new EvalError(`Unknown unary operator: ${node.op}`);
            }
        }

        case 'POSTFIX_OP': {
            if (node.op === '~') {
                // x~ — get pre-solve value (value before this solve started)
                if (node.operand.type !== 'VARIABLE') {
                    throw new EvalError('~ operator can only be applied to variables');
                }
                const name = node.operand.name;
                // Unshadowed constants always have a pre-solve value
                if (context.constants.has(name) && !context.shadowedConstants.has(name)) {
                    return context.constants.get(name);
                }
                if (!context.isDeclared(name)) {
                    throw new EvalError(`Undefined variable: ${name}`);
                }
                const value = context.getPreSolveValue(name);
                if (value !== undefined) {
                    return value;
                }
                throw new EvalError(`Variable '${name}' has no pre-solve value`);
            }
            if (node.op === '?') {
                // x~? — does variable have a pre-solve value?
                if (node.operand.type !== 'POSTFIX_OP' || node.operand.op !== '~') {
                    throw new EvalError('? operator requires ~ (use x~? to check for pre-solve value)');
                }
                const varNode = node.operand.operand;
                if (varNode.type !== 'VARIABLE') {
                    throw new EvalError('~? operator can only be applied to variables');
                }
                const varName = varNode.name;
                // Unshadowed constants always have a pre-solve value
                if (context.constants.has(varName) && !context.shadowedConstants.has(varName)) {
                    return 1;
                }
                if (!context.isDeclared(varName)) {
                    throw new EvalError(`Undefined variable: ${varName}`);
                }
                return context.preSolveValues.has(varName) ? 1 : 0;
            }
            throw new EvalError(`Unknown postfix operator: ${node.op}`);
        }

        case 'BINARY_OP': {
            // Short-circuit evaluation for logical operators
            if (node.op === '&&') {
                const left = evaluate(node.left, context);
                if (!left) return 0;
                return evaluate(node.right, context) ? 1 : 0;
            }
            if (node.op === '||') {
                const left = evaluate(node.left, context);
                if (left) return 1;
                return evaluate(node.right, context) ? 1 : 0;
            }

            const left = evaluate(node.left, context);
            const right = evaluate(node.right, context);

            switch (node.op) {
                case '+': return left + right;
                case '-': return left - right;
                case '*': return left * right;
                case '/':
                    // Allow division by zero to return Infinity/-Infinity/NaN
                    return left / right;
                case '**': return Math.pow(left, right);
                case '<<': return Math.trunc(left) << Math.trunc(right);
                case '>>': return Math.trunc(left) >> Math.trunc(right);
                case '&': return Math.trunc(left) & Math.trunc(right);
                case '|': return Math.trunc(left) | Math.trunc(right);
                case '^': return Math.trunc(left) ^ Math.trunc(right);
                case '==': return left === right ? 1 : 0;
                case '!=': return left !== right ? 1 : 0;
                case '<': return left < right ? 1 : 0;
                case '<=': return left <= right ? 1 : 0;
                case '>': return left > right ? 1 : 0;
                case '>=': return left >= right ? 1 : 0;
                case '^^': return (left ? 1 : 0) !== (right ? 1 : 0) ? 1 : 0; // XOR
                default:
                    throw new EvalError(`Unknown binary operator: ${node.op}`);
            }
        }

        case 'FUNCTION_CALL': {
            const funcName = node.name.toLowerCase();

            // Check for user-defined function first
            const userFunc = context.getUserFunction(funcName);
            if (userFunc) {
                const expected = userFunc.params.length;
                if (node.args.length < expected) {
                    throw new EvalError(`${node.name}() requires ${expected} argument${expected !== 1 ? 's' : ''}, got ${node.args.length}`);
                }
                if (node.args.length > expected) {
                    throw new EvalError(`${node.name}() requires ${expected} argument${expected !== 1 ? 's' : ''}, got ${node.args.length}`);
                }
                // Evaluate arguments in the calling context
                const argValues = node.args.map(arg => evaluate(arg, context));

                // Create function context with only constants and user functions (no variables)
                const funcContext = context.cloneForFunction();
                for (let i = 0; i < userFunc.params.length; i++) {
                    funcContext.setVariable(userFunc.params[i], argValues[i] !== undefined ? argValues[i] : 0);
                }

                // Evaluate function body
                return evaluate(userFunc.body, funcContext);
            }

            // Special handling for 'if' - lazy evaluation to support recursion
            if (funcName === 'if') {
                validateArgCount(funcName, node.args.length);
                const condition = evaluate(node.args[0], context);
                if (condition) {
                    return evaluate(node.args[1], context);
                } else {
                    return node.args.length > 2 ? evaluate(node.args[2], context) : 0;
                }
            }

            // Special handling for 'sum' - sum(expr; var; start; end)
            if (funcName === 'sum') {
                if (node.args.length !== 4) {
                    throw new EvalError('sum() requires 4 arguments: sum(expr; var; start; end)');
                }
                const exprNode = node.args[0];
                const varNode = node.args[1];
                if (varNode.type !== 'VARIABLE') {
                    throw new EvalError('sum() second argument must be a variable name');
                }
                const varName = varNode.name;
                const start = Math.floor(evaluate(node.args[2], context));
                const end = Math.floor(evaluate(node.args[3], context));

                if (!isFinite(start) || !isFinite(end)) {
                    throw new EvalError('sum() start and end must be finite numbers');
                }
                const iterations = end - start + 1;
                if (iterations > 10000000) {
                    throw new EvalError(`sum() too many iterations (${iterations}). Max is 10,000,000`);
                }

                let total = 0;
                const sumContext = context.clone();
                for (let i = start; i <= end; i++) {
                    sumContext.setVariable(varName, i);
                    total += evaluate(exprNode, sumContext);
                }
                return total;
            }

            // Special handling for 'prod' - prod(expr; var; start; end)
            if (funcName === 'prod') {
                if (node.args.length !== 4) {
                    throw new EvalError('prod() requires 4 arguments: prod(expr; var; start; end)');
                }
                const exprNode = node.args[0];
                const varNode = node.args[1];
                if (varNode.type !== 'VARIABLE') {
                    throw new EvalError('prod() second argument must be a variable name');
                }
                const varName = varNode.name;
                const start = Math.floor(evaluate(node.args[2], context));
                const end = Math.floor(evaluate(node.args[3], context));

                if (!isFinite(start) || !isFinite(end)) {
                    throw new EvalError('prod() start and end must be finite numbers');
                }
                const iterations = end - start + 1;
                if (iterations > 10000000) {
                    throw new EvalError(`prod() too many iterations (${iterations}). Max is 10,000,000`);
                }

                let total = 1;
                const prodContext = context.clone();
                for (let i = start; i <= end; i++) {
                    prodContext.setVariable(varName, i);
                    total *= evaluate(exprNode, prodContext);
                }
                return total;
            }

            // Check built-in functions
            const builtin = builtinFunctions[funcName];
            if (builtin) {
                validateArgCount(funcName, node.args.length);
                const argValues = node.args.map(arg => evaluate(arg, context));
                return builtin(argValues, context);
            }

            throw new EvalError(`Unknown function: ${node.name}`);
        }

        default:
            throw new EvalError(`Unknown node type: ${node.type}`);
    }
}

/**
 * Robust replacement for Number.toFixed() that correctly rounds decimal midpoints.
 * Standard toFixed uses the exact binary representation, so 0.075 (stored as 0.074999...)
 * rounds to '0.07' instead of '0.08'. This uses string-based exponential shifting:
 * Number('0.075e2') parses directly to 7.5 (exact), avoiding the multiplication error.
 */
function toFixed(value, places) {
    const rounded = Number(Math.round(Number(value + 'e' + places)) + 'e-' + places);
    return isFinite(rounded) ? rounded.toFixed(places) : value.toFixed(places);
}

/**
 * Add comma grouping to integer part of a numeric string: 1234567.89 -> 1,234,567.89
 */
function addCommaGrouping(numStr) {
    const parts = numStr.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
}

/**
 * Format value as money: $1,234.56 with exactly 2 decimal places, comma grouping
 */
// Currency decimal places: ¥ and ₩ use 0, most others use 2
const currencyPlaces = { '¥': 0, '₩': 0, '₫': 0 };
// Suffix currencies: symbol goes after the number (e.g., 1,234₽)
const suffixCurrencies = '₽₸₼₾৳';

function formatMoney(value, symbol) {
    symbol = symbol || '$';
    const places = currencyPlaces[symbol] != null ? currencyPlaces[symbol] : 2;
    const absValue = Math.abs(value);
    const result = addCommaGrouping(toFixed(absValue, places));
    if (suffixCurrencies.includes(symbol)) {
        return value < 0 ? '-' + result + symbol : result + symbol;
    }
    return value < 0 ? '-' + symbol + result : symbol + result;
}

/**
 * Format value as percentage: multiply by 100, strip trailing zeros, append %
 */
function formatPercent(value, places) {
    const percent = value * 100;
    const formatted = toFixed(percent, places).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return formatted + '%';
}

/**
 * Format value as degrees: mod 360, strip trailing zeros, append °
 */
function formatDegrees(value, places, degreesMode = true) {
    const M = degreesMode ? 360 : 2 * Math.PI;
    const normalized = value - M * Math.floor(value / M);
    const formatted = toFixed(normalized, places).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return degreesMode ? formatted + '°' : formatted;
}

/**
 * Format a number for display
 * If varName ends with '$', format as money
 * If varName ends with '%', format as percentage
 * If varName ends with '°', format as degrees
 */
function formatNumber(value, places = 14, stripZeros = true, format = 'float', base = 10, groupDigits = false, varName = null) {
    if (!isFinite(value)) {
        if (isNaN(value)) return 'NaN';
        return value > 0 ? 'Infinity' : '-Infinity';
    }

    // Check for special variable name suffixes
    if (varName) {
        if (varName.endsWith('$')) return formatMoney(value);
        else if (varName.endsWith('%')) return formatPercent(value, places);
        else if (varName.endsWith('°')) return formatDegrees(value, places);
    }

    // Non-decimal base output: round to integer, use value#base suffix notation (e.g., FF#16, 77#8)
    if (base !== 10) {
        if (base < 2 || base > 36) throw new Error(`Base must be between 2 and 36, got ${base}`);
        const intVal = Math.round(value);
        const str = intVal.toString(base).toUpperCase();
        return str + '#' + base;
    }

    let str;
    switch (format) {
        case 'sci':
            str = value.toExponential(places);
            break;
        case 'eng': {
            // Engineering notation: exponent is multiple of 3
            if (value === 0) {
                str = toFixed(0, places);
            } else {
                const exp = Math.floor(Math.log10(Math.abs(value)));
                const engExp = Math.floor(exp / 3) * 3;
                const mantissa = value / Math.pow(10, engExp);
                str = toFixed(mantissa, places) + 'e' + engExp;
            }
            break;
        }
        default: // float
            // Use decimal places (toFixed) instead of significant figures
            if (Math.abs(value) >= 1e14 || (Math.abs(value) < 1e-14 && value !== 0)) {
                // Use scientific notation for very large/small numbers
                str = value.toExponential(places);
            } else {
                str = toFixed(value, places);
            }
    }

    // Strip trailing zeros if requested
    if (stripZeros && str.includes('.')) {
        if (str.includes('e')) {
            // Strip zeros from mantissa before the 'e'
            const eIdx = str.indexOf('e');
            str = str.substring(0, eIdx).replace(/\.?0+$/, '') + str.substring(eIdx);
        } else {
            str = str.replace(/\.?0+$/, '');
        }
    }

    // Add comma grouping to integer part if requested
    if (groupDigits && !str.includes('e')) {
        str = addCommaGrouping(str);
    }

    return str;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        EvalContext, EvalError, evaluate, formatNumber, addCommaGrouping, formatMoney, formatPercent, formatDegrees, parseDateText, formatDateValue, parseDurationText, formatDuration, toFixed, checkBalance, modNormalize, modCheckBalance,
        builtinFunctions, factorial, gamma, currencyPlaces, suffixCurrencies
    };
}
