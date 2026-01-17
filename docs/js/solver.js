/**
 * MathPad Solver - Brent's root-finding algorithm and equation solving
 */

/**
 * Solver error
 */
class SolverError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SolverError';
    }
}

/**
 * Brent's method for root finding (Van Wijngaarden-Dekker-Brent)
 * Finds x such that f(x) = 0 in the interval [a, b]
 *
 * @param {Function} f - Function to find root of
 * @param {number} a - Lower bound
 * @param {number} b - Upper bound
 * @param {number} tol - Tolerance (default: machine epsilon * 100)
 * @param {number} maxIter - Maximum iterations (default: 100)
 * @returns {number} Root value
 */
function brent(f, a, b, tol = 1e-12, maxIter = 100) {
    const EPS = Number.EPSILON;

    let fa = f(a);
    let fb = f(b);

    // Check if either endpoint is already a root
    if (Math.abs(fa) < tol) return a;
    if (Math.abs(fb) < tol) return b;

    // Check that root is bracketed
    if (fa * fb > 0) {
        throw new SolverError('Root not bracketed: f(a) and f(b) have same sign');
    }

    // Ensure |f(b)| <= |f(a)|
    if (Math.abs(fa) < Math.abs(fb)) {
        [a, b] = [b, a];
        [fa, fb] = [fb, fa];
    }

    let c = a;
    let fc = fa;
    let d = b - a;
    let e = d;
    let mflag = true;

    for (let iter = 0; iter < maxIter; iter++) {
        // Check for convergence
        if (Math.abs(fb) < tol || Math.abs(b - a) < tol) {
            return b;
        }

        let s;

        if (fa !== fc && fb !== fc) {
            // Inverse quadratic interpolation
            s = (a * fb * fc) / ((fa - fb) * (fa - fc)) +
                (b * fa * fc) / ((fb - fa) * (fb - fc)) +
                (c * fa * fb) / ((fc - fa) * (fc - fb));
        } else {
            // Secant method
            s = b - fb * (b - a) / (fb - fa);
        }

        // Conditions for accepting s
        const cond1 = (s < (3 * a + b) / 4 || s > b);
        const cond2 = mflag && Math.abs(s - b) >= Math.abs(b - c) / 2;
        const cond3 = !mflag && Math.abs(s - b) >= Math.abs(c - d) / 2;
        const cond4 = mflag && Math.abs(b - c) < tol;
        const cond5 = !mflag && Math.abs(c - d) < tol;

        if (cond1 || cond2 || cond3 || cond4 || cond5) {
            // Bisection method
            s = (a + b) / 2;
            mflag = true;
        } else {
            mflag = false;
        }

        const fs = f(s);
        d = c;
        c = b;
        fc = fb;

        if (fa * fs < 0) {
            b = s;
            fb = fs;
        } else {
            a = s;
            fa = fs;
        }

        // Ensure |f(b)| <= |f(a)|
        if (Math.abs(fa) < Math.abs(fb)) {
            [a, b] = [b, a];
            [fa, fb] = [fb, fa];
        }
    }

    throw new SolverError('Maximum iterations exceeded');
}

/**
 * Find a bracketing interval for the root
 * Searches outward from an initial guess, preferring positive values
 *
 * @param {Function} f - Function to bracket
 * @param {number} guess - Initial guess (default: 1)
 * @param {number} low - Lower limit for search (default: -1e10)
 * @param {number} high - Upper limit for search (default: 1e10)
 * @returns {[number, number]} Bracketing interval [a, b]
 */
function bracket(f, guess = 1, low = -1e10, high = 1e10) {
    // Try to find a bracket preferring positive values
    const FACTOR = 1.6;
    const MAX_TRIES = 50;

    // First, try around the guess
    let a = guess > 0 ? guess / 2 : guess - 1;
    let b = guess > 0 ? guess * 2 : guess + 1;

    // Clamp to limits
    a = Math.max(a, low);
    b = Math.min(b, high);

    let fa, fb;

    try {
        fa = f(a);
        fb = f(b);
    } catch (e) {
        // If evaluation fails, try different starting points
        a = 0.01;
        b = 1;
        fa = f(a);
        fb = f(b);
    }

    // Expand the bracket until we find a sign change
    for (let i = 0; i < MAX_TRIES; i++) {
        if (!isFinite(fa) || !isFinite(fb)) {
            // Try to recover from NaN/Infinity
            if (!isFinite(fa)) {
                a = (a + b) / 2;
                fa = f(a);
            }
            if (!isFinite(fb)) {
                b = (a + b) / 2;
                fb = f(b);
            }
            continue;
        }

        if (fa * fb < 0) {
            return [a, b];
        }

        // Expand in the direction of smaller |f|
        if (Math.abs(fa) < Math.abs(fb)) {
            a = a - FACTOR * (b - a);
            a = Math.max(a, low);
            try {
                fa = f(a);
            } catch (e) {
                fa = Infinity;
            }
        } else {
            b = b + FACTOR * (b - a);
            b = Math.min(b, high);
            try {
                fb = f(b);
            } catch (e) {
                fb = Infinity;
            }
        }
    }

    // Try a grid search as last resort
    const gridPoints = 20;
    const step = (high - low) / gridPoints;
    let prevX = low;
    let prevF;
    try {
        prevF = f(low);
    } catch (e) {
        prevF = NaN;
    }

    for (let i = 1; i <= gridPoints; i++) {
        const x = low + i * step;
        let fx;
        try {
            fx = f(x);
        } catch (e) {
            fx = NaN;
        }

        if (isFinite(prevF) && isFinite(fx) && prevF * fx < 0) {
            return [prevX, x];
        }

        prevX = x;
        prevF = fx;
    }

    throw new SolverError('Could not find a bracketing interval');
}

/**
 * Solve an equation for a single unknown variable
 *
 * @param {Function} makeEquationFunc - Function that takes (unknownValue) and returns f(unknownValue)
 *                                      where f(x) = 0 is the equation to solve
 * @param {Object} limits - Optional search limits { low, high }
 * @param {number} guess - Optional initial guess
 * @returns {number} Solution value
 */
function solveEquation(makeEquationFunc, limits = null, guess = 1) {
    const low = limits?.low ?? -1e10;
    const high = limits?.high ?? 1e10;

    // Find bracketing interval
    const [a, b] = bracket(makeEquationFunc, guess, low, high);

    // Solve using Brent's method
    return brent(makeEquationFunc, a, b);
}

/**
 * Parse an equation and identify the unknown variable
 * Returns { leftAST, rightAST, unknownVar } or null if not solvable
 *
 * @param {string} equation - Equation text (e.g., "a + b = c")
 * @param {Object} context - Evaluation context with known variables
 * @returns {Object|null} Parsed equation info
 */
function parseEquation(equation, knownVars) {
    // Split on = (but not == or != etc)
    const eqMatch = equation.match(/^([^=]+)=([^=].*)$/);
    if (!eqMatch) return null;

    const leftText = eqMatch[1].trim();
    const rightText = eqMatch[2].trim();

    // Parse both sides
    let leftAST, rightAST;
    try {
        leftAST = parseExpression(leftText);
        rightAST = parseExpression(rightText);
    } catch (e) {
        return null;
    }

    // Find all variables in the equation
    const leftVars = findVariables(leftAST);
    const rightVars = findVariables(rightAST);
    const allVars = new Set([...leftVars, ...rightVars]);

    // Find unknown variables (not in knownVars)
    const unknowns = [...allVars].filter(v => !knownVars.has(v));

    return {
        leftAST,
        rightAST,
        leftText,
        rightText,
        allVars: [...allVars],
        unknowns
    };
}

/**
 * Find all variable names in an AST
 */
function findVariables(node) {
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
 * Substitute variables in an AST with their definition expressions
 * @param {Object} node - AST node
 * @param {Map} substitutions - Map of variable name -> AST expression
 * @returns {Object} New AST with substitutions applied
 */
function substituteInAST(node, substitutions) {
    if (!node) return node;

    switch (node.type) {
        case 'NUMBER':
            return node;

        case 'VARIABLE':
            if (substitutions.has(node.name)) {
                // Return a deep copy of the substitution to avoid shared references
                return deepCopyAST(substitutions.get(node.name));
            }
            return node;

        case 'BINARY_OP':
            return {
                type: 'BINARY_OP',
                op: node.op,
                left: substituteInAST(node.left, substitutions),
                right: substituteInAST(node.right, substitutions)
            };

        case 'UNARY_OP':
            return {
                type: 'UNARY_OP',
                op: node.op,
                operand: substituteInAST(node.operand, substitutions)
            };

        case 'FUNCTION_CALL':
            return {
                type: 'FUNCTION_CALL',
                name: node.name,
                args: node.args.map(arg => substituteInAST(arg, substitutions))
            };

        default:
            return node;
    }
}

/**
 * Deep copy an AST node
 */
function deepCopyAST(node) {
    if (!node) return node;

    switch (node.type) {
        case 'NUMBER':
            return { ...node };

        case 'VARIABLE':
            return { ...node };

        case 'BINARY_OP':
            return {
                type: 'BINARY_OP',
                op: node.op,
                left: deepCopyAST(node.left),
                right: deepCopyAST(node.right)
            };

        case 'UNARY_OP':
            return {
                type: 'UNARY_OP',
                op: node.op,
                operand: deepCopyAST(node.operand)
            };

        case 'FUNCTION_CALL':
            return {
                type: 'FUNCTION_CALL',
                name: node.name,
                args: node.args.map(deepCopyAST)
            };

        default:
            return { ...node };
    }
}

/**
 * Check if an equation is a simple definition: variable = expression
 * Returns { variable, expression AST } or null
 */
function isDefinitionEquation(eqText) {
    const eqMatch = eqText.match(/^(.+)=(.+)$/);
    if (!eqMatch) return null;

    const leftText = eqMatch[1].trim();
    const rightText = eqMatch[2].trim();

    // Check if left side is a simple variable name
    if (!/^\w+$/.test(leftText)) return null;

    try {
        const rightAST = parseExpression(rightText);
        return {
            variable: leftText,
            expressionAST: rightAST,
            expressionText: rightText
        };
    } catch (e) {
        return null;
    }
}

/**
 * Try to algebraically derive a substitution from an equation
 * Handles cases like: a/b = c => a = b*c, a + b = c => a = c - b, etc.
 * Returns { variable, expressionAST } or null
 */
function deriveSubstitution(eqText, context) {
    const eqMatch = eqText.match(/^(.+)=(.+)$/);
    if (!eqMatch) return null;

    const leftText = eqMatch[1].trim();
    const rightText = eqMatch[2].trim();

    // First check if it's already a simple definition (but only if variable is unknown)
    if (/^\w+$/.test(leftText) && !context.hasVariable(leftText)) {
        try {
            const rightAST = parseExpression(rightText);
            return { variable: leftText, expressionAST: rightAST };
        } catch (e) {
            return null;
        }
    }

    // Try to parse and algebraically manipulate
    try {
        const leftAST = parseExpression(leftText);
        const rightAST = parseExpression(rightText);

        // Case 1: Binary operation on the left side (e.g., height/width = ratio)
        if (leftAST.type === 'BINARY_OP') {
            const op = leftAST.op;
            const leftOperand = leftAST.left;
            const rightOperand = leftAST.right;

            // Check if left operand is a single variable without a value
            if (leftOperand.type === 'VARIABLE' && !context.hasVariable(leftOperand.name)) {
                const exprAST = invertOperation(op, rightAST, rightOperand, true);
                if (exprAST) {
                    return { variable: leftOperand.name, expressionAST: exprAST };
                }
            }

            // Check if right operand is a single variable without a value
            if (rightOperand.type === 'VARIABLE' && !context.hasVariable(rightOperand.name)) {
                const exprAST = invertOperation(op, rightAST, leftOperand, false);
                if (exprAST) {
                    return { variable: rightOperand.name, expressionAST: exprAST };
                }
            }
        }

        // Case 2: Binary operation on the right side (e.g., ratio = height/width)
        if (rightAST.type === 'BINARY_OP') {
            const op = rightAST.op;
            const leftOperand = rightAST.left;
            const rightOperand = rightAST.right;

            // Check if left operand is a single variable without a value
            if (leftOperand.type === 'VARIABLE' && !context.hasVariable(leftOperand.name)) {
                const exprAST = invertOperation(op, leftAST, rightOperand, true);
                if (exprAST) {
                    return { variable: leftOperand.name, expressionAST: exprAST };
                }
            }

            // Check if right operand is a single variable without a value
            if (rightOperand.type === 'VARIABLE' && !context.hasVariable(rightOperand.name)) {
                const exprAST = invertOperation(op, leftAST, leftOperand, false);
                if (exprAST) {
                    return { variable: rightOperand.name, expressionAST: exprAST };
                }
            }
        }

        return null;
    } catch (e) {
        return null;
    }
}

/**
 * Invert a binary operation to solve for a variable
 * Given: result = var op other (if varOnLeft) or result = other op var
 * Returns: AST for var = ...
 */
function invertOperation(op, result, other, varOnLeft) {
    switch (op) {
        case '+':
            // var + other = result => var = result - other
            // other + var = result => var = result - other
            return { type: 'BINARY_OP', op: '-', left: deepCopyAST(result), right: deepCopyAST(other) };

        case '-':
            if (varOnLeft) {
                // var - other = result => var = result + other
                return { type: 'BINARY_OP', op: '+', left: deepCopyAST(result), right: deepCopyAST(other) };
            } else {
                // other - var = result => var = other - result
                return { type: 'BINARY_OP', op: '-', left: deepCopyAST(other), right: deepCopyAST(result) };
            }

        case '*':
            // var * other = result => var = result / other
            // other * var = result => var = result / other
            return { type: 'BINARY_OP', op: '/', left: deepCopyAST(result), right: deepCopyAST(other) };

        case '/':
            if (varOnLeft) {
                // var / other = result => var = result * other
                return { type: 'BINARY_OP', op: '*', left: deepCopyAST(result), right: deepCopyAST(other) };
            } else {
                // other / var = result => var = other / result
                return { type: 'BINARY_OP', op: '/', left: deepCopyAST(other), right: deepCopyAST(result) };
            }

        case '**':
            if (varOnLeft) {
                // var ** other = result => var = result ** (1/other)
                return {
                    type: 'BINARY_OP',
                    op: '**',
                    left: deepCopyAST(result),
                    right: {
                        type: 'BINARY_OP',
                        op: '/',
                        left: { type: 'NUMBER', value: 1 },
                        right: deepCopyAST(other)
                    }
                };
            } else {
                // other ** var = result => var = ln(result) / ln(other)
                // Skip this complex case for now
                return null;
            }

        default:
            return null;
    }
}

/**
 * Build a substitution map from definition equations
 * Only includes definitions where the variable has no value in context
 * Now includes algebraically derived substitutions
 */
function buildSubstitutionMap(equations, context) {
    const substitutions = new Map();

    for (const eq of equations) {
        // First try simple definition
        const def = isDefinitionEquation(eq.text);
        if (def && !context.hasVariable(def.variable)) {
            substitutions.set(def.variable, def.expressionAST);
            continue;
        }

        // Try algebraic derivation
        const derived = deriveSubstitution(eq.text, context);
        if (derived && !context.hasVariable(derived.variable) && !substitutions.has(derived.variable)) {
            substitutions.set(derived.variable, derived.expressionAST);
        }
    }

    return substitutions;
}

/**
 * Create an equation function for solving
 * Returns a function f(x) where f(x) = left - right = 0
 */
function createEquationFunction(leftAST, rightAST, unknownVar, context) {
    return (x) => {
        const ctx = context.clone();
        ctx.setVariable(unknownVar, x);

        try {
            const leftVal = evaluate(leftAST, ctx);
            const rightVal = evaluate(rightAST, ctx);
            return leftVal - rightVal;
        } catch (e) {
            return NaN;
        }
    };
}

// Import parseExpression and evaluate from other modules (will be available globally)
// These will be set up when the modules are loaded together

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SolverError, brent, bracket, solveEquation,
        parseEquation, findVariables, createEquationFunction,
        substituteInAST, deepCopyAST, isDefinitionEquation,
        deriveSubstitution, invertOperation, buildSubstitutionMap
    };
}
