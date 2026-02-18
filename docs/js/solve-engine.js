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
function solveEquationInContext(eqText, eqLine, context, variables, substitutions = new Map(), leftText, rightText) {
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
    if (unknowns.length > 1 && substitutions.size > 0) {
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
        return { solved: false };
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
    // Derive balance tolerance from decimal places: 0.5 * 10^(-places)
    // This matches rounding precision - if diff < tolerance, values display the same
    const places = record.places != null ? record.places : 4;
    const balanceTolerance = 0.5 * Math.pow(10, -places);
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
    const { equations, exprOutputs } = findEquationsAndOutputs(text, allTokens);

    // Iterative solving
    const maxIterations = 50;
    let iterations = 0;
    let changed = true;

    while (changed && iterations++ < maxIterations) {
        changed = false;

        const substitutions = buildSubstitutionMap(equations, context, errors);

        for (const eq of equations) {
            try {
                // Skip equations with unevaluated inline expressions
                if (eq.text.includes('\\')) continue;

                // Handle incomplete equations (expr =)
                if (eq.leftText && !eq.rightText) {
                    try {
                        let ast = parseExpression(eq.leftText);
                        // Extract just the ASTs from substitutions for evaluation
                        const subAsts = new Map([...substitutions].map(([k, v]) => [k, v.ast]));
                        ast = substituteInAST(ast, subAsts);
                        const value = evaluate(ast, context);
                        // Store result but don't modify text
                        computedValues.set(`__incomplete_${eq.startLine}`, value);
                        solved++;
                    } catch (e) {
                        // Unknown variables - skip
                    }
                    continue;
                }

                // Handle definition equations (var = expr)
                const def = isDefinitionEquation(eq.text, eq.leftText, eq.rightText);
                if (def) {
                    const varInfo = variables.get(def.variable);
                    const rhsVars = findVariablesInAST(def.expressionAST);
                    const rhsUnknowns = [...rhsVars].filter(v => !context.hasVariable(v));

                    // If user provided value and RHS has unknowns, use equation to solve
                    if (varInfo && varInfo.value !== null && userProvidedVars.has(def.variable)) {
                        context.setVariable(def.variable, varInfo.value);
                        if (rhsUnknowns.length === 0) continue;
                    }

                    // Skip if variable already computed and RHS is fully known (nothing to solve)
                    if (context.hasVariable(def.variable) && !userProvidedVars.has(def.variable)) {
                        if (rhsUnknowns.length === 0) continue;
                        // Has unknowns in RHS - fall through to numerical solving
                    }

                    // If RHS is fully known, evaluate and set variable
                    if (rhsUnknowns.length === 0) {
                        try {
                            // Extract just the ASTs from substitutions for evaluation
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

                            context.setVariable(def.variable, value);
                            computedValues.set(def.variable, value);
                            changed = true;
                            solved++;
                        } catch (e) {
                            // Skip
                        }
                        continue;
                    }

                    if (!userProvidedVars.has(def.variable) && !context.hasVariable(def.variable)) continue;
                }

                // Try to solve the equation numerically (substitutions will be applied)
                const result = solveEquationInContext(eq.text, eq.startLine, context, variables, substitutions, eq.leftText, eq.rightText);
                if (result.solved) {
                    context.setVariable(result.variable, result.value);
                    computedValues.set(result.variable, result.value);
                    solveFailures.delete(result.variable); // Clear any previous failure
                    solved++;
                    changed = true;
                } else if (result.error && result.variable) {
                    // Track the failure for this variable (line number for error reporting)
                    solveFailures.set(result.variable, { error: result.error, line: eq.startLine });
                }
            } catch (e) {
                errors.push(`Line ${eq.startLine + 1}: ${e.message}`);
            }
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

            const leftAST = parseExpression(eq.leftText);
            const rightAST = parseExpression(eq.rightText);

            const allVars = new Set([...findVariablesInAST(leftAST), ...findVariablesInAST(rightAST)]);
            const unknowns = [...allVars].filter(v => !context.hasVariable(v));

            if (unknowns.length === 0) {
                const leftVal = evaluate(leftAST, context);
                const rightVal = evaluate(rightAST, context);
                const balanced = checkBalance(leftVal, rightVal, balanceTolerance);

                if (!balanced) {
                    errors.push(`Line ${eq.startLine + 1}: Equation doesn't balance: ${eq.text} (${leftVal} ≠ ${rightVal})`);
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
            // Ignore consistency check errors
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
                // Check if there was a solve failure for this variable (e.g., limits violation)
                const failure = solveFailures.get(info.name);
                if (failure) {
                    errors.push(`Line ${info.lineIndex + 1}: ${failure.error} for '${info.name}'`);
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
            const formatted = formatVariableValue(value, decl.format, decl.fullPrecision, {
                places: format.places,
                stripZeros: format.stripZeros,
                numberFormat: format.format,
                base: decl.base,
                groupDigits: format.groupDigits
            });
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
            const formatted = varFormat
                ? formatVariableValue(value, varFormat, fullPrecision, format)
                : formatNumber(value, places, format.stripZeros, format.format, exprBase || 10, format.groupDigits);

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
    // Remove everything from "--- Reference Constants and Functions ---" to end
    const pattern = /\n*"--- Reference Constants and Functions ---"[\s\S]*$/;
    return text.replace(pattern, '');
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

    // Add constants (skip those shadowed by local variables)
    for (const name of [...usedConstants].sort()) {
        // Skip if local variable shadows this constant
        if (context.variables.has(name)) {
            continue;
        }
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

    // Capture pre-solve values for output variables (before they are cleared)
    // These are available via the ? operator and as fallback in getVariable()
    context.preSolveValues = capturePreSolveValues(text, allTokens);

    // Clear output variables and expression outputs so they become unknowns for solving
    // Uses 'solve' mode to also clear persistent outputs (=> =>>)
    const clearResult = clearVariables(text, 'solve', allTokens);
    text = clearResult.text;
    allTokens = clearResult.allTokens;

    // Clear usage tracking from any previous solve
    context.clearUsageTracking();

    // Pass 1: Variable Discovery (evaluates \expr\, parses declarations)
    const discovery = discoverVariables(text, context, record, allTokens);
    text = discovery.text;
    allTokens = discovery.allTokens;
    const declarations = discovery.declarations;
    const errors = [...discovery.errors];

    // Pass 2: Equation Solving (computes values, no text modification)
    const solveResult = solveEquations(text, context, declarations, record, allTokens, discovery.earlyExprOutputs);
    errors.push(...solveResult.errors);

    // Pass 3: Format Output (inserts values into text, reuses equations/exprOutputs from pass 2)
    const formatResult = formatOutput(text, declarations, context, solveResult.computedValues, record, solveResult.solveFailures, solveResult.equations, solveResult.exprOutputs);
    text = formatResult.text;
    errors.push(...formatResult.errors);

    // Pass 4: Append references section showing used constants and functions
    // Skip for reference records (Constants, Functions, Default Settings)
    const isInReferenceCategory = record.category === 'Reference';
    if (!isInReferenceCategory) {
        text = appendReferencesSection(text, context);
    }

    return { text, solved: solveResult.solved, errors, equationVarStatus: solveResult.equationVarStatus };
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        solveRecord, solveEquations, formatOutput, solveEquationInContext, findVariablesInAST, buildVariablesMap
    };
}
