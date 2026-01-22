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
 * Get format settings for an inline evaluation expression
 * Looks up variable's format property for $ (money) and % (percentage) formatting
 */
function getInlineEvalFormat(expression, record, variables = null) {
    const trimmed = expression.trim();
    let varFormat = null;

    // Check if expression ends with $ or % (format suffix)
    let baseName = trimmed;
    if (trimmed.endsWith('$')) {
        baseName = trimmed.slice(0, -1);
        varFormat = 'money';
    } else if (trimmed.endsWith('%')) {
        baseName = trimmed.slice(0, -1);
        varFormat = 'percent';
    }

    // If expression is a simple variable name, look up its format from the variables map
    if (variables && /^[a-zA-Z_]\w*$/.test(baseName)) {
        const varInfo = variables.get(baseName);
        if (varInfo && varInfo.declaration && varInfo.declaration.format) {
            // Variable has a format property - use it (overrides suffix if present)
            varFormat = varInfo.declaration.format;
        }
    }

    return {
        places: record.places ?? 4,
        stripZeros: record.stripZeros !== false,
        groupDigits: record.groupDigits || false,
        numberFormat: record.format || 'float',
        varFormat: varFormat
    };
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
 * Solve a record's equations using a 3-pass architecture:
 *
 * Pass 1: Variable Discovery
 *   - Parse all variable declarations
 *   - Evaluate input values using already-known vars
 *   - Evaluate simple \expr\ inline evaluations
 *
 * Pass 2: Equation Solving
 *   - Build substitution map with cycle detection
 *   - Solve equations iteratively until no progress
 *   - Handle definition equations (var = expr) and general equations
 *
 * Pass 3: Final Output
 *   - Insert computed values into output declarations
 *   - Evaluate remaining inline expressions
 *   - Fill incomplete equations (expr =)
 *   - Check equation consistency
 */
function solveRecord(text, context, record) {
    const errors = [];
    let solved = 0;

    // ============================================================
    // PASS 1: Variable Discovery
    // ============================================================

    // First, process simple inline evaluations that don't need variables
    // This allows y: \3+4\ to become y: 7 before variable parsing
    let inlineEvals = findInlineEvaluations(text);
    for (let i = inlineEvals.length - 1; i >= 0; i--) {
        const evalInfo = inlineEvals[i];
        try {
            const ast = parseExpression(evalInfo.expression);
            const value = evaluate(ast, context);
            const format = getInlineEvalFormat(evalInfo.expression, record);
            const formatted = formatVariableValue(value, format.varFormat, false, format);
            text = text.substring(0, evalInfo.start) + formatted + text.substring(evalInfo.end);
        } catch (e) {
            // Skip - will try again after equation solving
        }
    }

    // Parse all variable declarations (returns array, not map)
    const declarations = parseAllVariables(text);

    // Build a map for quick lookup by name (first declaration wins for value)
    let variables = buildVariablesMap(declarations);

    // Track which variables have been defined (by input declarations)
    // A variable can only be defined once - multiple input declarations are errors
    const definedVars = new Set();

    // Evaluate variable values top-to-bottom, adding to context as we go
    // This enforces top-to-bottom ordering - forward references are errors for input types
    for (const info of declarations) {
        const name = info.name;
        const decl = info.declaration;
        const valueText = info.valueText;

        // Skip output declarations - they don't define values
        if (decl.type === VarType.OUTPUT) {
            continue;
        }

        // Check for duplicate input declarations
        if (definedVars.has(name)) {
            errors.push(`Variable "${name}" defined more than once (line ${info.lineIndex + 1})`);
            continue;
        }
        definedVars.add(name);

        // If already has a numeric value (parsed literal), add to context
        if (info.value !== null) {
            context.setVariable(name, info.value);
            continue;
        }

        // Try to evaluate expression
        if (valueText) {
            try {
                const ast = parseExpression(valueText);
                const value = evaluate(ast, context);
                info.value = value;
                context.setVariable(name, value);
            } catch (e) {
                // Couldn't evaluate - this is an error for input types
                const isInputType = decl.type === VarType.STANDARD || decl.type === VarType.INPUT;
                if (isInputType) {
                    try {
                        const ast = parseExpression(valueText);
                        const exprVars = findVariablesInAST(ast);
                        const undefinedVars = [...exprVars].filter(v => !context.hasVariable(v));
                        if (undefinedVars.length > 0) {
                            errors.push(`Variable "${name}" references undefined: ${undefinedVars.join(', ')}`);
                        } else {
                            errors.push(`Variable "${name}": invalid expression "${valueText}"`);
                        }
                    } catch (parseErr) {
                        errors.push(`Variable "${name}" has invalid expression: ${valueText}`);
                    }
                }
            }
        }
    }

    // Track user-provided values (input declarations only, not output)
    const userProvidedVars = new Set();
    for (const info of declarations) {
        if (info.value !== null && info.declaration.type !== VarType.OUTPUT) {
            userProvidedVars.add(info.name);
        }
    }

    // ============================================================
    // PASS 2: Equation Solving
    // ============================================================

    const maxIterations = 50;
    let iterations = 0;
    let changed = true;

    while (changed && iterations++ < maxIterations) {
        changed = false;

        const equations = findEquations(text);
        const substitutions = buildSubstitutionMap(equations, context, errors);

        for (const eq of equations) {
            try {
                // Handle inline expressions within equations
                const inlineMatch = eq.text.match(/\\([^\\]+)\\/);
                if (inlineMatch) {
                    try {
                        let ast = parseExpression(inlineMatch[1]);
                        ast = substituteInAST(ast, substitutions);
                        const value = evaluate(ast, context);
                        const format = getInlineEvalFormat(inlineMatch[1], record, variables);
                        const formatted = formatVariableValue(value, format.varFormat, false, format);
                        const fullMatch = inlineMatch[0];
                        const matchIndex = text.indexOf(fullMatch);
                        if (matchIndex !== -1) {
                            text = text.substring(0, matchIndex) + formatted + text.substring(matchIndex + fullMatch.length);
                            changed = true;
                        }
                    } catch (e) {
                        // Will retry on next iteration
                    }
                    continue;
                }

                // Handle incomplete equations (expr =)
                const incompleteMatch = eq.text.match(/^(.+?)\s*=\s*$/);
                if (incompleteMatch) {
                    try {
                        let ast = parseExpression(incompleteMatch[1].trim());
                        ast = substituteInAST(ast, substitutions);
                        const value = evaluate(ast, context);
                        const format = {
                            places: record.places ?? 4,
                            stripZeros: record.stripZeros !== false,
                            groupDigits: record.groupDigits || false,
                            format: record.format || 'float'
                        };
                        const formatted = formatNumber(value, format.places, format.stripZeros, format.format, 10, format.groupDigits);
                        const eqPattern = eq.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        text = text.replace(new RegExp(eqPattern), eq.text + ' ' + formatted);
                        changed = true;
                        solved++;
                    } catch (e) {
                        // Unknown variables - skip for now
                    }
                    continue;
                }

                // Handle definition equations (var = expr)
                const def = isDefinitionEquation(eq.text);
                if (def) {
                    const varInfo = variables.get(def.variable);
                    const rhsVars = findVariablesInAST(def.expressionAST);
                    const rhsUnknowns = [...rhsVars].filter(v => !context.hasVariable(v));

                    // If user provided value and RHS has unknowns, use equation to solve for unknowns
                    if (varInfo && varInfo.value !== null && userProvidedVars.has(def.variable)) {
                        context.setVariable(def.variable, varInfo.value);
                        if (rhsUnknowns.length === 0) continue;
                        // Fall through to solve for RHS unknowns
                    }

                    // If RHS is fully known, evaluate and set variable
                    if (rhsUnknowns.length === 0) {
                        try {
                            let ast = substituteInAST(def.expressionAST, substitutions);
                            const value = evaluate(ast, context);
                            context.setVariable(def.variable, value);
                            changed = true;

                            if (varInfo && !varInfo.declaration.valueText) {
                                const format = {
                                    places: record.places ?? 4,
                                    stripZeros: record.stripZeros !== false,
                                    groupDigits: record.groupDigits || false,
                                    format: record.format || 'float'
                                };
                                text = setVariableValue(text, def.variable, value, format);
                                variables = buildVariablesMap(parseAllVariables(text));
                                solved++;
                            }
                        } catch (e) {
                            // Skip
                        }
                        continue;
                    }

                    // RHS has unknowns and no user value - skip for now
                    if (!userProvidedVars.has(def.variable)) continue;
                }

                // Skip equations used for algebraic substitutions (unless all vars known)
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
                    const format = {
                        places: record.places ?? 4,
                        stripZeros: record.stripZeros !== false,
                        groupDigits: record.groupDigits || false,
                        format: record.format || 'float'
                    };
                    text = setVariableValue(text, result.variable, result.value, format);
                    context.setVariable(result.variable, result.value);
                    variables = buildVariablesMap(parseAllVariables(text));
                    solved++;
                    changed = true;
                }
            } catch (e) {
                errors.push(e.message);
            }
        }
    }

    // ============================================================
    // PASS 3: Final Output
    // ============================================================

    // Process remaining inline evaluations
    const finalEquations = findEquations(text);
    const finalSubstitutions = buildSubstitutionMap(finalEquations, context, []);
    const remainingEvals = findInlineEvaluations(text);
    for (let i = remainingEvals.length - 1; i >= 0; i--) {
        const evalInfo = remainingEvals[i];
        try {
            let ast = parseExpression(evalInfo.expression);
            ast = substituteInAST(ast, finalSubstitutions);
            const value = evaluate(ast, context);
            const finalVars = buildVariablesMap(parseAllVariables(text));
            const format = getInlineEvalFormat(evalInfo.expression, record, finalVars);
            const formatted = formatVariableValue(value, format.varFormat, false, format);
            text = text.substring(0, evalInfo.start) + formatted + text.substring(evalInfo.end);
        } catch (e) {
            errors.push(`Inline eval error: ${e.message}`);
        }
    }

    // Fill empty variable declarations with computed values
    const finalDeclarations = parseAllVariables(text);
    for (const info of finalDeclarations) {
        if (context.hasVariable(info.name)) {
            const value = context.getVariable(info.name);
            const format = {
                places: record.places ?? 4,
                stripZeros: record.stripZeros !== false,
                groupDigits: record.groupDigits || false,
                format: record.format || 'float'
            };
            text = setVariableValue(text, info.name, value, format);
        }
    }

    // Check equation consistency
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

                // Use relative error for tolerance (10 significant digits)
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

    return { text, solved, errors };
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        solveRecord, solveEquationInContext, getInlineEvalFormat, findVariablesInAST
    };
}
