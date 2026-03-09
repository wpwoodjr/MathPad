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
 * Uses tight absolute tolerance (128*EPSILON) for function-value convergence
 * as an early exit when the residual is negligible. Bracket convergence
 * handles all other cases — the caller's balance check determines if the
 * result is acceptable.
 *
 * @param {Function} f - Function to find root of
 * @param {number} a - Lower bound
 * @param {number} b - Upper bound
 * @param {number} maxIter - Maximum iterations (default: 100)
 * @returns {number} Root value
 */
function brent(f, a, b, maxIter = 100) {
    const EPS = Number.EPSILON;
    // Absolute function tolerance: residual within ~128 ULPs of zero
    const fTol = 128 * EPS;

    let fa = f(a);
    let fb = f(b);

    // Check if either endpoint is already a root
    if (Math.abs(fa) <= fTol) return a;
    if (Math.abs(fb) <= fTol) return b;

    // Clamp infinite endpoint values to large finites so interpolation arithmetic stays valid
    if (!isFinite(fa)) fa = Math.sign(fa) * 1e308;
    if (!isFinite(fb)) fb = Math.sign(fb) * 1e308;

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
        const bracketTol = 2 * EPS * Math.abs(b) + fTol;

        // Check for convergence - must actually be near a root, not just bracket collapse
        if (Math.abs(fb) <= fTol) {
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
 * @param {number} knownScale - Max magnitude of known variables (extends search range)
 * @returns {number} Solution value
 */
function solveEquation(f, limits = null, knownScale = 0, modN = null) {
    const hasLimits = limits && isFinite(limits.low) && isFinite(limits.high);
    const fTol = 128 * Number.EPSILON;

    // Generate evaluation points: uniform grid for limits, logarithmic for no limits
    let testPoints;
    if (hasLimits) {
        const numPoints = 50;
        const step = (limits.high - limits.low) / numPoints;
        testPoints = [];
        for (let i = 0; i <= numPoints; i++) {
            testPoints.push(limits.low + i * step);
        }
    } else {
        // Logarithmic points covering wide range efficiently
        // Extend range based on known variable magnitudes
        const logPoints = [0, 0.001, 0.01, 0.1, 1, 10, 100, 1000, 1e4, 1e5, 1e6, 1e7, 1e8];
        if (knownScale > 1e8) {
            for (let p = 1e9; p <= knownScale * 10; p *= 10) {
                logPoints.push(p);
            }
        }
        testPoints = [
            ...logPoints.slice(1).map(x => -x).reverse(),
            ...logPoints
        ];
    }

    // Evaluate all points (filter NaN, keep ±Infinity for sign detection)
    const values = testPoints
        .map(x => ({ x, fx: safeEval(f, x) }))
        .filter(v => !isNaN(v.fx));

    // Find all brackets (and near-zeros) and solve each
    const roots = [];
    const hasNonZero = values.some(v => v.fx !== 0);
    for (let i = 0; i < values.length; i++) {
        // Near-zero at a finite test point (skip if function is identically zero)
        if (isFinite(values[i].fx) && Math.abs(values[i].fx) <= fTol && hasNonZero) {
            roots.push(values[i].x);
        }
        if (i < values.length - 1 && values[i].fx * values[i + 1].fx < 0) {
            try {
                const root = brent(f, values[i].x, values[i + 1].x);
                if (isFinite(root)) {
                    const fRoot = safeEval(f, root);
                    if (!isFinite(fRoot)) continue;
                    // Reject wrapping discontinuities for mod-aware equations
                    if (modN && Math.abs(fRoot) > modN / 4) continue;
                    // Reject singularities (f(root) shouldn't exceed finite bracket endpoints)
                    const maxEndpoint = Math.max(Math.abs(values[i].fx), Math.abs(values[i + 1].fx));
                    if (isFinite(maxEndpoint) && Math.abs(fRoot) > maxEndpoint) continue;
                    roots.push(root);
                }
            } catch (e) {
                // This bracket didn't work, try next
            }
        }
    }

    // Near-tangent root detection: when the scan misses a narrow sign change,
    // do fine grid search near the closest-to-zero point
    if (roots.length === 0 && values.length >= 2) {
        let bestI = 0;
        for (let i = 1; i < values.length; i++) {
            if (Math.abs(values[i].fx) < Math.abs(values[bestI].fx)) bestI = i;
        }
        // Skip if best point is already near zero — function is likely flat
        if (Math.abs(values[bestI].fx) >= fTol) {
            const intervals = [];
            if (bestI > 0) intervals.push([values[bestI - 1].x, values[bestI].x]);
            if (bestI < values.length - 1) intervals.push([values[bestI].x, values[bestI + 1].x]);
            for (const [lo, hi] of intervals) {
                const step = (hi - lo) / 100;
                let prevX = lo, prevFx = safeEval(f, lo);
                let found = false;
                for (let j = 1; j <= 100 && !found; j++) {
                    const x = lo + j * step;
                    const fx = safeEval(f, x);
                    if (isFinite(prevFx) && isFinite(fx) && prevFx * fx < 0) {
                        try {
                            const root = brent(f, prevX, x);
                            if (isFinite(root)) {
                                const fRoot = safeEval(f, root);
                                if (isFinite(fRoot)) {
                                    roots.push(root);
                                    found = true;
                                }
                            }
                        } catch (e) {}
                    }
                    prevX = x;
                    prevFx = fx;
                }
                if (found) break;
            }
        }
    }

    // Return best root: prefer smallest positive, then smallest absolute
    if (roots.length > 0) {
        const positiveRoots = roots.filter(r => r > 0);
        if (positiveRoots.length > 0) {
            positiveRoots.sort((a, b) => a - b);
            return positiveRoots[0];
        }
        roots.sort((a, b) => Math.abs(a) - Math.abs(b));
        return roots[0];
    }

    // Fallback for no-limits: expand outward from default guess
    if (!hasLimits) {
        const bracket = expandFromGuess(f);
        if (bracket) return brent(f, bracket[0], bracket[1]);
    }

    throw new SolverError(hasLimits
        ? `Could not find a root in range [${limits.low}:${limits.high}]`
        : 'Could not find a root');
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
function isDefinitionEquation(eqText, leftText, rightText) {
    if (!leftText || !rightText) return null;

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
function deriveSubstitution(eqText, context, leftText, rightText) {
    if (!leftText || !rightText) return null;

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

        // Recursively isolate unknown variable from binary operations on either side.
        // Handles nested chains (a*b/D = C → a = C*D/b), additive patterns
        // (var*B + C = D → var = (D-C)/B), and any combination thereof.
        const leftIsolate = tryIsolateVariable(leftAST, rightAST, context);
        if (leftIsolate && !findVariablesInAST(rightAST).has(leftIsolate.variable)) return leftIsolate;

        const rightIsolate = tryIsolateVariable(rightAST, leftAST, context);
        if (rightIsolate && !findVariablesInAST(leftAST).has(rightIsolate.variable)) return rightIsolate;

        return null;
    } catch (e) {
        return null;
    }
}

/**
 * Recursively isolate an unknown variable from a binary expression tree.
 * Given that ast equals resultAST, peels off binary operations one level at a time
 * until reaching a bare unknown variable.
 * E.g., ast=(a*b)/D with result=C → invert / → a*b=C*D → invert * → a=C*D/b
 * Also handles additive patterns: ast=a*B+C with result=D → invert + → a*B=D-C → invert * → a=(D-C)/B
 */
function tryIsolateVariable(ast, resultAST, context) {
    // Base case: bare unknown variable
    if (ast.type === 'VARIABLE' && !context.hasVariable(ast.name)) {
        return { variable: ast.name, expressionAST: resultAST };
    }

    // Recursive case: binary operation — try both subtrees
    if (ast.type !== 'BINARY_OP') return null;

    const op = ast.op;

    // Try left subtree (invert to isolate left, then recurse)
    const leftResult = invertOperation(op, resultAST, ast.right, true);
    if (leftResult) {
        const result = tryIsolateVariable(ast.left, leftResult, context);
        if (result && !findVariablesInAST(ast.right).has(result.variable)) {
            return result;
        }
    }

    // Try right subtree (invert to isolate right, then recurse)
    const rightResult = invertOperation(op, resultAST, ast.left, false);
    if (rightResult) {
        const result = tryIsolateVariable(ast.right, rightResult, context);
        if (result && !findVariablesInAST(ast.left).has(result.variable)) {
            return result;
        }
    }

    return null;
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
            let def = isDefinitionEquation(eq.text, eq.leftText, eq.rightText);
            if (!def || context.hasVariable(def.variable)) {
                // Try algebraic derivation
                def = deriveSubstitution(eq.text, context, eq.leftText, eq.rightText);
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
                substitutions.set(def.variable, { ast: def.expressionAST, sourceLine: eq.startLine, modN: !!eq.modN });
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
        SolverError, brent, expandFromGuess, solveEquation,
        parseEquation, findVariables, findVariablesInAST, createEquationFunction,
        substituteInAST, deepCopyAST, isDefinitionEquation,
        deriveSubstitution, invertOperation, buildSubstitutionMap, detectCycle
    };
}
