/**
 * MathPad Solve Engine - Main solving orchestration
 * Extracted from ui.js for better separation of concerns
 */

/**
 * Build a Map from variable declarations array (first declaration per name wins,
 * but input declarations take precedence over output declarations since outputs
 * are cleared before solving)
 */
function buildVariablesMap(declarations) {
    const map = new Map();
    for (const info of declarations) {
        if (!map.has(info.name)) {
            map.set(info.name, info);
        } else if (map.get(info.name).declaration.type === VarType.OUTPUT &&
                   info.declaration.type === VarType.INPUT) {
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
function solveEquationInContext(eqText, eqLine, context, variables, substitutions = new Map(), leftText, rightText, modN = null) {
    if (!leftText || !rightText) {
        return { solved: false };
    }

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
    if (unknowns.length >= 1 && substitutions.size > 0) {
        // Filter out substitutions derived from this equation (they would create an identity)
        // and extract just the AST from each substitution entry
        const applicableSubs = new Map();
        for (const [varName, sub] of substitutions) {
            if (sub.sourceLine !== eqLine) {
                applicableSubs.set(varName, sub.ast);
            }
        }

        // Apply substitutions to reduce unknowns
        leftAST = substituteInAST(leftAST, applicableSubs);
        rightAST = substituteInAST(rightAST, applicableSubs);

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
        return { solved: false, tooManyUnknowns: unknowns };
    }

    // Exactly one unknown - solve for it
    const unknown = unknowns[0];

    // Get search limits if specified
    let limits = null;
    const varInfo = variables.get(unknown);
    if (varInfo && varInfo.declaration && varInfo.declaration.limits) {
        try {
            const lowAST = parseTokens(varInfo.declaration.limits.lowTokens);
            const highAST = parseTokens(varInfo.declaration.limits.highTokens);
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
            let diff = leftVal - rightVal;
            if (modN) diff -= modN * Math.round(diff / modN);
            return diff;
        } catch (e) {
            return NaN;
        }
    };

    // Compute scale hint from known variable magnitudes for search range
    let knownScale = 0;
    for (const v of allVars) {
        if (v !== unknown && context.hasVariable(v)) {
            const val = Math.abs(context.getVariable(v));
            if (isFinite(val)) knownScale = Math.max(knownScale, val);
        }
    }

    // Solve — pass modN so solver can reject wrapping discontinuities
    try {
        const value = solveEquation(f, limits, knownScale, modN);

        return {
            solved: true,
            variable: unknown,
            value: value
        };
    } catch (e) {
        // Solving failed (e.g., couldn't bracket root)
        return { solved: false, error: e.message, variable: unknown };
    }
}

/**
 * Solve equations and return computed values (no text modification)
 * @param {string} text - The formula text (with \expr\ already evaluated)
 * @param {EvalContext} context - Context with known variables
 * @param {Array} declarations - Parsed declarations from discoverVariables
 * @param {Object} record - Record settings (for places -> tolerance)
 * @returns {{ computedValues: Map, solved: number, errors: Array, solveFailures: Map }}
 */
function solveEquations(text, context, declarations, record = {}, allTokens, earlyExprOutputs = new Map()) {
    const places = record.places != null ? record.places : 4;
    const errors = [];
    const computedValues = new Map();
    const solveFailures = new Map(); // Track last failure per variable
    let solved = 0;

    // Pre-populate with expression outputs evaluated during discovery (top-to-bottom)
    for (const [lineIndex, result] of earlyExprOutputs) {
        computedValues.set(`__exprout_${lineIndex}`, result);
    }

    // Build variables map for lookup
    let variables = buildVariablesMap(declarations);

    // Track user-provided values (input declarations only, not output)
    const userProvidedVars = new Set();
    for (const info of declarations) {
        if (info.value !== null && info.declaration.type !== VarType.OUTPUT) {
            userProvidedVars.add(info.name);
        }
    }

    // Compute equations and expression outputs ONCE (text doesn't change within this function)
    const { equations, exprOutputs } = findEquationsAndOutputs(text, allTokens, context.localFunctionLines);

    // Iterative solving
    const maxIterations = 50;
    let iterations = 0;
    let changed = true;
    const unsolvedEquations = new Map(); // line → [unknown names]

    while (changed && iterations++ < maxIterations) {
        changed = false;

        const substitutions = buildSubstitutionMap(equations, context, errors);

        // Definition substitutions for undeclared intermediates only (sweep 0)
        // Safe to inline because these variables exist only in equations, not as user-declared vars
        const definitionSubs = new Map();
        for (const [varName, sub] of substitutions) {
            if (sub.isDefinition && !variables.has(varName)) definitionSubs.set(varName, sub);
        }

        // Pass 1: Evaluate definition equations (var = expr) before solving
        // This lets direct computations resolve before Brent's method runs,
        // avoiding singularities from equation-derived substitutions
        for (const eq of equations) {
            try {
                if (eq.text.includes('\\')) continue;

                // =° equations skip definition shortcut — Brent's handles mod-aware solving
                const def = !eq.modN && isDefinitionEquation(eq.text, eq.leftText, eq.rightText);
                if (!def) continue;

                const varInfo = variables.get(def.variable);
                const rhsVars = findVariablesInAST(def.expressionAST);
                const rhsUnknowns = [...rhsVars].filter(v => !context.hasVariable(v));

                // If user provided value, set it in context for other definitions to use
                if (varInfo && varInfo.value !== null && userProvidedVars.has(def.variable)) {
                    context.setVariable(def.variable, varInfo.value);
                    if (rhsUnknowns.length === 0) { unsolvedEquations.delete(eq.startLine); continue; }
                }

                // Skip if variable already computed and RHS is fully known (nothing to solve)
                if (context.hasVariable(def.variable) && !userProvidedVars.has(def.variable)) {
                    if (rhsUnknowns.length === 0) { unsolvedEquations.delete(eq.startLine); continue; }
                }

                // If RHS is fully known, evaluate and set variable
                if (rhsUnknowns.length === 0) {
                    try {
                        const subAsts = new Map([...substitutions].map(([k, v]) => [k, v.ast]));
                        let ast = substituteInAST(def.expressionAST, subAsts);
                        const value = evaluate(ast, context);

                        // Check limits if defined
                        if (varInfo && varInfo.declaration && varInfo.declaration.limits) {
                            try {
                                const lowAST = parseTokens(varInfo.declaration.limits.lowTokens);
                                const highAST = parseTokens(varInfo.declaration.limits.highTokens);
                                const low = evaluate(lowAST, context);
                                const high = evaluate(highAST, context);
                                if (value < low || value > high) {
                                    solveFailures.set(def.variable, {
                                        error: `Computed value ${value} is outside limits [${low}, ${high}]`,
                                        line: eq.startLine
                                    });
                                    continue;
                                }
                            } catch (e) {
                                // Ignore limit evaluation errors
                            }
                        }

                        // Only count as progress if value actually changed
                        const oldVal = context.hasVariable(def.variable) ? context.getVariable(def.variable) : undefined;
                        if (oldVal !== value) {
                            context.setVariable(def.variable, value);
                            computedValues.set(def.variable, value);
                            changed = true;
                            solved++;
                        }
                    } catch (e) {
                        if (!(e instanceof EvalError)) {
                            errors.push(`Line ${eq.startLine + 1}: ${e.message}`);
                        }
                    }
                    unsolvedEquations.delete(eq.startLine);
                }
                // If RHS has unknowns, skip — don't fall through to equation solving
                // The equation pass will handle it if needed
            } catch (e) {
                errors.push(`Line ${eq.startLine + 1}: ${e.message}`);
            }
        }

        // Pass 1b: Evaluate extractable definitions from substitutions
        // e.g., "x - a = 3" extracts to "x = a + 3" — if RHS is fully known, evaluate
        for (const [varName, sub] of substitutions) {
            if (context.hasVariable(varName)) continue;
            // =° substitutions skip direct evaluation — Brent's handles mod-aware solving
            if (sub.modN) continue;
            const subVars = findVariablesInAST(sub.ast);
            const subUnknowns = [...subVars].filter(v => !context.hasVariable(v));
            if (subUnknowns.length === 0) {
                try {
                    const value = evaluate(sub.ast, context);
                    const varInfo = variables.get(varName);

                    // Check limits if defined
                    if (varInfo && varInfo.declaration && varInfo.declaration.limits) {
                        try {
                            const lowAST = parseTokens(varInfo.declaration.limits.lowTokens);
                            const highAST = parseTokens(varInfo.declaration.limits.highTokens);
                            const low = evaluate(lowAST, context);
                            const high = evaluate(highAST, context);
                            if (value < low || value > high) {
                                solveFailures.set(varName, {
                                    error: `Computed value ${value} is outside limits [${low}, ${high}]`,
                                    line: sub.sourceLine
                                });
                                continue;
                            }
                        } catch (e) {
                            // Ignore limit evaluation errors
                        }
                    }

                    context.setVariable(varName, value);
                    computedValues.set(varName, value);
                    unsolvedEquations.delete(sub.sourceLine);
                    changed = true;
                    solved++;
                } catch (e) {
                    if (!(e instanceof EvalError)) {
                        errors.push(`Line ${sub.sourceLine + 1}: ${e.message}`);
                    }
                }
            }
        }

        // Pass 2: Solve equations — two sweeps:
        //   Sweep 0: only equations with 1 natural unknown (no substitutions)
        //   Sweep 1: equations reduced to 1 unknown via substitutions
        // Natural solving is preferred because substitutions can create degenerate
        // equations (e.g., substituting one vector component into a related vector
        // equation produces a near-tautology with false roots)
        for (let sweep = 0; sweep < 2 && !changed; sweep++) {
            for (const eq of equations) {
                try {
                    if (eq.text.includes('\\')) continue;

                    // Handle incomplete equations (expr =)
                    if (eq.leftText && !eq.rightText) {
                        if (sweep > 0) continue; // already handled
                        try {
                            let ast = parseExpression(eq.leftText);
                            const subAsts = new Map([...substitutions].map(([k, v]) => [k, v.ast]));
                            ast = substituteInAST(ast, subAsts);
                            const value = evaluate(ast, context);
                            computedValues.set(`__incomplete_${eq.startLine}`, value);
                            solved++;
                        } catch (e) {
                            // Unknown variables - skip
                        }
                        continue;
                    }

                    // Handle definition equations not fully resolved in Pass 1
                    // =° equations skip definition shortcut — Brent's handles mod-aware solving
                    const def = !eq.modN && isDefinitionEquation(eq.text, eq.leftText, eq.rightText);
                    if (def) {
                        const varInfo = variables.get(def.variable);
                        const rhsVars = findVariablesInAST(def.expressionAST);
                        const rhsUnknowns = [...rhsVars].filter(v => !context.hasVariable(v));

                        // If user provided value and RHS has unknowns, use equation to solve
                        if (varInfo && varInfo.value !== null && userProvidedVars.has(def.variable)) {
                            context.setVariable(def.variable, varInfo.value);
                            if (rhsUnknowns.length === 0) { unsolvedEquations.delete(eq.startLine); continue; }
                        }

                        // Skip if variable already computed and RHS is fully known
                        if (context.hasVariable(def.variable) && !userProvidedVars.has(def.variable)) {
                            if (rhsUnknowns.length === 0) { unsolvedEquations.delete(eq.startLine); continue; }
                        }

                        // If RHS is fully known, evaluate (may not have been computed in Pass 1)
                        if (rhsUnknowns.length === 0) {
                            if (sweep > 0) { continue; } // already handled in sweep 0
                            try {
                                const subAsts = new Map([...substitutions].map(([k, v]) => [k, v.ast]));
                                let ast = substituteInAST(def.expressionAST, subAsts);
                                const value = evaluate(ast, context);

                                if (varInfo && varInfo.declaration && varInfo.declaration.limits) {
                                    try {
                                        const lowAST = parseTokens(varInfo.declaration.limits.lowTokens);
                                        const highAST = parseTokens(varInfo.declaration.limits.highTokens);
                                        const low = evaluate(lowAST, context);
                                        const high = evaluate(highAST, context);
                                        if (value < low || value > high) {
                                            solveFailures.set(def.variable, {
                                                error: `Computed value ${value} is outside limits [${low}, ${high}]`,
                                                line: eq.startLine
                                            });
                                            continue;
                                        }
                                    } catch (e) {
                                        // Ignore limit evaluation errors
                                    }
                                }

                                const oldVal = context.hasVariable(def.variable) ? context.getVariable(def.variable) : undefined;
                                if (oldVal !== value) {
                                    context.setVariable(def.variable, value);
                                    computedValues.set(def.variable, value);
                                    changed = true;
                                    solved++;
                                }
                            } catch (e) {
                                if (!(e instanceof EvalError)) {
                                    errors.push(`Line ${eq.startLine + 1}: ${e.message}`);
                                }
                            }
                            unsolvedEquations.delete(eq.startLine);
                            continue;
                        }

                        if (!userProvidedVars.has(def.variable) && !context.hasVariable(def.variable)) continue;
                    }

                    // Try to solve the equation numerically
                    // Sweep 0: no substitutions (natural 1-unknown only)
                    // Sweep 1: with substitutions to reduce multi-unknown equations
                    const modValue = eq.modN ? (record.degreesMode ? 360 : 2 * Math.PI) : null;
                    const result = solveEquationInContext(eq.text, eq.startLine, context, variables,
                        sweep === 0 ? definitionSubs : substitutions, eq.leftText, eq.rightText, modValue);
                    if (result.solved) {
                        context.setVariable(result.variable, result.value);
                        computedValues.set(result.variable, result.value);
                        solveFailures.delete(result.variable);
                        unsolvedEquations.delete(eq.startLine);
                        solved++;
                        changed = true;
                        // Restart so Pass 1 can evaluate definitions with the new value,
                        // avoiding a second Brent's step that might pick an inconsistent root
                        break;
                    } else if (result.error && result.variable) {
                        if (sweep > 0) solveFailures.set(result.variable, { error: result.error, line: eq.startLine });
                    } else if (result.tooManyUnknowns) {
                        if (sweep > 0) unsolvedEquations.set(eq.startLine, result.tooManyUnknowns);
                    } else {
                        // Equation resolved (all variables known) — clear any previous "too many unknowns"
                        unsolvedEquations.delete(eq.startLine);
                    }
                } catch (e) {
                    if (sweep > 0) errors.push(`Line ${eq.startLine + 1}: ${e.message}`);
                }
            }
        }
    }

    // Report solve failures before expression output evaluation
    // so solver errors ("Could not find a root") appear before "has no value" errors
    for (const [varName, failure] of solveFailures) {
        const varInfo = variables.get(varName);
        if (varInfo) {
            errors.push(`Line ${varInfo.lineIndex + 1}: ${failure.error} for '${varName}'`);
        }
    }

    // Report equations that couldn't be solved due to too many unknowns
    // Skip if any unknown already has a solve failure (avoids redundant errors)
    for (const [line, unknowns] of unsolvedEquations) {
        if (!unknowns.some(v => solveFailures.has(v))) {
            errors.push(`Line ${line + 1}: Too many unknowns (${unknowns.join(', ')})`);
        }
    }

    // Evaluate expression outputs (expr:, expr::, expr->, expr->>)
    // Skip outputs already evaluated during discovery (top-to-bottom) or with existing values
    for (const output of exprOutputs) {
        // Skip if already evaluated during discovery
        if (computedValues.has(`__exprout_${output.startLine}`)) {
            continue;
        }
        // Skip non-recalculating outputs that already have a value
        if (!output.recalculates && output.valueTokens && output.valueTokens.length > 0) {
            continue;
        }
        try {
            const ast = parseTokens(output.exprTokens);
            const value = evaluate(ast, context);
            // Store with marker info for formatting
            computedValues.set(`__exprout_${output.startLine}`, {
                value,
                fullPrecision: output.fullPrecision,
                marker: output.marker,
                format: output.format,
                base: output.base
            });
        } catch (e) {
            // Report parse/eval errors including undefined variables
            // (if variable is undefined at this point, solving didn't define it)
            errors.push(`Line ${output.startLine + 1}: ${e.message}`);
        }
    }

    // Check equation consistency (reuses precomputed equations)
    // First-wins ordering: a variable's status is set by the first equation it appears in
    const equationVarStatus = new Map(); // var name → 'solved' | 'unsolved'
    for (const eq of equations) {
        try {
            if (!eq.leftText || !eq.rightText) continue;

            let leftAST, rightAST;
            try {
                leftAST = parseExpression(eq.leftText);
                rightAST = parseExpression(eq.rightText);
            } catch (e) {
                continue; // Parse errors already reported during solving
            }

            const allVars = new Set([...findVariablesInAST(leftAST), ...findVariablesInAST(rightAST)]);
            const unknowns = [...allVars].filter(v => !context.hasVariable(v));

            if (unknowns.length === 0) {
                const leftVal = evaluate(leftAST, context);
                const rightVal = evaluate(rightAST, context);
                const result = eq.modN
                    ? modCheckBalance(leftVal, rightVal, record.degreesMode ? 360 : 2 * Math.PI, places)
                    : checkBalance(leftVal, rightVal, places);
                const balanced = result.balanced;

                if (!balanced) {
                    const eqText = eq.text.length > 30 ? eq.text.substring(0, 30) + '...' : eq.text;
                    if (result.relative) {
                        const pctPlaces = Math.max(0, result.tolPlaces - 2);
                        const diffPct = parseFloat(toFixed(result.difference * 100, pctPlaces));
                        const tolPct = parseFloat(toFixed(result.tolerance * 100, pctPlaces));
                        errors.push(`Line ${eq.startLine + 1}: Equation doesn't balance: ${eqText} (relative diff ${diffPct}% >= ${tolPct}%)`);
                    } else {
                        const diff = parseFloat(toFixed(result.difference, result.tolPlaces));
                        errors.push(`Line ${eq.startLine + 1}: Equation doesn't balance: ${eqText} (absolute diff ${diff} >= ${result.tolerance})`);
                    }
                }

                // Only track status for equations where all variables are declared (user-visible)
                if ([...allVars].every(v => variables.has(v))) {
                    const status = balanced ? 'solved' : 'unsolved';
                    for (const v of allVars) {
                        if (!equationVarStatus.has(v)) equationVarStatus.set(v, status);
                    }
                }
            }
        } catch (e) {
            errors.push(`Line ${eq.startLine + 1}: ${e.message}`);
        }
    }

    return { computedValues, solved, errors, solveFailures, equations, exprOutputs, equationVarStatus };
}

/**
 * Format output - insert computed values into text
 * @param {string} text - The formula text
 * @param {Array} declarations - Parsed declarations
 * @param {EvalContext} context - Context with all computed values
 * @param {Map} computedValues - Pre-computed values from solveEquations
 * @param {object} record - Record settings for formatting
 * @returns {{ text: string, errors: Array }} Formatted text and any errors
 */
function formatOutput(text, declarations, context, computedValues, record, solveFailures = new Map(), precomputedEquations, precomputedExprOutputs) {
    const errors = [];
    const format = {
        places: record.places != null ? record.places : 4,
        stripZeros: record.stripZeros !== false,
        groupDigits: record.groupDigits || false,
        format: record.format || 'float'
    };

    // Fill empty variable declarations with computed values (or constants)
    // Uses pre-parsed declarations to avoid re-tokenizing lines
    const lines = text.split('\n');
    for (const info of declarations) {
        if (!info.valueTokens || info.valueTokens.length === 0) {
            let value = null;
            if (context.variables.has(info.name)) {
                value = context.variables.get(info.name);
            } else if (context.constants.has(info.name) && !context.shadowedConstants.has(info.name)) {
                value = context.constants.get(info.name);
                context.usedConstants.add(info.name);
            } else {
                // Check if there was a solve failure for this variable (already reported in solveEquations)
                if (solveFailures.has(info.name)) {
                    // Skip — already reported before expression output evaluation
                } else {
                    // Output declaration with no value is an error
                    const decl = info.declaration;
                    const isOutput = decl.type === VarType.OUTPUT;
                    if (isOutput) {
                        errors.push(`Line ${info.lineIndex + 1}: Variable '${info.name}' has no value to output`);
                    }
                }
                continue;
            }
            // Use pre-parsed declaration to insert value directly (no re-tokenization)
            const decl = info.declaration;
            let formatted;
            try {
                formatted = formatVariableValue(value, decl.format, decl.fullPrecision, {
                    places: format.places,
                    stripZeros: format.stripZeros,
                    numberFormat: format.format,
                    base: decl.base,
                    groupDigits: format.groupDigits
                });
            } catch (e) {
                errors.push(`Line ${info.lineIndex + 1}: ${e.message}`);
                continue;
            }
            const commentInfo = { comment: decl.comment, commentUnquoted: decl.commentUnquoted };
            const markerEndIndex = info.markerEndCol - 1;
            lines[info.lineIndex] = buildOutputLine(lines[info.lineIndex], markerEndIndex, formatted, commentInfo);
        }
    }
    text = lines.join('\n');

    // Handle incomplete equations and expression outputs using pre-computed values
    const equations = precomputedEquations;
    const exprOutputs = precomputedExprOutputs;
    for (const eq of equations) {
        const key = `__incomplete_${eq.startLine}`;
        if (computedValues.has(key)) {
            const value = computedValues.get(key);
            const formatted = formatNumber(value, format.places, format.stripZeros, format.format, 10, format.groupDigits);
            const eqPattern = eq.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            text = text.replace(new RegExp(eqPattern), eq.text + ' ' + formatted);
        }
    }
    const exprLines = text.split('\n');
    for (const output of exprOutputs) {
        const key = `__exprout_${output.startLine}`;
        if (computedValues.has(key)) {
            const { value, fullPrecision, marker, format: varFormat, base: exprBase } = computedValues.get(key);
            const places = fullPrecision ? 15 : format.places;
            let formatted;
            try {
                formatted = varFormat
                    ? formatVariableValue(value, varFormat, fullPrecision, format)
                    : formatNumber(value, places, format.stripZeros, format.format, exprBase || 10, format.groupDigits);
            } catch (e) {
                errors.push(`Line ${output.startLine + 1}: ${e.message}`);
                continue;
            }

            // Insert the value after the marker
            const line = exprLines[output.startLine];
            const markerEndIndex = output.markerEndCol - 1;
            const commentInfo = { comment: output.comment, commentUnquoted: output.commentUnquoted };
            exprLines[output.startLine] = buildOutputLine(line, markerEndIndex, formatted, commentInfo);
        }
    }
    text = exprLines.join('\n');

    return { text, errors };
}

/**
 * Remove existing references section from text
 */
function removeReferencesSection(text) {
    // Remove table outputs section and references section from end
    text = text.replace(/\n*"--- Table Outputs ---"[\s\S]*$/, '');
    text = text.replace(/\n*"--- Reference Constants and Functions ---"[\s\S]*$/, '');
    return text;
}

/**
 * Append table outputs section showing table results as text
 */
function appendTableOutputsSection(text, tables) {
    if (!tables || tables.length === 0) return text;

    // Check if any tables have data
    const hasTables = tables.some(t =>
        t.type === 'table2' ? t.grid.length > 0 : (t.rows && t.rows.length > 0)
    );
    if (!hasTables) return text;

    const lines = ['"--- Table Outputs ---"'];

    for (const table of tables) {
        if (table.type === 'table2') {
            if (table.grid.length === 0) continue;
            // 2D table: labels line, colValues header, then grid rows
            lines.push(`"${table.iter1Label}"\t"${table.iter2Label}"\t"${table.cellHeader}"`);
            lines.push(`\t${table.colValues.join('\t')}`);
            for (let r = 0; r < table.rowValues.length; r++) {
                lines.push(`${table.rowValues[r]}\t${table.grid[r].join('\t')}`);
            }
        } else {
            if (!table.rows || table.rows.length === 0) continue;
            // 1D table: column headers, then rows
            lines.push(table.columns.map(c => '"' + (c.header || c.name) + '"').join('\t'));
            for (const row of table.rows) {
                lines.push(row.join('\t'));
            }
        }
        lines.push(''); // blank line between tables
    }

    text = text.trimEnd() + '\n\n' + lines.join('\n').trimEnd();
    return text;
}

/**
 * Append references section showing used constants and functions
 */
function appendReferencesSection(text, context) {
    const usedConstants = context.getUsedConstants();
    const usedFunctions = context.getUsedFunctions();

    // Skip if nothing was used from Constants/Functions records
    if (usedConstants.size === 0 && usedFunctions.size === 0) {
        return text;
    }

    const lines = ['"--- Reference Constants and Functions ---"'];

    // Add used constants (including those shadowed by local declarations)
    for (const name of [...usedConstants].sort()) {
        const value = context.constants.get(name);
        const comment = context.constantComments.get(name);
        if (value !== undefined) {
            let line = `${name}: ${value}`;
            if (comment) {
                line += ` "${comment}"`;
            }
            lines.push(line);
        }
    }

    // Add functions
    for (const name of [...usedFunctions].sort()) {
        const func = context.userFunctions.get(name);
        if (func && func.sourceText) {
            lines.push(func.sourceText);
        }
    }

    if (lines.length > 1) {
        text = text.trimEnd() + '\n\n' + lines.join('\n');
    }

    return text;
}

/**
 * Main solve function - orchestrates discovery, solving, and formatting
 */
function solveRecord(text, context, record, parserTokens) {
    // Remove any existing references section before solving
    text = removeReferencesSection(text);

    let allTokens = parserTokens;

    // Capture pre-solve values (before they are cleared)
    // These are available via the ? operator and as stale fallback for ~
    context.preSolveValues = context.preSolveValues || capturePreSolveValues(text, allTokens);

    // Detect table definitions and build skip set
    const tableDefs = findTableDefinitions(text, allTokens);
    const tableLines = new Set();
    for (const td of tableDefs) {
        for (let l = td.startLine; l <= td.endLine; l++) tableLines.add(l);
    }
    // Merge table lines into function def lines for equation skipping
    if (context.localFunctionLines) {
        for (const l of tableLines) context.localFunctionLines.add(l);
    }

    // Clear output variables and expression outputs so they become unknowns for solving
    // Uses 'solve' mode to also clear persistent outputs (:> :>>)
    const clearResult = clearVariables(text, 'solve', allTokens, tableLines.size > 0 ? tableLines : null);
    text = clearResult.text;
    allTokens = clearResult.allTokens;

    // Clear usage tracking from any previous solve
    context.clearUsageTracking();

    // Pass 1: Variable Discovery (evaluates \expr\, parses declarations)
    const discovery = discoverVariables(text, context, record, allTokens, tableLines.size > 0 ? tableLines : null);
    text = discovery.text;
    allTokens = discovery.allTokens;
    const declarations = discovery.declarations;
    const errors = [...(context.functionErrors || []), ...discovery.errors];

    // Pass 2: Equation Solving (computes values, no text modification)
    const solveResult = solveEquations(text, context, declarations, record, allTokens, discovery.earlyExprOutputs);
    errors.push(...solveResult.errors);

    // Pass 3: Format Output (inserts values into text, reuses equations/exprOutputs from pass 2)
    const formatResult = formatOutput(text, declarations, context, solveResult.computedValues, record, solveResult.solveFailures, solveResult.equations, solveResult.exprOutputs);
    text = formatResult.text;
    errors.push(...formatResult.errors);

    // Pass 4: Evaluate tables (after all normal solving is complete)
    const tables = [];
    const savedVars = new Map(context.variables);
    for (const td of tableDefs) {
        // Restore outer context so tables don't leak state to each other
        context.variables = new Map(savedVars);
        const tableResult = td.type === 'table2'
            ? evaluateTable2(td, context, record)
            : evaluateTable(td, context, record);
        errors.push(...tableResult.errors);
        tables.push(tableResult);
    }
    context.variables = savedVars;

    // Pass 5: Append references section showing used constants and functions
    // Skip for reference records (Constants, Functions, Default Settings)
    const isInReferenceCategory = record.category === 'Reference';
    if (!isInReferenceCategory) {
        text = appendReferencesSection(text, context);
    }

    // Pass 6: Append table outputs section
    text = appendTableOutputsSection(text, tables);

    return { text, solved: solveResult.solved, errors, equationVarStatus: solveResult.equationVarStatus, tables };
}

/**
 * Evaluate a table definition: iterate variable from low to high,
 * evaluating body definitions per row and collecting output column values.
 */
function evaluateTable(tableDef, context, record) {
    const errors = [];

    // Evaluate bounds
    let low, high, step;
    try {
        low = evaluate(parseExpression(tableDef.lowExpr), context);
    } catch (e) {
        errors.push(`Line ${tableDef.startLine}: Table low bound cannot be evaluated — ${e.message}`);
        return { columns: [], rows: [], startLine: tableDef.startLine, endLine: tableDef.endLine, errors };
    }
    try {
        high = evaluate(parseExpression(tableDef.highExpr), context);
    } catch (e) {
        errors.push(`Line ${tableDef.startLine}: Table high bound cannot be evaluated — ${e.message}`);
        return { columns: [], rows: [], startLine: tableDef.startLine, endLine: tableDef.endLine, errors };
    }
    if (tableDef.stepExpr) {
        try {
            step = evaluate(parseExpression(tableDef.stepExpr), context);
        } catch (e) {
            errors.push(`Line ${tableDef.startLine}: Table step cannot be evaluated — ${e.message}`);
            return { columns: [], rows: [], startLine: tableDef.startLine, endLine: tableDef.endLine, errors };
        }
    } else {
        step = low <= high ? 1 : -1;
    }
    if (step === 0) {
        errors.push(`Line ${tableDef.startLine}: Table step cannot be zero`);
        return { columns: [], rows: [], startLine: tableDef.startLine, endLine: tableDef.endLine, errors };
    }

    // Evaluate optional font size
    let fontSize = null;
    if (tableDef.fontSizeExpr) {
        try {
            fontSize = evaluate(parseExpression(tableDef.fontSizeExpr), context);
        } catch (e) {
            // Ignore — use default
        }
    }

    // Parse body lines to identify definitions and output columns
    const bodyTokens = new Tokenizer(tableDef.bodyText).tokenize();
    const definitions = [];  // { name, exprText, lineIdx }
    const columns = [];      // { name, format, fullPrecision, base }

    for (let i = 0; i < bodyTokens.length; i++) {
        const lineTokens = bodyTokens[i].filter(t => t.type !== TokenType.EOF);
        if (lineTokens.length === 0) continue;

        const parsed = parseMarkedLine(tableDef.bodyLines[i] || '', lineTokens);
        if (!parsed) continue;

        if (parsed.kind === 'declaration') {
            if (parsed.type === VarType.INPUT) {
                // Definition — extract expression text
                const exprText = parsed.valueTokens && parsed.valueTokens.length > 0
                    ? parsed.valueTokens.map(t => (t.ws || '') + (typeof t.value === 'object' ? t.value.raw || t.value : t.value)).join('')
                    : null;
                definitions.push({ name: parsed.name, exprText, lineIdx: i });
            } else if (parsed.type === VarType.OUTPUT) {
                // Output column — use label as header if present, else variable name
                columns.push({
                    name: parsed.name,
                    header: (parsed.label && parsed.label.trim()) || parsed.name,
                    format: parsed.format || null,
                    fullPrecision: parsed.fullPrecision || false,
                    base: parsed.base || 10
                });
            }
        } else if (parsed.kind === 'expression-output') {
            const exprText = tokensToText(parsed.exprTokens).trim();
            const name = parsed.name || exprText;
            let ast = null;
            try {
                ast = parseExpression(exprText);
            } catch (e) {
                errors.push(`Line ${tableDef.startLine}: Error in table expression '${exprText}' — ${e.message}`);
            }
            columns.push({
                name: name,
                header: (parsed.label && parsed.label.trim()) || name,
                format: parsed.format || null,
                fullPrecision: parsed.fullPrecision || false,
                base: parsed.base || 10,
                ast: ast
            });
        }
    }

    // Find equations in body
    const bodyEqs = findEquationsAndOutputs(tableDef.bodyText, bodyTokens, null);
    const equations = bodyEqs.equations;

    // Pre-parse definition expressions
    const defASTs = [];
    for (const def of definitions) {
        if (!def.exprText) {
            defASTs.push({ name: def.name, ast: null });
            continue;
        }
        try {
            defASTs.push({ name: def.name, ast: parseExpression(def.exprText.trim()) });
        } catch (e) {
            errors.push(`Line ${tableDef.startLine}: Error in table definition '${def.name}' — ${e.message}`);
            defASTs.push({ name: def.name, ast: null });
        }
    }

    // Format settings from record
    const formatOpts = {
        places: record.places != null ? record.places : 4,
        stripZeros: record.stripZeros !== false,
        numberFormat: record.format || 'float',
        groupDigits: record.groupDigits || false
    };

    // Build set of definition names and snapshot pre-table variable values
    const defNames = new Set(defASTs.map(d => d.name));
    const preTableVars = new Set(context.variables.keys());

    // Iterate
    const rows = [];
    let prevValues = new Map();  // previous row's variable values
    const maxRows = 10000;       // safety limit

    for (let val = low, rowCount = 0;
         step > 0 ? val <= high : val >= high;
         val += step, rowCount++) {
        if (rowCount >= maxRows) {
            errors.push(`Line ${tableDef.startLine}: Table exceeded ${maxRows} rows`);
            break;
        }

        // Set up pre-solve values for this row (previous row's values)
        context.preSolveValues = rowCount === 0 ? new Map() : prevValues;

        // Clear equation unknowns: variables that weren't in the outer context,
        // aren't the iterator, and aren't computed by definitions
        for (const col of columns) {
            if (!col.ast && col.name !== tableDef.iteratorName
                && !defNames.has(col.name) && !preTableVars.has(col.name)) {
                context.variables.delete(col.name);
                context.declareVariable(col.name);
            }
        }

        // Set iterator variable
        context.setVariable(tableDef.iteratorName, val);

        // Evaluate definitions in order
        for (const { name, ast } of defASTs) {
            if (!ast) continue;
            try {
                const value = evaluate(ast, context);
                context.setVariable(name, value);
            } catch (e) {
                // Skip errors during iteration (e.g., var~ on row 0)
            }
        }

        // Solve equations (Brent's method) for this row
        for (const eq of equations) {
            try {
                const variables = buildVariablesMap([], context);
                const result = solveEquationInContext(
                    eq.text, eq.startLine, context, variables,
                    new Map(), eq.leftText, eq.rightText, eq.modN || null
                );
                if (result.solved && result.variable && result.value !== undefined) {
                    context.setVariable(result.variable, result.value);
                } else if (result.tooManyUnknowns && !eq._errorReported) {
                    eq._errorReported = true;
                    const eqLine = tableDef.startLine + eq.startLine;
                    errors.push(`Line ${eqLine}: Table equation has too many unknowns: ${result.tooManyUnknowns.join(', ')}`);
                } else if (!result.solved && !result.tooManyUnknowns && !eq._errorReported) {
                    // Check balance — 0 unknowns but might not balance
                    try {
                        const leftVal = evaluate(parseExpression(eq.leftText), context);
                        const rightVal = evaluate(parseExpression(eq.rightText), context);
                        const places = record.places != null ? record.places : 4;
                        const bal = eq.modN
                            ? modCheckBalance(leftVal, rightVal, record.degreesMode ? 360 : 2 * Math.PI, places)
                            : checkBalance(leftVal, rightVal, places);
                        if (!bal.balanced) {
                            eq._errorReported = true;
                            const eqLine = tableDef.startLine + eq.startLine;
                            const eqText = eq.text.trim().length > 30 ? eq.text.trim().substring(0, 30) + '...' : eq.text.trim();
                            errors.push(`Line ${eqLine}: Table equation doesn't balance at row ${rowCount}: ${eqText}`);
                        }
                    } catch (e) { /* skip eval errors */ }
                }
            } catch (e) {
                // Skip equation errors during iteration
            }
        }

        // Collect output values
        const row = [];
        for (const col of columns) {
            let value;
            if (col.ast) {
                // Expression output — evaluate the expression
                try { value = evaluate(col.ast, context); } catch (e) { /* skip */ }
            } else {
                value = context.getVariable(col.name);
            }
            if (value !== undefined) {
                row.push(formatVariableValue(value, col.format, col.fullPrecision, formatOpts));
            } else {
                row.push('');
            }
        }
        rows.push(row);

        // Capture current values for next row's pre-solve
        prevValues = new Map();
        for (const { name } of defASTs) {
            const v = context.getVariable(name);
            if (v !== undefined) prevValues.set(name, v);
        }
        // Also capture output column variables and the iterator
        for (const col of columns) {
            if (!col.ast) {
                const v = context.getVariable(col.name);
                if (v !== undefined) prevValues.set(col.name, v);
            }
        }
        prevValues.set(tableDef.iteratorName, val);
    }

    return { columns, rows, fontSize, startLine: tableDef.startLine, endLine: tableDef.endLine, errors };
}

/**
 * Evaluate a 2D table: nested iteration over two variables.
 * Produces a grid with iter1 as rows and iter2 as columns.
 */
function evaluateTable2(tableDef, context, record) {
    const errors = [];

    // Evaluate bounds for both iterators
    let low1, high1, step1, low2, high2, step2;
    try { low1 = evaluate(parseExpression(tableDef.lowExpr), context); }
    catch (e) { errors.push(`Line ${tableDef.startLine}: Table2 row low bound error — ${e.message}`); return makeEmpty(); }
    try { high1 = evaluate(parseExpression(tableDef.highExpr), context); }
    catch (e) { errors.push(`Line ${tableDef.startLine}: Table2 row high bound error — ${e.message}`); return makeEmpty(); }
    try { step1 = evaluate(parseExpression(tableDef.stepExpr), context); }
    catch (e) { errors.push(`Line ${tableDef.startLine}: Table2 row step error — ${e.message}`); return makeEmpty(); }
    try { low2 = evaluate(parseExpression(tableDef.low2Expr), context); }
    catch (e) { errors.push(`Line ${tableDef.startLine}: Table2 col low bound error — ${e.message}`); return makeEmpty(); }
    try { high2 = evaluate(parseExpression(tableDef.high2Expr), context); }
    catch (e) { errors.push(`Line ${tableDef.startLine}: Table2 col high bound error — ${e.message}`); return makeEmpty(); }
    try { step2 = evaluate(parseExpression(tableDef.step2Expr), context); }
    catch (e) { errors.push(`Line ${tableDef.startLine}: Table2 col step error — ${e.message}`); return makeEmpty(); }

    if (step1 === 0 || step2 === 0) {
        errors.push(`Line ${tableDef.startLine}: Table2 step cannot be zero`);
        return makeEmpty();
    }

    // Font size
    let fontSize = null;
    if (tableDef.fontSizeExpr) {
        try { fontSize = evaluate(parseExpression(tableDef.fontSizeExpr), context); } catch (e) { }
    }

    // Parse body: definitions, output columns, equations (same as evaluateTable)
    const bodyTokens = new Tokenizer(tableDef.bodyText).tokenize();
    const definitions = [];
    const outputVars = []; // variables to display as cell values (excluding the two iterators)
    let iter1Header = tableDef.iteratorName;
    let iter2Header = tableDef.iterator2Name;

    for (let i = 0; i < bodyTokens.length; i++) {
        const lineTokens = bodyTokens[i].filter(t => t.type !== TokenType.EOF);
        if (lineTokens.length === 0) continue;
        const parsed = parseMarkedLine(tableDef.bodyLines[i] || '', lineTokens);
        if (!parsed) continue;

        if (parsed.kind === 'declaration') {
            if (parsed.type === VarType.INPUT) {
                const exprText = parsed.valueTokens && parsed.valueTokens.length > 0
                    ? parsed.valueTokens.map(t => (t.ws || '') + (typeof t.value === 'object' ? t.value.raw || t.value : t.value)).join('')
                    : null;
                definitions.push({ name: parsed.name, exprText });
            } else if (parsed.type === VarType.OUTPUT) {
                const label = (parsed.label && parsed.label.trim()) || parsed.name;
                if (parsed.name === tableDef.iteratorName) {
                    iter1Header = label;
                } else if (parsed.name === tableDef.iterator2Name) {
                    iter2Header = label;
                } else {
                    outputVars.push({
                        name: parsed.name,
                        header: label,
                        format: parsed.format || null,
                        fullPrecision: parsed.fullPrecision || false,
                        base: parsed.base || 10
                    });
                }
            }
        }
    }

    // Find equations
    const bodyEqs = findEquationsAndOutputs(tableDef.bodyText, bodyTokens, null);
    const equations = bodyEqs.equations;

    // Pre-parse definitions
    const defASTs = [];
    for (const def of definitions) {
        if (!def.exprText) { defASTs.push({ name: def.name, ast: null }); continue; }
        try { defASTs.push({ name: def.name, ast: parseExpression(def.exprText.trim()) }); }
        catch (e) { defASTs.push({ name: def.name, ast: null }); }
    }

    const defNames = new Set(defASTs.map(d => d.name));
    const preTableVars = new Set(context.variables.keys());

    const formatOpts = {
        places: record.places != null ? record.places : 4,
        stripZeros: record.stripZeros !== false,
        numberFormat: record.format || 'float',
        groupDigits: record.groupDigits || false
    };

    // Build column values (iter2 range)
    const colValues = [];
    for (let v = low2; step2 > 0 ? v <= high2 : v >= high2; v += step2) {
        colValues.push(v);
        if (colValues.length > 10000) break;
    }

    // Build row values (iter1 range)
    const rowValues = [];
    for (let v = low1; step1 > 0 ? v <= high1 : v >= high1; v += step1) {
        rowValues.push(v);
        if (rowValues.length > 10000) break;
    }

    // Use first output var for cell values (or empty if none)
    const cellVar = outputVars.length > 0 ? outputVars[0] : null;

    // Iterate: rows × columns
    const grid = [];
    for (const rowVal of rowValues) {
        const gridRow = [];
        for (const colVal of colValues) {
            // Clear equation unknowns
            if (cellVar && !preTableVars.has(cellVar.name) && !defNames.has(cellVar.name)) {
                context.variables.delete(cellVar.name);
                context.declareVariable(cellVar.name);
            }

            // Set both iterators
            context.setVariable(tableDef.iteratorName, rowVal);
            context.setVariable(tableDef.iterator2Name, colVal);

            // Evaluate definitions
            for (const { name, ast } of defASTs) {
                if (!ast) continue;
                try { context.setVariable(name, evaluate(ast, context)); } catch (e) { }
            }

            // Solve equations
            for (const eq of equations) {
                try {
                    const variables = buildVariablesMap([], context);
                    const result = solveEquationInContext(
                        eq.text, eq.startLine, context, variables,
                        new Map(), eq.leftText, eq.rightText, eq.modN || null
                    );
                    if (result.solved && result.variable && result.value !== undefined) {
                        context.setVariable(result.variable, result.value);
                    }
                } catch (e) { }
            }

            // Collect cell value
            if (cellVar) {
                const value = context.getVariable(cellVar.name);
                if (value !== undefined) {
                    gridRow.push(formatVariableValue(value, cellVar.format, cellVar.fullPrecision, formatOpts));
                } else {
                    gridRow.push('');
                }
            } else {
                gridRow.push('');
            }
        }
        grid.push(gridRow);
    }

    return {
        type: 'table2',
        iter1Label: iter1Header,
        iter2Label: iter2Header,
        rowValues: rowValues.map(v => formatVariableValue(v, null, false, formatOpts)),
        colValues: colValues.map(v => formatVariableValue(v, null, false, formatOpts)),
        cellHeader: cellVar ? cellVar.header : '',
        grid,
        fontSize,
        startLine: tableDef.startLine,
        endLine: tableDef.endLine,
        errors
    };

    function makeEmpty() {
        return { type: 'table2', iter1Label: '', iter2Label: '', rowValues: [], colValues: [], cellHeader: '', grid: [], fontSize: null, startLine: tableDef.startLine, endLine: tableDef.endLine, errors };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        solveRecord, solveEquations, formatOutput, solveEquationInContext, findVariablesInAST, buildVariablesMap
    };
}
