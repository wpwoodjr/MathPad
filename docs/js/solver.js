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
        // Relative bracket tolerance: scales with magnitude of root
        const bracketTol = 2 * EPS * Math.abs(b) + tol;

        // Check for convergence - must actually be near a root, not just bracket collapse
        if (Math.abs(fb) < tol) {
            return b;
        }
        // If bracket has collapsed to machine precision, return best estimate
        // The caller's balance check will determine if the result is acceptable
        if (Math.abs(b - a) < bracketTol) {
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

        // Conditions for accepting s (reject and use bisection if any are true)
        // cond1: s is outside the interval between (3a+b)/4 and b
        const cond1 = (s - (3 * a + b) / 4) * (s - b) > 0;
        const cond2 = mflag && Math.abs(s - b) >= Math.abs(b - c) / 2;
        const cond3 = !mflag && Math.abs(s - b) >= Math.abs(c - d) / 2;
        const cond4 = mflag && Math.abs(b - c) < bracketTol;
        const cond5 = !mflag && Math.abs(c - d) < bracketTol;

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
 * Safely evaluate a function, returning NaN on error
 */
function safeEval(f, x) {
    try {
        return f(x);
    } catch (e) {
        return NaN;
    }
}

/**
 * Find a bracket using uniform grid search within [low, high]
 * Returns [a, b] where f(a) and f(b) have opposite signs, or null if not found
 */
function gridSearch(f, low, high, numPoints = 20) {
    const step = (high - low) / numPoints;
    let prevX = low;
    let prevF = safeEval(f, low);

    for (let i = 1; i <= numPoints; i++) {
        const x = low + i * step;
        const fx = safeEval(f, x);

        if (isFinite(prevF) && isFinite(fx) && prevF * fx < 0) {
            return [prevX, x];
        }

        prevX = x;
        prevF = fx;
    }

    return null;
}

/**
 * Find a bracket by expanding outward from a guess
 * Used when no explicit limits are provided
 * Returns [a, b] or null if not found
 */
function expandFromGuess(f, guess = 1) {
    const FACTOR = 1.6;
    const MAX_TRIES = 50;

    let a = guess > 0 ? guess / 2 : guess - 1;
    let b = guess > 0 ? guess * 2 : guess + 1;

    let fa = safeEval(f, a);
    let fb = safeEval(f, b);

    for (let i = 0; i < MAX_TRIES; i++) {
        // Handle NaN/Infinity by shrinking toward midpoint
        if (!isFinite(fa)) {
            a = (a + b) / 2;
            fa = safeEval(f, a);
            continue;
        }
        if (!isFinite(fb)) {
            b = (a + b) / 2;
            fb = safeEval(f, b);
            continue;
        }

        if (fa * fb < 0) {
            return [a, b];
        }

        // Expand in the direction of smaller |f|
        if (Math.abs(fa) < Math.abs(fb)) {
            a = a - FACTOR * (b - a);
            fa = safeEval(f, a);
        } else {
            b = b + FACTOR * (b - a);
            fb = safeEval(f, b);
        }
    }

    return null;
}

/**
 * Solve an equation for a single unknown variable
 *
 * @param {Function} f - Function where f(x) = 0 is the equation to solve
 * @param {Object} limits - Optional search limits { low, high }
 * @param {number} guess - Optional initial guess (used when no limits)
 * @returns {number} Solution value
 */
function solveEquation(f, limits = null, guess = 1) {
    const hasLimits = limits && isFinite(limits.low) && isFinite(limits.high);

    // With explicit limits: user knows where to look, just grid search there
    if (hasLimits) {
        const bracket = gridSearch(f, limits.low, limits.high);
        if (bracket) {
            return brent(f, bracket[0], bracket[1]);
        }
        throw new SolverError(`Could not find a root in range [${limits.low}, ${limits.high}]`);
    }

    // No limits: try logarithmic points first (covers wide range efficiently)
    const logPoints = [0, 0.001, 0.01, 0.1, 1, 10, 100, 1000, 1e4, 1e5, 1e6, 1e7, 1e8];
    const testPoints = [
        ...logPoints.slice(1).map(x => -x).reverse(),
        ...logPoints
    ];

    // Evaluate and find sign changes
    const values = testPoints
        .map(x => ({ x, fx: safeEval(f, x) }))
        .filter(v => isFinite(v.fx));

    // Find all brackets and solve each
    const roots = [];
    for (let i = 0; i < values.length - 1; i++) {
        if (values[i].fx * values[i + 1].fx < 0) {
            try {
                const root = brent(f, values[i].x, values[i + 1].x);
                if (isFinite(root)) {
                    roots.push(root);
                }
            } catch (e) {
                // This bracket didn't work, try next
            }
        }
    }

    // Return best root: prefer smallest positive
    if (roots.length > 0) {
        const positiveRoots = roots.filter(r => r > 0);
        if (positiveRoots.length > 0) {
            positiveRoots.sort((a, b) => a - b);
            return positiveRoots[0];
        }
        roots.sort((a, b) => Math.abs(a) - Math.abs(b));
        return roots[0];
    }

    // Fallback: expand outward from guess
    const bracket = expandFromGuess(f, guess);
    if (bracket) {
        return brent(f, bracket[0], bracket[1]);
    }

    throw new SolverError('Could not find a root');
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
    const eqMatch = eqText.match(/^(.+?)=(.+)$/);
    if (!eqMatch) return null;

    const leftText = eqMatch[1].trim();
    const rightText = eqMatch[2].trim();

    // Check if left side is a simple variable name (may have $ or % suffix)
    // Must start with a letter or underscore, not a digit (to avoid matching "1000 = expr")
    if (!/^[a-zA-Z_]\w*[$%]?$/.test(leftText)) return null;

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
    const eqMatch = eqText.match(/^(.+?)=(.+)$/);
    if (!eqMatch) return null;

    const leftText = eqMatch[1].trim();
    const rightText = eqMatch[2].trim();

    // First check if it's already a simple definition (but only if variable is unknown)
    // Must start with a letter or underscore, not a digit
    if (/^[a-zA-Z_]\w*[$%]?$/.test(leftText) && !context.hasVariable(leftText)) {
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
            // Also ensure the other operand doesn't contain this variable (avoid circular refs)
            if (leftOperand.type === 'VARIABLE' && !context.hasVariable(leftOperand.name)) {
                const otherVars = findVariablesInAST(rightOperand);
                if (!otherVars.has(leftOperand.name)) {
                    const exprAST = invertOperation(op, rightAST, rightOperand, true);
                    if (exprAST) {
                        return { variable: leftOperand.name, expressionAST: exprAST };
                    }
                }
            }

            // Check if right operand is a single variable without a value
            // Also ensure the other operand doesn't contain this variable (avoid circular refs)
            if (rightOperand.type === 'VARIABLE' && !context.hasVariable(rightOperand.name)) {
                const otherVars = findVariablesInAST(leftOperand);
                if (!otherVars.has(rightOperand.name)) {
                    const exprAST = invertOperation(op, rightAST, leftOperand, false);
                    if (exprAST) {
                        return { variable: rightOperand.name, expressionAST: exprAST };
                    }
                }
            }
        }

        // Case 2: Binary operation on the right side (e.g., ratio = height/width)
        if (rightAST.type === 'BINARY_OP') {
            const op = rightAST.op;
            const leftOperand = rightAST.left;
            const rightOperand = rightAST.right;

            // Check if left operand is a single variable without a value
            // Also ensure the other operand doesn't contain this variable (avoid circular refs)
            if (leftOperand.type === 'VARIABLE' && !context.hasVariable(leftOperand.name)) {
                const otherVars = findVariablesInAST(rightOperand);
                if (!otherVars.has(leftOperand.name)) {
                    const exprAST = invertOperation(op, leftAST, rightOperand, true);
                    if (exprAST) {
                        return { variable: leftOperand.name, expressionAST: exprAST };
                    }
                }
            }

            // Check if right operand is a single variable without a value
            // Also ensure the other operand doesn't contain this variable (avoid circular refs)
            if (rightOperand.type === 'VARIABLE' && !context.hasVariable(rightOperand.name)) {
                const otherVars = findVariablesInAST(leftOperand);
                if (!otherVars.has(rightOperand.name)) {
                    const exprAST = invertOperation(op, leftAST, leftOperand, false);
                    if (exprAST) {
                        return { variable: rightOperand.name, expressionAST: exprAST };
                    }
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
 * Detects cycles and returns them in the errors array
 */
function buildSubstitutionMap(equations, context, errors = []) {
    const substitutions = new Map();
    const dependencies = new Map(); // variable -> Set of variables it depends on

    for (const eq of equations) {
        try {
            // First try simple definition
            let def = isDefinitionEquation(eq.text);
            if (!def || context.hasVariable(def.variable)) {
                // Try algebraic derivation
                def = deriveSubstitution(eq.text, context);
            }

            if (!def || context.hasVariable(def.variable) || substitutions.has(def.variable)) {
                continue;
            }

            const exprVars = findVariablesInAST(def.expressionAST);

            // Check for cycle before adding (skip silently - numerical solving can still work)
            const cycleVars = detectCycle(def.variable, exprVars, dependencies);
            if (cycleVars) {
                continue;
            }

            // Don't add if expression contains a variable already in substitution map
            // (unless that variable is known in context)
            const hasSubstitutedVar = [...exprVars].some(v => substitutions.has(v) && !context.hasVariable(v));
            if (!hasSubstitutedVar) {
                // Store both the AST and the source equation's line number
                // so we don't apply a substitution back to its own source equation
                substitutions.set(def.variable, { ast: def.expressionAST, sourceLine: eq.startLine });
                dependencies.set(def.variable, exprVars);
            }
        } catch (e) {
            // Add error with line number and continue processing other equations
            errors.push(`Line ${eq.startLine + 1}: ${e.message}`);
        }
    }

    return substitutions;
}

/**
 * Detect if adding a variable with given dependencies would create a cycle
 * Uses DFS to check if any dependency leads back to the variable
 */
function detectCycle(variable, directDeps, dependencies) {
    const visited = new Set();
    const path = [];

    function dfs(v) {
        if (v === variable) {
            return true; // Found cycle back to original variable
        }
        if (visited.has(v)) {
            return false; // Already visited, no cycle through this path
        }
        visited.add(v);
        path.push(v);

        const deps = dependencies.get(v);
        if (deps) {
            for (const dep of deps) {
                if (dfs(dep)) {
                    return true;
                }
            }
        }
        path.pop();
        return false;
    }

    // Check if any direct dependency leads back to the variable
    for (const dep of directDeps) {
        if (dep === variable) {
            return [variable]; // Direct self-reference
        }
        path.length = 0;
        visited.clear();
        if (dfs(dep)) {
            return [dep, ...path];
        }
    }
    return null;
}

/**
 * Find variables in an AST (local copy for solver module)
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
        SolverError, brent, gridSearch, expandFromGuess, solveEquation,
        parseEquation, findVariables, findVariablesInAST, createEquationFunction,
        substituteInAST, deepCopyAST, isDefinitionEquation,
        deriveSubstitution, invertOperation, buildSubstitutionMap, detectCycle
    };
}
