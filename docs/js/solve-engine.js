/**
 * MathPad Solve Engine - Main solving orchestration
 * Extracted from ui.js for better separation of concerns
 */

/**
 * Build a Map from variable declarations array (first declaration per name wins)
 */
function buildVariablesMap(declarations) {
    const map = new Map();
    for (const info of declarations) {
        if (!map.has(info.name)) {
            map.set(info.name, info);
        }
    }
    return map;
}

/**
 * Find variables in an AST
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
 * Solve a single equation in context
 */
function solveEquationInContext(eqText, context, variables, substitutions = new Map()) {
    // Parse the equation: left = right
    const eqMatch = eqText.match(/^(.+)=(.+)$/);
    if (!eqMatch) {
        throw new Error('Invalid equation format');
    }

    const leftText = eqMatch[1].trim();
    const rightText = eqMatch[2].trim();

    // Parse both sides
    let leftAST = parseExpression(leftText);
    let rightAST = parseExpression(rightText);

    // Find variables in equation
    let leftVars = findVariablesInAST(leftAST);
    let rightVars = findVariablesInAST(rightAST);
    let allVars = new Set([...leftVars, ...rightVars]);

    // Find unknowns (variables without values in context)
    let unknowns = [...allVars].filter(v => !context.hasVariable(v));

    if (unknowns.length === 0) {
        // All variables known - just evaluate to check
        const leftVal = evaluate(leftAST, context);
        const rightVal = evaluate(rightAST, context);
        if (Math.abs(leftVal - rightVal) > 1e-10) {
            // Equation doesn't balance - might be an error
        }
        return { solved: false };
    }

    // If multiple unknowns, try applying substitutions
    if (unknowns.length > 1 && substitutions.size > 0) {
        // Apply substitutions to reduce unknowns
        leftAST = substituteInAST(leftAST, substitutions);
        rightAST = substituteInAST(rightAST, substitutions);

        // Re-find variables after substitution
        leftVars = findVariablesInAST(leftAST);
        rightVars = findVariablesInAST(rightAST);
        allVars = new Set([...leftVars, ...rightVars]);
        unknowns = [...allVars].filter(v => !context.hasVariable(v));
    }

    if (unknowns.length === 0) {
        // All variables known after substitution
        return { solved: false };
    }

    if (unknowns.length > 1) {
        // Still too many unknowns after substitution
        return { solved: false };
    }

    // Exactly one unknown - solve for it
    const unknown = unknowns[0];

    // Get search limits if specified
    let limits = null;
    const varInfo = variables.get(unknown);
    if (varInfo?.declaration?.limits) {
        try {
            const lowAST = parseExpression(varInfo.declaration.limits.lowExpr);
            const highAST = parseExpression(varInfo.declaration.limits.highExpr);
            limits = {
                low: evaluate(lowAST, context),
                high: evaluate(highAST, context)
            };
        } catch (e) {
            // Ignore limit parsing errors
        }
    }

    // Create equation function: f(x) = left - right = 0
    const f = (x) => {
        const ctx = context.clone();
        ctx.setVariable(unknown, x);
        try {
            const leftVal = evaluate(leftAST, ctx);
            const rightVal = evaluate(rightAST, ctx);
            return leftVal - rightVal;
        } catch (e) {
            return NaN;
        }
    };

    // Solve
    try {
        const value = solveEquation(f, limits);

        return {
            solved: true,
            variable: unknown,
            value: value
        };
    } catch (e) {
        // Solving failed (e.g., degenerate equation where both sides are identical)
        return { solved: false };
    }
}

/**
 * Solve equations and return computed values (no text modification)
 * @param {string} text - The formula text (with \expr\ already evaluated)
 * @param {EvalContext} context - Context with known variables
 * @param {Array} declarations - Parsed declarations from discoverVariables
 * @returns {{ computedValues: Map, solved: number, errors: Array }}
 */
function solveEquations(text, context, declarations) {
    const errors = [];
    const computedValues = new Map();
    let solved = 0;

    // Build variables map for lookup
    let variables = buildVariablesMap(declarations);

    // Track user-provided values (input declarations only, not output)
    const userProvidedVars = new Set();
    for (const info of declarations) {
        if (info.value !== null && info.declaration.type !== VarType.OUTPUT) {
            userProvidedVars.add(info.name);
        }
    }

    // Iterative solving
    const maxIterations = 50;
    let iterations = 0;
    let changed = true;

    while (changed && iterations++ < maxIterations) {
        changed = false;

        const equations = findEquations(text);
        const substitutions = buildSubstitutionMap(equations, context, errors);

        for (const eq of equations) {
            try {
                // Skip equations with unevaluated inline expressions
                if (eq.text.includes('\\')) continue;

                // Handle incomplete equations (expr =)
                const incompleteMatch = eq.text.match(/^(.+?)\s*=\s*$/);
                if (incompleteMatch) {
                    try {
                        let ast = parseExpression(incompleteMatch[1].trim());
                        ast = substituteInAST(ast, substitutions);
                        const value = evaluate(ast, context);
                        // Store result but don't modify text
                        computedValues.set(`__incomplete_${eq.line}`, value);
                        solved++;
                    } catch (e) {
                        // Unknown variables - skip
                    }
                    continue;
                }

                // Handle definition equations (var = expr)
                const def = isDefinitionEquation(eq.text);
                if (def) {
                    const varInfo = variables.get(def.variable);
                    const rhsVars = findVariablesInAST(def.expressionAST);
                    const rhsUnknowns = [...rhsVars].filter(v => !context.hasVariable(v));

                    // If user provided value and RHS has unknowns, use equation to solve
                    if (varInfo && varInfo.value !== null && userProvidedVars.has(def.variable)) {
                        context.setVariable(def.variable, varInfo.value);
                        if (rhsUnknowns.length === 0) continue;
                    }

                    // If RHS is fully known, evaluate and set variable
                    if (rhsUnknowns.length === 0) {
                        try {
                            let ast = substituteInAST(def.expressionAST, substitutions);
                            const value = evaluate(ast, context);
                            context.setVariable(def.variable, value);
                            computedValues.set(def.variable, value);
                            changed = true;
                            solved++;
                        } catch (e) {
                            // Skip
                        }
                        continue;
                    }

                    if (!userProvidedVars.has(def.variable)) continue;
                }

                // Skip equations used for algebraic substitutions
                if (!def) {
                    const derived = deriveSubstitution(eq.text, context);
                    if (derived && substitutions.has(derived.variable)) {
                        const derivedVars = findVariablesInAST(derived.expressionAST);
                        const derivedUnknowns = [...derivedVars].filter(v => !context.hasVariable(v));
                        if (derivedUnknowns.length > 0) continue;
                    }
                }

                // Try to solve the equation numerically
                const result = solveEquationInContext(eq.text, context, variables, substitutions);
                if (result.solved) {
                    context.setVariable(result.variable, result.value);
                    computedValues.set(result.variable, result.value);
                    solved++;
                    changed = true;
                }
            } catch (e) {
                errors.push(e.message);
            }
        }
    }

    // Check equation consistency
    const finalEquations = findEquations(text);
    for (const eq of finalEquations) {
        try {
            const eqMatch = eq.text.match(/^(.+)=(.+)$/);
            if (!eqMatch) continue;

            const leftAST = parseExpression(eqMatch[1].trim());
            const rightAST = parseExpression(eqMatch[2].trim());

            const allVars = new Set([...findVariablesInAST(leftAST), ...findVariablesInAST(rightAST)]);
            const unknowns = [...allVars].filter(v => !context.hasVariable(v));

            if (unknowns.length === 0) {
                const leftVal = evaluate(leftAST, context);
                const rightVal = evaluate(rightAST, context);
                const diff = Math.abs(leftVal - rightVal);

                const maxVal = Math.max(Math.abs(leftVal), Math.abs(rightVal));
                const relError = maxVal > 0 ? diff / maxVal : diff;

                if (relError > 1e-10) {
                    errors.push(`Equation doesn't balance: ${eq.text} (${leftVal} ≠ ${rightVal})`);
                }
            }
        } catch (e) {
            // Ignore consistency check errors
        }
    }

    return { computedValues, solved, errors };
}

/**
 * Format output - insert computed values into text
 * @param {string} text - The formula text
 * @param {Array} declarations - Parsed declarations
 * @param {EvalContext} context - Context with all computed values
 * @param {object} record - Record settings for formatting
 * @returns {{ text: string, errors: Array }} Formatted text and any errors
 */
function formatOutput(text, declarations, context, record) {
    const errors = [];
    const format = {
        places: record.places ?? 4,
        stripZeros: record.stripZeros !== false,
        groupDigits: record.groupDigits || false,
        format: record.format || 'float'
    };

    // Fill empty variable declarations with computed values
    for (const info of declarations) {
        if (!info.valueText) {
            if (context.hasVariable(info.name)) {
                const value = context.getVariable(info.name);
                text = setVariableValue(text, info.name, value, format);
            } else {
                // Output declaration with no value is an error
                const decl = info.declaration;
                const isOutput = decl.clearBehavior === ClearBehavior.ON_SOLVE || decl.type === VarType.OUTPUT;
                if (isOutput) {
                    errors.push(`Variable '${info.name}' has no value to output`);
                }
            }
        }
    }

    // Handle incomplete equations (expr =)
    const equations = findEquations(text);
    for (const eq of equations) {
        const incompleteMatch = eq.text.match(/^(.+?)\s*=\s*$/);
        if (incompleteMatch) {
            try {
                const ast = parseExpression(incompleteMatch[1].trim());
                const value = evaluate(ast, context);
                const formatted = formatNumber(value, format.places, format.stripZeros, format.format, 10, format.groupDigits);
                const eqPattern = eq.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                text = text.replace(new RegExp(eqPattern), eq.text + ' ' + formatted);
            } catch (e) {
                // Skip - can't evaluate
            }
        }
    }

    return { text, errors };
}

/**
 * Main solve function - orchestrates discovery, solving, and formatting
 */
function solveRecord(text, context, record) {
    // Pass 1: Variable Discovery (evaluates \expr\, parses declarations)
    const discovery = discoverVariables(text, context, record);
    text = discovery.text;
    const declarations = discovery.declarations;
    const errors = [...discovery.errors];

    // Pass 2: Equation Solving (computes values, no text modification)
    const solveResult = solveEquations(text, context, declarations);
    errors.push(...solveResult.errors);

    // Pass 3: Format Output (inserts values into text)
    const formatResult = formatOutput(text, declarations, context, record);
    text = formatResult.text;
    errors.push(...formatResult.errors);

    return { text, solved: solveResult.solved, errors };
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        solveRecord, solveEquations, formatOutput, solveEquationInContext, findVariablesInAST, buildVariablesMap
    };
}
