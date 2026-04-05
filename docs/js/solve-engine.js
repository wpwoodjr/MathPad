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
 * Pre-parse equation ASTs onto equation objects (call once, reuse everywhere)
 */
function preParseEquations(equations) {
    for (const eq of equations) {
        if (eq.leftAST !== undefined) continue; // already parsed
        try {
            eq.leftAST = eq.leftText ? parseExpression(eq.leftText) : null;
            eq.rightAST = eq.rightText ? parseExpression(eq.rightText) : null;
            if (eq.leftAST && eq.rightAST) {
                eq.allVars = new Set([
                    ...findVariablesInAST(eq.leftAST),
                    ...findVariablesInAST(eq.rightAST)
                ]);
            } else {
                eq.allVars = new Set();
            }
            eq.parseError = null;
        } catch (e) {
            eq.leftAST = null;
            eq.rightAST = null;
            eq.allVars = new Set();
            eq.parseError = e.message;
        }
    }
}

/**
 * Solve a single equation in context
 */
function solveEquationInContext(eqLine, context, variables, substitutions = new Map(), modN = null, leftAST, rightAST) {
    if (!leftAST || !rightAST) {
        return { solved: false };
    }

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
            if (varInfo.declaration.limits.stepTokens) {
                const stepAST = parseTokens(varInfo.declaration.limits.stepTokens);
                limits.step = evaluate(stepAST, context);
            }
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
 * Solve equations and return computed values (no text modification).
 * Used by both the main solver and table/grid per-row evaluation.
 * @param {EvalContext} context - Context with known variables
 * @param {Array} declarations - Variable declarations (for limits and user-provided tracking)
 * @param {Object} record - Record settings (places, degreesMode, etc.)
 * @param {Array} equations - Equations to solve (from findEquationsAndOutputs)
 * @returns {{ computedValues: Map, solved: number, errors: Array, solveFailures: Map, equationVarStatus: Map }}
 */
// Set to true to enable detailed solve logging in the console
let debugSolve = false;

// Simple AST to string for debug logging
const _astStr = (n) => {
    if (!n) return '?';
    if (n.type === 'NUMBER') return String(n.value);
    if (n.type === 'VARIABLE') return n.name;
    if (n.type === 'BINARY_OP') return `(${_astStr(n.left)} ${n.op} ${_astStr(n.right)})`;
    if (n.type === 'UNARY_OP') return `${n.op}${_astStr(n.operand)}`;
    if (n.type === 'FUNCTION_CALL') return `${n.name}(${(n.args||[]).map(_astStr).join('; ')})`;
    return n.type;
};

let _solvePass = 0;
function solveEquations(context, declarations, record = {}, equations, bodyDefinitions = []) {
    if (debugSolve) console.log(`\n========== solveEquations pass ${++_solvePass} (${equations.length} equations, ${bodyDefinitions.length} bodyDefs) ==========`);
    const places = record.places != null ? record.places : 4;
    const errors = [];
    // Report any equation parse errors from preParseEquations
    for (const eq of equations) {
        if (eq.parseError) errors.push(`Line ${eq.startLine + 1}: ${eq.parseError}`);
    }
    const computedValues = new Map();
    const solveFailures = new Map(); // Track last failure per variable
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
    const erroredEquations = new Set();
    const unsolvedEquations = new Map(); // line → [unknown names]

    while (changed && iterations++ < maxIterations) {
        changed = false;
        if (debugSolve) console.log(`\n=== Iteration ${iterations} ===`);

        // ① Evaluate body definitions (: declarations from table body or outer solve).
        if (debugSolve) console.log(`  --- [1] Body definitions (:defs not yet resolved)${bodyDefinitions.length === 0 ? ' (none)' : ''} ---`);
        for (const { name, ast } of bodyDefinitions) {
            if (!ast || context.hasVariable(name)) continue;
            try {
                const value = evaluate(ast, context);
                context.setVariable(name, value);
                changed = true;
                if (debugSolve) console.log(`    ${name} = ${value}`);
            } catch (e) {
                if (debugSolve) console.log(`    ${name}: deferred (${e.message})`);
            }
        }

        const substitutions = buildSubstitutionMap(equations, context, errors);

        if (debugSolve) {
            console.log('  --- [2] Build substitution map ---');
            if (substitutions.size > 0) {
                for (const [k, subs] of substitutions) {
                    for (const s of subs) {
                        console.log(`    ${k} → ${_astStr(s.ast)} (line:${s.sourceLine + 1})`);
                    }
                }
            } else {
                console.log('    (none)');
            }
        }

        // [3] Evaluate fully-known substitutions — direct computation before Brent's
        if (debugSolve) console.log('  --- [3] Evaluate fully-known substitutions ---');
        for (const [varName, subs] of substitutions) {
            if (context.hasVariable(varName)) continue;
            // Try each sub — use first fully-evaluable one
            let chosen = null;
            for (const sub of subs) {
                if ([...findVariablesInAST(sub.ast)].some(v => !context.hasVariable(v))) continue;
                chosen = sub;
                break;
            }
            if (!chosen) {
                if (debugSolve) {
                    const unknowns = [...findVariablesInAST(subs[0].ast)].filter(v => !context.hasVariable(v));
                    console.log(`    ${varName}: deferred (unknowns: ${unknowns.join(', ')})`);
                }
                continue;
            }
            try {
                const value = evaluate(chosen.ast, context);
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
                                line: chosen.sourceLine
                            });
                            if (debugSolve) console.log(`    ${varName}: outside limits [${low}, ${high}]`);
                            continue;
                        }
                    } catch (e) {
                        // Ignore limit evaluation errors
                    }
                }

                context.setVariable(varName, value);
                computedValues.set(varName, value);
                unsolvedEquations.delete(chosen.sourceLine);
                changed = true;
                solved++;
                if (debugSolve) console.log(`    ${varName} = ${value}`);
            } catch (e) {
                if (debugSolve) console.log(`    ${varName}: eval error (${e.message})`);
                if (!(e instanceof EvalError)) {
                    errors.push(`Line ${chosen.sourceLine + 1}: ${e.message}`);
                }
            }
        }

        // [4] Build sweep subs — only if [3] didn't resolve everything
        // Filter: variables with no value, no limits. Used as skip list for sweep 0
        // and substitutions for sweep 1.
        const definitionSubs = new Map();
        if (!changed) {
            for (const [varName, subs] of substitutions) {
                if (context.hasVariable(varName)) continue;
                const varInfo = variables.get(varName);
                if (varInfo && varInfo.declaration && varInfo.declaration.limits) continue;
                definitionSubs.set(varName, subs[0]);
            }
        }
        if (debugSolve) console.log(`  --- [4] Sweep subs: ${[...definitionSubs.keys()].join(', ') || '(none)'} ---`);

        // [5] Equation solving — two sweeps:
        //   Sweep 0: natural 1-unknown only (no subs), skip if unknown is in [4]
        //   Sweep 1: equations reduced to 1 unknown via [4] subs
        if (debugSolve) console.log('  --- [5] Equation solving (sweep 0: natural, sweep 1: [4] subs) ---');
        for (let sweep = 0; sweep < 2 && !changed; sweep++) {
            const sweepSubs = sweep === 0 ? new Map() : definitionSubs;
            for (const eq of equations) {
                try {
                    // Handle incomplete equations (expr =)
                    if (eq.leftAST && !eq.rightAST) {
                        if (sweep > 0) continue; // already handled
                        try {
                            let ast = eq.leftAST;
                            const subAsts = new Map([...substitutions].map(([k, v]) => [k, v[0].ast]));
                            ast = substituteInAST(ast, subAsts);
                            const value = evaluate(ast, context);
                            computedValues.set(`__incomplete_${eq.startLine}`, value);
                            solved++;
                            if (debugSolve) console.log(`    Incomplete: ${eq.leftText} = ${value}`);
                        } catch (e) {
                            // Unknown variables - skip
                        }
                        continue;
                    }

                    // Definition equations (var = expr): skip if [4] already handled,
                    // or if variable has no value (don't Brent's a bare definition).
                    // Fall through to Brent's only when variable has a value and RHS has unknowns
                    // (e.g., user set x: 5, equation x = a + b → solve for a or b).
                    const def = !eq.modN && isDefinitionEquation(eq.leftText, eq.rightText, eq.rightAST);
                    if (def) {
                        const rhsVars = findVariablesInAST(def.expressionAST);
                        const rhsUnknowns = [...rhsVars].filter(v => !context.hasVariable(v));
                        if (rhsUnknowns.length === 0) { unsolvedEquations.delete(eq.startLine); continue; }
                        if (!context.hasVariable(def.variable)) continue;
                    }

                    // Sweep 0: skip if the natural 1-unknown is in definitionSubs
                    // (it should be substituted away, not solved directly by Brent's)
                    if (sweep === 0 && definitionSubs.size > 0 && eq.allVars) {
                        const eqUnknowns = [...eq.allVars].filter(v => !context.hasVariable(v));
                        if (eqUnknowns.length === 1 && definitionSubs.has(eqUnknowns[0])) continue;
                    }

                    // Try to solve the equation numerically
                    const modValue = eq.modN ? (record.degreesMode ? 360 : 2 * Math.PI) : null;
                    const result = solveEquationInContext(eq.startLine, context, variables,
                        sweepSubs, modValue, eq.leftAST, eq.rightAST);
                    if (result.solved) {
                        context.setVariable(result.variable, result.value);
                        computedValues.set(result.variable, result.value);
                        solveFailures.delete(result.variable);
                        unsolvedEquations.delete(eq.startLine);
                        solved++;
                        changed = true;
                        if (debugSolve) console.log(`    Sweep ${sweep}: Brent's → ${result.variable} = ${result.value} (from "${eq.text.substring(0, 50)}")`);
                        // Restart so Pass 1 can evaluate definitions with the new value,
                        // avoiding a second Brent's step that might pick an inconsistent root
                        break;
                    } else if (result.error && result.variable) {
                        if (sweep > 0) {
                            solveFailures.set(result.variable, { error: result.error, line: eq.startLine });
                            if (debugSolve) console.log(`    Sweep ${sweep}: FAILED ${result.variable} (${result.error})`);
                        }
                    } else if (result.tooManyUnknowns) {
                        if (sweep > 0) {
                            unsolvedEquations.set(eq.startLine, result.tooManyUnknowns);
                            if (debugSolve) console.log(`    Sweep ${sweep}: too many unknowns (${result.tooManyUnknowns.join(', ')})`);
                        }
                    } else {
                        // Equation resolved (all variables known) — clear any previous "too many unknowns"
                        unsolvedEquations.delete(eq.startLine);
                    }
                } catch (e) {
                    if (sweep > 0) {
                        errors.push(`Line ${eq.startLine + 1}: ${e.message}`);
                        erroredEquations.add(eq.startLine);
                    }
                }
            }
        }
    }

    // Report body definitions that still couldn't evaluate
    for (const { name, ast, exprText } of bodyDefinitions) {
        if (!ast || context.hasVariable(name)) continue;
        try { evaluate(ast, context); } catch (e) {
            const lineIndex = (variables.get(name) || {}).lineIndex;
            errors.push(`Line ${(lineIndex != null ? lineIndex : 0) + 1}: Cannot evaluate "${exprText || name}" - ${e.message}`);
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

    // Check equation consistency (reuses precomputed equations)
    // First-wins ordering: a variable's status is set by the first equation it appears in
    const equationVarStatus = new Map(); // var name → 'solved' | 'unsolved'
    for (const eq of equations) {
        try {
            if (!eq.leftAST || !eq.rightAST) continue;
            if (erroredEquations.has(eq.startLine)) continue;

            const unknowns = [...eq.allVars].filter(v => !context.hasVariable(v));

            if (unknowns.length === 0) {
                const leftVal = evaluate(eq.leftAST, context);
                const rightVal = evaluate(eq.rightAST, context);
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
                        const diff = result.difference < 0.001
                            ? parseFloat(result.difference.toPrecision(2))
                            : parseFloat(toFixed(result.difference, result.tolPlaces));
                        errors.push(`Line ${eq.startLine + 1}: Equation doesn't balance: ${eqText} (absolute diff ${diff} >= ${result.tolerance})`);
                    }
                }

                // Only track status for equations where all variables are declared (user-visible)
                if ([...eq.allVars].every(v => variables.has(v))) {
                    const status = balanced ? 'solved' : 'unsolved';
                    for (const v of eq.allVars) {
                        if (!equationVarStatus.has(v)) equationVarStatus.set(v, status);
                    }
                }
            }
        } catch (e) {
            errors.push(`Line ${eq.startLine + 1}: ${e.message}`);
        }
    }

    return { computedValues, solved, errors, solveFailures, equationVarStatus };
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
            // Check for per-declaration re-solve value (multiple outputs with different limits)
            if (computedValues.has(`__resolvevar_${info.lineIndex}`)) {
                value = computedValues.get(`__resolvevar_${info.lineIndex}`);
            } else if (context.variables.has(info.name)) {
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
        t.type === 'grid' ? t.grid.length > 0 : (t.rows && t.rows.length > 0)
    );
    if (!hasTables) return text;

    const lines = ['"--- Table Outputs ---"'];

    for (const table of tables) {
        // Title line
        if (table.title) lines.push(`"${table.title}"`);

        if (table.type === 'grid') {
            if (table.grid.length === 0) continue;
            lines.push(`"${table.iter1Label}"\t"${table.iter2Label}"\t"${table.cellHeader}"`);
            lines.push(`\t${table.colValues.join('\t')}`);
            for (let r = 0; r < table.rowValues.length; r++) {
                lines.push(`${table.rowValues[r]}\t${table.grid[r].join('\t')}`);
            }
        } else {
            if (!table.rows || table.rows.length === 0) continue;
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

    // Pass 1: Variable Discovery (parses declarations, evaluates definitions)
    const discovery = discoverVariables(text, context, record, allTokens, tableLines.size > 0 ? tableLines : null);
    text = discovery.text;
    allTokens = discovery.allTokens;
    const declarations = discovery.declarations;
    const errors = [...(context.functionErrors || []), ...discovery.errors];

    // Save pre-solve variable state for tables (user declarations only)
    const preSolveVars = new Map(context.variables);

    // Find equations and expression outputs
    const { equations: outerEquations, exprOutputs } = findEquationsAndOutputs(text, allTokens, context.localFunctionLines);
    preParseEquations(outerEquations);

    // Build body definitions from declarations that couldn't evaluate during discovery
    // (e.g. x<- pmt*2 where pmt is equation-solved). solveEquations retries these.
    const bodyDefinitions = [];
    for (const decl of declarations) {
        if (decl.valueTokens && decl.valueTokens.length > 0 &&
            decl.value === null &&
            decl.declaration.type !== VarType.OUTPUT) {
            try {
                const exprText = tokensToText(decl.valueTokens).trim();
                bodyDefinitions.push({ name: decl.name, ast: parseTokens(decl.valueTokens), exprText });
            } catch (e) {
                errors.push(`Line ${decl.lineIndex + 1}: Cannot evaluate "${tokensToText(decl.valueTokens).trim()}" - ${e.message}`);
            }
        }
    }

    // Pass 2: Equation Solving
    const solveResult = solveEquations(context, declarations, record, outerEquations, bodyDefinitions);
    errors.push(...solveResult.errors);

    // Update preSolveVars with body definitions resolved by solveEquations
    // (safe: these are INPUT definitions, not equation intermediates)
    for (const { name } of bodyDefinitions) {
        if (context.hasVariable(name)) preSolveVars.set(name, context.getVariable(name));
    }

    // Re-solve for additional output declarations with different limits
    // First output sets the nominal value; subsequent outputs with limits re-solve the equation
    const computedValues = solveResult.computedValues;
    const seenOutputVars = new Set();
    for (const decl of declarations) {
        if (decl.declaration.type !== VarType.OUTPUT) continue;
        if (!seenOutputVars.has(decl.name)) {
            seenOutputVars.add(decl.name); // first output is nominal — skip
            continue;
        }
        // Additional output for same variable — re-solve with this declaration's limits
        if (!decl.declaration.limits) continue; // no limits → just display nominal value
        if (!context.hasVariable(decl.name)) continue; // nominal wasn't solved
        // Find the equation that contains this variable
        for (const eq of outerEquations) {
            if (!eq.leftAST || !eq.rightAST) continue;
            try {
                if (!eq.allVars.has(decl.name)) continue;
                // Build a temporary variables map with this declaration's limits
                const tempVars = buildVariablesMap(declarations);
                tempVars.set(decl.name, decl); // use THIS declaration's limits
                // Temporarily clear the variable so it's the unknown
                const savedValue = context.getVariable(decl.name);
                context.variables.delete(decl.name);
                context.declareVariable(decl.name);
                const modValue = eq.modN ? (record.degreesMode ? 360 : 2 * Math.PI) : null;
                const result = solveEquationInContext(eq.startLine, context, tempVars,
                    new Map(), modValue, eq.leftAST, eq.rightAST);
                // Restore nominal value
                context.setVariable(decl.name, savedValue);
                if (result.solved) {
                    computedValues.set(`__resolvevar_${decl.lineIndex}`, result.value);
                }
                break; // use first matching equation
            } catch (e) { }
        }
    }

    // Evaluate expression outputs
    for (const output of exprOutputs) {
        if (computedValues.has(`__exprout_${output.startLine}`)) continue;
        if (!output.recalculates && output.valueTokens && output.valueTokens.length > 0) continue;
        try {
            const ast = parseTokens(output.exprTokens);
            const value = evaluate(ast, context);
            computedValues.set(`__exprout_${output.startLine}`, {
                value, fullPrecision: output.fullPrecision,
                marker: output.marker, format: output.format, base: output.base
            });
        } catch (e) {
            errors.push(`Line ${output.startLine + 1}: ${e.message}`);
        }
    }

    // Pass 3: Format Output
    const formatResult = formatOutput(text, declarations, context, computedValues, record, solveResult.solveFailures, outerEquations, exprOutputs);
    text = formatResult.text;
    errors.push(...formatResult.errors);

    // Pass 4: Evaluate tables (after all normal solving is complete)
    const tables = [];
    const savedVars = new Map(context.variables);
    for (const td of tableDefs) {
        // Restore outer context so tables don't leak state to each other
        context.variables = new Map(savedVars);
        const tableResult = evaluateTable(td, context, record, outerEquations, preSolveVars);
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
 * Evaluate a table definition (unified 1D/2D).
 * Parses body for iterators (x<- 0..4), unknowns (z<-), definitions (v: 10),
 * outputs (z->), and equations. Dimensionality determined by iterator count.
 */
function evaluateTable(tableDef, context, record, outerEquations, preSolveVars) {
    const errors = [];
    const isGrid = tableDef.keyword === 'grid' || tableDef.keyword === 'gridgraph';
    const emptyResult = () => isGrid
        ? { type: 'grid', title: tableDef.title, iter1Label: '', iter2Label: '', rowValues: [], colValues: [], cellHeader: '', grid: [], fontSize: null, startLine: tableDef.startLine, endLine: tableDef.endLine, errors }
        : { type: 'table', title: tableDef.title, columns: [], rows: [], fontSize: null, startLine: tableDef.startLine, endLine: tableDef.endLine, errors };

    // Evaluate optional font size
    let fontSize = null;
    if (tableDef.fontSizeExpr) {
        try { fontSize = evaluate(parseExpression(tableDef.fontSizeExpr), context); } catch (e) { }
    }

    // Parse body lines: iterators, definitions, unknowns, outputs, equations
    const bodyTokens = new Tokenizer(tableDef.bodyText).tokenize();
    const iterators = [];    // { name, startExpr, endExpr, stepExpr, header }
    const definitions = [];  // { name, exprText, limits }
    const unknowns = [];     // { name, limits }
    const columns = [];      // { name, header, format, fullPrecision, base, limits, ast }
    const declaredNames = new Set(); // track duplicate input declarations

    for (let i = 0; i < bodyTokens.length; i++) {
        const lineTokens = bodyTokens[i].filter(t => t.type !== TokenType.EOF);
        if (lineTokens.length === 0) continue;

        const parsed = parseMarkedLine(tableDef.bodyLines[i] || '', lineTokens);
        if (!parsed) continue;

        if (parsed.kind === 'declaration') {
            // Check for duplicate input declarations
            if (parsed.type === VarType.INPUT && declaredNames.has(parsed.name)) {
                errors.push(`Line ${tableDef.startLine + i}: Variable "${parsed.name}" is already defined`);
                continue;
            }
            if (parsed.type === VarType.INPUT) {
                declaredNames.add(parsed.name);
                // Check if valueTokens contain DOT_DOT → iterator
                const hasDotDot = parsed.valueTokens && parsed.valueTokens.some(t => t.type === TokenType.DOT_DOT);
                if (hasDotDot) {
                    // Parse range: start..end or start..end..step
                    const parts = [[]];
                    for (const t of parsed.valueTokens) {
                        if (t.type === TokenType.DOT_DOT) parts.push([]);
                        else parts[parts.length - 1].push(t);
                    }
                    if (parts.length >= 2) {
                        iterators.push({
                            name: parsed.name,
                            startExpr: tokensToText(parts[0]).trim(),
                            endExpr: tokensToText(parts[1]).trim(),
                            stepExpr: parts.length >= 3 ? tokensToText(parts[2]).trim() : null,
                            header: (parsed.label && parsed.label.trim()) || parsed.name,
                            lineIdx: i
                        });
                    }
                } else if (parsed.valueTokens && parsed.valueTokens.length > 0) {
                    // Definition with expression
                    const exprText = parsed.valueTokens.map(t => (t.ws || '') + (typeof t.value === 'object' ? t.value.raw || t.value : t.value)).join('');
                    definitions.push({ name: parsed.name, exprText, limits: parsed.limits || null, lineIdx: i });
                } else {
                    // Bare declaration → unknown for equation solving
                    unknowns.push({ name: parsed.name, limits: parsed.limits || null, lineIdx: i });
                }
            } else if (parsed.type === VarType.OUTPUT) {
                columns.push({
                    name: parsed.name,
                    header: (parsed.label && parsed.label.trim()) || parsed.name,
                    format: parsed.format || null,
                    fullPrecision: parsed.fullPrecision || false,
                    base: parsed.base || 10,
                    limits: parsed.limits || null
                });
            }
        } else if (parsed.kind === 'expression-output') {
            const exprText = tokensToText(parsed.exprTokens).trim();
            const name = parsed.name || exprText;
            let ast = null;
            try { ast = parseExpression(exprText); } catch (e) {
                errors.push(`Line ${tableDef.startLine}: Error in table expression '${exprText}' — ${e.message}`);
            }
            columns.push({
                name, header: (parsed.label && parsed.label.trim()) || name,
                format: parsed.format || null, fullPrecision: parsed.fullPrecision || false,
                base: parsed.base || 10, limits: parsed.limits || null, ast
            });
        }
    }

    // Find equations in body — if none, inherit outer equations from the record
    const bodyEqs = findEquationsAndOutputs(tableDef.bodyText, bodyTokens, null);
    const equations = bodyEqs.equations.length > 0 ? bodyEqs.equations : (outerEquations || []);
    preParseEquations(equations); // no-op if outer equations already parsed

    // Pre-parse definition expressions
    const defASTs = [];
    for (const def of definitions) {
        if (!def.exprText) { defASTs.push({ name: def.name, ast: null }); continue; }
        try { defASTs.push({ name: def.name, ast: parseExpression(def.exprText.trim()) }); }
        catch (e) { defASTs.push({ name: def.name, ast: null }); }
    }
    // Add unknowns as bare entries (no AST)
    for (const unk of unknowns) {
        defASTs.push({ name: unk.name, ast: null });
    }

    const defNames = new Set(defASTs.filter(d => d.ast).map(d => d.name));

    // Pre-evaluate body definitions needed for iterator bounds
    // (e.g., lastPmt: years*pmtsYr - pmtDue used in paymentNum: 0..lastPmt)
    for (const { name, ast } of defASTs) {
        if (!ast) continue;
        try {
            context.setVariable(name, evaluate(ast, context));
        } catch (e) {
            // May depend on iterators or unknowns — skip, will be evaluated later
        }
    }

    // Evaluate iterator bounds
    const evaledIterators = [];
    for (const iter of iterators) {
        try {
            const start = evaluate(parseExpression(iter.startExpr), context);
            const end = evaluate(parseExpression(iter.endExpr), context);
            let step;
            if (iter.stepExpr) {
                step = evaluate(parseExpression(iter.stepExpr), context);
            } else {
                step = start <= end ? 1 : -1;
            }
            if (step === 0) {
                errors.push(`Line ${tableDef.startLine}: Table step cannot be zero for '${iter.name}'`);
                return emptyResult();
            }
            evaledIterators.push({ ...iter, start, end, step });
        } catch (e) {
            errors.push(`Line ${tableDef.startLine}: Table bounds error for '${iter.name}' — ${e.message}`);
            return emptyResult();
        }
    }

    // Check for unused declared variables (iterators, unknowns, definitions)
    const referencedVars = new Set();
    for (const eq of equations) {
        for (const v of eq.allVars) referencedVars.add(v);
    }
    for (const def of definitions) {
        if (def.exprText) {
            try {
                for (const v of findVariablesInAST(parseExpression(def.exprText.trim()))) referencedVars.add(v);
            } catch (e) { }
        }
    }
    for (const col of columns) {
        if (col.ast) {
            for (const v of findVariablesInAST(col.ast)) referencedVars.add(v);
        }
        referencedVars.add(col.name);
    }
    for (const iter of iterators) {
        // Include variables used in iterator bounds (e.g., lastPmt in 0..lastPmt)
        for (const expr of [iter.startExpr, iter.endExpr, iter.stepExpr]) {
            if (expr) {
                try { for (const v of findVariablesInAST(parseExpression(expr))) referencedVars.add(v); }
                catch (e) { }
            }
        }
        if (!referencedVars.has(iter.name)) {
            errors.push(`Line ${tableDef.startLine + iter.lineIdx}: Table variable '${iter.name}' is not used in any equation or output`);
        }
    }
    for (const unk of unknowns) {
        if (!referencedVars.has(unk.name)) {
            errors.push(`Line ${tableDef.startLine + unk.lineIdx}: Table variable '${unk.name}' is not used in any equation or output`);
        }
    }
    for (const def of definitions) {
        if (!referencedVars.has(def.name)) {
            errors.push(`Line ${tableDef.startLine + def.lineIdx}: Table variable '${def.name}' is not used in any equation or output`);
        }
    }

    // Expand \expr\ in title before iteration modifies context
    const expandedTitle = tableDef.title ? expandInlineExprs(tableDef.title, context, record) : '';

    const formatOpts = {
        places: record.places != null ? record.places : 4,
        stripZeros: record.stripZeros !== false,
        numberFormat: record.format || 'float',
        groupDigits: record.groupDigits || false
    };

    // Build variables map with limits from declarations
    function buildTableVarsMap() {
        const tableVarDecls = [];
        for (const def of definitions) {
            if (def.limits) tableVarDecls.push({ name: def.name, declaration: { limits: def.limits }, value: null });
        }
        for (const unk of unknowns) {
            if (unk.limits) tableVarDecls.push({ name: unk.name, declaration: { limits: unk.limits }, value: null });
        }
        for (const col of columns) {
            if (col.limits) tableVarDecls.push({ name: col.name, declaration: { limits: col.limits }, value: null });
        }
        return buildVariablesMap(tableVarDecls, context);
    }

    // Build declarations for solveEquations from table body definitions and limits
    const tableDeclarations = [];
    for (const def of definitions) {
        tableDeclarations.push({
            name: def.name, value: null,
            declaration: { type: VarType.INPUT, limits: def.limits || null }
        });
    }
    for (const unk of unknowns) {
        tableDeclarations.push({
            name: unk.name, value: null,
            declaration: { type: VarType.INPUT, limits: unk.limits || null }
        });
    }
    for (const col of columns) {
        if (col.limits) {
            tableDeclarations.push({
                name: col.name, value: null,
                declaration: { type: VarType.OUTPUT, limits: col.limits }
            });
        }
    }

    // Pre-parse and filter equations containing unknowns (constant across all cells)
    const unknownNames = new Set(unknowns.map(u => u.name));
    const balancePlaces = record.places != null ? record.places : 4;
    const balanceEquations = [];
    for (const eq of equations) {
        if (!eq.leftAST || !eq.rightAST) continue;
        if ([...eq.allVars].some(v => unknownNames.has(v))) {
            balanceEquations.push({ leftAST: eq.leftAST, rightAST: eq.rightAST, modN: eq.modN });
        }
    }

    // Shared per-cell evaluation: reset context, set up variables, solve via solveEquations
    function evaluateCell(iterValues) {
        // Reset to pre-solve state (user declarations only, no equation-computed values)
        if (preSolveVars) context.variables = new Map(preSolveVars);
        // Clear body variables for re-evaluation per row
        for (const { name, ast } of defASTs) {
            context.variables.delete(name);
            if (!ast) context.declareVariable(name); // unknowns need declaration
        }
        // Set iterators
        for (const iv of iterValues) {
            context.setVariable(iv.name, iv.value);
        }
        // Solve with body definitions handled inside the iterative loop
        const solveResult = solveEquations(context, tableDeclarations, record, equations, defASTs);
        // Collect variables that failed to solve
        const badVars = new Set();
        for (const [varName, failure] of solveResult.solveFailures) {
            badVars.add(varName);
        }
        // Per-cell balance check: verify pre-parsed equations containing unknowns
        for (const beq of balanceEquations) {
            try {
                const leftVal = evaluate(beq.leftAST, context);
                const rightVal = evaluate(beq.rightAST, context);
                const modN = beq.modN ? (record.degreesMode ? 360 : 2 * Math.PI) : null;
                const result = modN
                    ? modCheckBalance(leftVal, rightVal, modN, balancePlaces)
                    : checkBalance(leftVal, rightVal, balancePlaces);
                if (!result.balanced) {
                    for (const unk of unknowns) badVars.add(unk.name);
                    break;
                }
            } catch (e) { }
        }
        return badVars;
    }

    // ==================== TABLE and TABLEGRAPH (columnar) ====================
    if (tableDef.keyword === 'table' || tableDef.keyword === 'tablegraph') {
        const iter = evaledIterators[0];
        if (!iter) {
            errors.push(`Line ${tableDef.startLine}: Table has no iterator (use x<- 0..10)`);
            return emptyResult();
        }

        const rows = [];
        const rawRows = [];
        let prevValues = new Map();
        const maxRows = 10000;

        for (let rowCount = 0; ; rowCount++) {
            const val = iter.start + rowCount * iter.step;
            if (iter.step > 0 ? val > iter.end : val < iter.end) break;
            if (rowCount >= maxRows) { errors.push(`Line ${tableDef.startLine}: Table exceeded ${maxRows} rows`); break; }

            context.preSolveValues = rowCount === 0 ? new Map() : prevValues;
            const badVars = evaluateCell([{ name: iter.name, value: val }]);

            // Collect output values (formatted and raw)
            const row = [];
            const rawRow = [];
            for (const col of columns) {
                if (badVars.has(col.name)) { row.push(''); rawRow.push(null); continue; }
                let value;
                if (col.ast) {
                    try { value = evaluate(col.ast, context); } catch (e) { }
                } else {
                    value = context.getVariable(col.name);
                }
                if (value !== undefined) {
                    row.push(formatVariableValue(value, col.format, col.fullPrecision, formatOpts));
                    rawRow.push(value);
                } else { row.push(''); rawRow.push(null); }
            }
            rows.push(row);
            rawRows.push(rawRow);

            // Capture for next row's pre-solve
            prevValues = new Map();
            for (const { name } of defASTs) {
                const v = context.getVariable(name);
                if (v !== undefined) prevValues.set(name, v);
            }
            for (const col of columns) {
                if (!col.ast) { const v = context.getVariable(col.name); if (v !== undefined) prevValues.set(col.name, v); }
            }
            prevValues.set(iter.name, val);
        }

        const type = tableDef.keyword === 'tablegraph' ? 'graph' : 'table';
        return { type, title: expandedTitle, columns, rows, rawRows, formatOpts, fontSize, startLine: tableDef.startLine, endLine: tableDef.endLine, errors };
    }

    // ==================== GRID (2D cell values) ====================
    if (evaledIterators.length < 2) {
        errors.push(`Line ${tableDef.startLine}: Grid requires at least 2 iterators (use x<- 0..10)`);
        return emptyResult();
    }
    // Iterator declaration order determines axes: first = rows, second = columns
    // Output declaration order determines display: first = row headers, second = col headers, third = cell value
    const iter1 = evaledIterators[0];
    const iter2 = evaledIterators[1];

    const rowHeaderCol = columns.length > 0 ? columns[0] : null;
    const colHeaderCol = columns.length > 1 ? columns[1] : null;
    const cellVar = columns.length > 2 ? columns[2] : null;

    const iter1Label = rowHeaderCol ? rowHeaderCol.header || iter1.header : iter1.header;
    const iter2Label = colHeaderCol ? colHeaderCol.header || iter2.header : iter2.header;
    const iter1Format = rowHeaderCol ? rowHeaderCol.format : null;
    const iter2Format = colHeaderCol ? colHeaderCol.format : null;
    const iter1FullPrec = rowHeaderCol ? rowHeaderCol.fullPrecision : false;
    const iter2FullPrec = colHeaderCol ? colHeaderCol.fullPrecision : false;

    // Build value arrays
    const rowValues = [];
    for (let i = 0; ; i++) {
        const v = iter1.start + i * iter1.step;
        if (iter1.step > 0 ? v > iter1.end : v < iter1.end) break;
        rowValues.push(v); if (rowValues.length > 10000) break;
    }
    const colValues = [];
    for (let i = 0; ; i++) {
        const v = iter2.start + i * iter2.step;
        if (iter2.step > 0 ? v > iter2.end : v < iter2.end) break;
        colValues.push(v); if (colValues.length > 10000) break;
    }

    // Helper: get output value from a column spec after cell evaluation
    function getColValue(col) {
        if (!col) return undefined;
        if (col.ast) {
            try { return evaluate(col.ast, context); } catch (e) { return undefined; }
        }
        return context.getVariable(col.name);
    }

    const isGridGraph = tableDef.keyword === 'gridgraph';
    const grid = [];
    const rawGrid = [];
    const rawRowHeaderValues = [];
    const rawColHeaderValues = [];
    const formattedRowValues = [];
    const formattedColValues = [];
    for (let r = 0; r < rowValues.length; r++) {
        const gridRow = [];
        const rawGridRow = [];
        for (let c = 0; c < colValues.length; c++) {
            context.preSolveValues = new Map();
            const badVars = evaluateCell([
                { name: iter1.name, value: rowValues[r] },
                { name: iter2.name, value: colValues[c] }
            ]);

            // Row headers: use first output value from first column
            if (c === 0) {
                const v = rowHeaderCol ? getColValue(rowHeaderCol) : undefined;
                const rawV = v !== undefined ? v : rowValues[r];
                rawRowHeaderValues.push(rawV);
                formattedRowValues.push(formatVariableValue(rawV, iter1Format, iter1FullPrec, formatOpts));
            }
            // Column headers: use second output value from first row
            if (r === 0) {
                const v = colHeaderCol ? getColValue(colHeaderCol) : undefined;
                const rawV = v !== undefined ? v : colValues[c];
                rawColHeaderValues.push(rawV);
                formattedColValues.push(formatVariableValue(rawV, iter2Format, iter2FullPrec, formatOpts));
            }

            // Cell value: third output
            if (cellVar && !badVars.has(cellVar.name)) {
                const value = getColValue(cellVar);
                if (value !== undefined) {
                    gridRow.push(formatVariableValue(value, cellVar.format, cellVar.fullPrecision, formatOpts));
                    rawGridRow.push(value);
                } else { gridRow.push(''); rawGridRow.push(null); }
            } else { gridRow.push(''); rawGridRow.push(null); }
        }
        grid.push(gridRow);
        rawGrid.push(rawGridRow);
    }

    const type = isGridGraph ? 'gridGraph' : 'grid';
    return {
        type, title: expandedTitle,
        iter1Label, iter2Label,
        rowValues: formattedRowValues,
        colValues: formattedColValues,
        rawRowHeaderValues, rawColHeaderValues, rawGrid,
        columns, formatOpts,
        cellHeader: cellVar ? cellVar.header : '',
        grid, fontSize,
        startLine: tableDef.startLine, endLine: tableDef.endLine, errors
    };
}


// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        solveRecord, solveEquations, formatOutput, solveEquationInContext, findVariablesInAST, buildVariablesMap
    };
}
