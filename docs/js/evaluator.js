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
        this.userFunctions = new Map();
        this.degreesMode = false; // false = radians, true = degrees
        this.usedConstants = new Set();
        this.usedFunctions = new Set();
    }

    setVariable(name, value) {
        this.variables.set(name, value);
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
 * Julian day number calculations
 */
function dateToJulian(year, month, day) {
    const a = Math.floor((14 - month) / 12);
    const y = year + 4800 - a;
    const m = month + 12 * a - 3;
    return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

function julianToDate(jd) {
    const a = jd + 32044;
    const b = Math.floor((4 * a + 3) / 146097);
    const c = a - Math.floor(146097 * b / 4);
    const d = Math.floor((4 * c + 3) / 1461);
    const e = c - Math.floor(1461 * d / 4);
    const m = Math.floor((5 * e + 2) / 153);

    const day = e - Math.floor((153 * m + 2) / 5) + 1;
    const month = m + 3 - 12 * Math.floor(m / 10);
    const year = 100 * b + d - 4800 + Math.floor(m / 10);

    return { year, month, day };
}

/**
 * MathPad date format: YYYYMMDD.HHMMSS or YYMMDD.HHMMSS
 */
function parseDate(dateNum) {
    const intPart = Math.floor(dateNum);
    const fracPart = dateNum - intPart;

    let year, month, day;
    if (intPart >= 10000000) {
        // YYYYMMDD format
        year = Math.floor(intPart / 10000);
        month = Math.floor((intPart % 10000) / 100);
        day = intPart % 100;
    } else {
        // YYMMDD format (assume 1900s or 2000s)
        const yy = Math.floor(intPart / 10000);
        year = yy >= 50 ? 1900 + yy : 2000 + yy;
        month = Math.floor((intPart % 10000) / 100);
        day = intPart % 100;
    }

    let hour = 0, minute = 0, second = 0;
    if (fracPart > 0) {
        const timePart = Math.round(fracPart * 1000000);
        hour = Math.floor(timePart / 10000);
        minute = Math.floor((timePart % 10000) / 100);
        second = timePart % 100;
    }

    return { year, month, day, hour, minute, second };
}

function formatDate(year, month, day, hour = 0, minute = 0, second = 0) {
    const intPart = year * 10000 + month * 100 + day;
    if (hour === 0 && minute === 0 && second === 0) {
        return intPart;
    }
    const fracPart = (hour * 10000 + minute * 100 + second) / 1000000;
    return intPart + fracPart;
}

/**
 * Built-in functions
 */
const builtinFunctions = {
    // Math functions
    abs: (args) => Math.abs(args[0]),
    sign: (args) => Math.sign(args[0]),
    int: (args) => Math.trunc(args[0]),
    frac: (args) => args[0] - Math.trunc(args[0]),
    round: (args) => {
        if (args.length === 1) return Math.round(args[0]);
        const places = args[1];
        const factor = Math.pow(10, places);
        return Math.round(args[0] * factor) / factor;
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

    // Date/Time functions
    now: (args) => {
        const d = new Date();
        return formatDate(d.getFullYear(), d.getMonth() + 1, d.getDate(),
                          d.getHours(), d.getMinutes(), d.getSeconds());
    },

    days: (args) => {
        // Days between two dates
        const d1 = parseDate(args[0]);
        const d2 = parseDate(args[1]);
        const j1 = dateToJulian(d1.year, d1.month, d1.day);
        const j2 = dateToJulian(d2.year, d2.month, d2.day);
        return j2 - j1;
    },

    jdays: (args) => {
        // Julian day number from date
        const d = parseDate(args[0]);
        return dateToJulian(d.year, d.month, d.day);
    },

    date: (args) => {
        // Date from Julian day number
        const { year, month, day } = julianToDate(Math.round(args[0]));
        return formatDate(year, month, day);
    },

    jdate: (args) => {
        // Same as date
        const { year, month, day } = julianToDate(Math.round(args[0]));
        return formatDate(year, month, day);
    },

    year: (args) => parseDate(args[0]).year,
    month: (args) => parseDate(args[0]).month,
    day: (args) => parseDate(args[0]).day,

    weekday: (args) => {
        const d = parseDate(args[0]);
        const jd = dateToJulian(d.year, d.month, d.day);
        return ((jd + 1) % 7) + 1; // 1=Sunday, 7=Saturday
    },

    hour: (args) => parseDate(args[0]).hour,
    minute: (args) => parseDate(args[0]).minute,
    second: (args) => parseDate(args[0]).second,

    hours: (args) => {
        // Convert HMS to decimal hours
        const d = parseDate(args[0]);
        return d.hour + d.minute / 60 + d.second / 3600;
    },

    hms: (args) => {
        // Convert decimal hours to HMS format (0.HHMMSS)
        let h = args[0];
        const hours = Math.floor(h);
        h = (h - hours) * 60;
        const minutes = Math.floor(h);
        h = (h - minutes) * 60;
        const seconds = Math.round(h);
        return (hours * 10000 + minutes * 100 + seconds) / 1000000;
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
    }
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
            // Check if it's a zero-arg builtin function like pi
            const builtin = builtinFunctions[node.name.toLowerCase()];
            if (builtin) {
                return builtin([], context);
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
                    if (right === 0) throw new EvalError('Division by zero');
                    return left / right;
                case '%': return left % right;
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
                // Evaluate arguments
                const argValues = node.args.map(arg => evaluate(arg, context));

                // Create new context with parameters bound to arguments
                const funcContext = context.clone();
                for (let i = 0; i < userFunc.params.length; i++) {
                    funcContext.setVariable(userFunc.params[i], argValues[i] !== undefined ? argValues[i] : 0);
                }

                // Evaluate function body
                return evaluate(userFunc.body, funcContext);
            }

            // Special handling for 'if' - lazy evaluation to support recursion
            if (funcName === 'if') {
                if (node.args.length < 2) {
                    throw new EvalError('if() requires at least 2 arguments');
                }
                const condition = evaluate(node.args[0], context);
                if (condition) {
                    return evaluate(node.args[1], context);
                } else {
                    return node.args.length > 2 ? evaluate(node.args[2], context) : 0;
                }
            }

            // Check built-in functions
            const builtin = builtinFunctions[funcName];
            if (builtin) {
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
 * Format a number for display
 * If varName ends with '$', format as money (up to 2 decimals, comma grouping, $ prefix)
 * If varName ends with '%', format as percentage (up to 2 decimals, % suffix)
 */
function formatNumber(value, places = 14, stripZeros = true, format = 'float', base = 10, groupDigits = false, varName = null) {
    if (!isFinite(value)) {
        if (isNaN(value)) return 'NaN';
        return value > 0 ? 'Infinity' : '-Infinity';
    }

    // Check for special variable name suffixes
    if (varName) {
        if (varName.endsWith('$')) {
            // Money format: $1,234.56 with exactly 2 decimal places
            const absValue = Math.abs(value);
            const formatted = absValue.toFixed(2);
            const parts = formatted.split('.');
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
            const result = parts.join('.');
            return value < 0 ? '-$' + result : '$' + result;
        }
        if (varName.endsWith('%')) {
            // Percentage format: 0.075 displays as 7.5% (multiply by 100, up to 2 decimal places)
            const percent = value * 100;
            const formatted = percent.toFixed(2).replace(/\.?0+$/, '');
            return formatted + '%';
        }
    }

    // Integer base output: use value#base suffix notation (e.g., FF#16, 77#8)
    if (base !== 10 && Number.isInteger(value)) {
        const intVal = Math.trunc(value);
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
                str = (0).toFixed(places);
            } else {
                const exp = Math.floor(Math.log10(Math.abs(value)));
                const engExp = Math.floor(exp / 3) * 3;
                const mantissa = value / Math.pow(10, engExp);
                str = mantissa.toFixed(places) + 'e' + engExp;
            }
            break;
        }
        default: // float
            // Use decimal places (toFixed) instead of significant figures
            if (Math.abs(value) >= 1e14 || (Math.abs(value) < 1e-14 && value !== 0)) {
                // Use scientific notation for very large/small numbers
                str = value.toExponential(places);
            } else {
                str = value.toFixed(places);
            }
    }

    // Strip trailing zeros if requested
    if (stripZeros && str.includes('.') && !str.includes('e')) {
        str = str.replace(/\.?0+$/, '');
    }

    // Add comma grouping to integer part if requested
    if (groupDigits && !str.includes('e')) {
        const parts = str.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        str = parts.join('.');
    }

    return str;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        EvalContext, EvalError, evaluate, formatNumber,
        builtinFunctions, factorial, gamma,
        dateToJulian, julianToDate, parseDate, formatDate
    };
}
