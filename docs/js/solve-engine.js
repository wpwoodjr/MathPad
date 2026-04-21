/**
 * MathPad Solve Engine - Main solving orchestration
 * Extracted from ui.js for better separation of concerns
 */

/**
 * Build the solver's variables map from the declarations array. Contains
 * only INPUT declarations (OUTPUTs are display instructions, not solver
 * constraints — handled separately by resolveWithLimits and formatOutput).
 * First-wins on duplicate INPUT names.
 */
function buildVariablesMap(declarations) {
    const map = new Map();
    for (const info of declarations) {
        if (info.declaration.type === VarType.OUTPUT) continue;
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
 *
 * @param {Object} [options] - { allRoots: boolean }. When true, returns all Brent's roots
 *                             in preference order (result.values array) instead of just
 *                             the single best root (result.value). Used by the recursive
 *                             solver to enumerate candidates for backtracking.
 */
function solveEquationInContext(eqLine, context, variables, substitutions = new Map(), modN = null, leftAST, rightAST, { allRoots = false } = {}) {
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

    // Get search limits if specified. Variables map contains only INPUTs
    // (OUTPUT limits are display instructions handled by resolveWithLimits).
    let limits = null;
    const varInfo = variables.get(unknown);
    if (varInfo && varInfo.declaration && varInfo.declaration.limits) {
        try {
            const lowAST = parseTokens(varInfo.declaration.limits.lowTokens);
            const highAST = parseTokens(varInfo.declaration.limits.highTokens);
            let low = evaluate(lowAST, context);
            let high = evaluate(highAST, context);
            // For angular variables (° format) with wraparound (low > high after mod),
            // shift the search range to span the arc going from low through 0 to high.
            // E.g., degrees [350:10] → [350:370], radians [6.1:0.1] → [6.1:6.38].
            const isAngular = varInfo.declaration.format === 'degrees';
            if (isAngular) {
                const M = context.degreesMode ? 360 : 2 * Math.PI;
                const modM = (x) => ((x % M) + M) % M;
                if (modM(low) > modM(high)) {
                    const arcLen = modM(high - low);
                    low = modM(low);
                    high = low + arcLen;
                }
            }
            limits = { low, high };
            if (varInfo.declaration.limits.stepTokens) {
                const stepAST = parseTokens(varInfo.declaration.limits.stepTokens);
                limits.step = evaluate(stepAST, context);
            }
        } catch (e) {
            // Limits can't evaluate yet — defer this variable.
            // Iterative loop will retry once dependencies are solved.
            // If still unevaluable after convergence, end-of-solve validation reports it.
            return { solved: false, limitsDeferred: true };
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
        const result = solveEquation(f, limits, knownScale, modN, { allRoots });
        if (allRoots) {
            return {
                solved: true,
                variable: unknown,
                values: result // array in preference order
            };
        }
        return {
            solved: true,
            variable: unknown,
            value: result
        };
    } catch (e) {
        // Solving failed (e.g., couldn't bracket root)
        return { solved: false, error: e.message, variable: unknown };
    }
}

/**
 * Re-solve a variable using its OUTPUT declaration's limits via the full
 * solveEquations pipeline. Used for OUTPUT-with-limits display (e.g.
 * `z[0:10]->`) — the display instruction gets its own complete solve
 * independent of the main solve's choices.
 *
 * @param {string} varName
 * @param {Object} decl - Object with `.limits` and optional `.format`. Outer
 *     caller passes `decl.declaration` (full parser decl); table caller
 *     passes the column spec (`{ limits, format, ... }`).
 * @param {Array} equations - Equations to consult
 * @param {Array} declarations - Declarations array (target is filtered out
 *     and replaced by a single INPUT entry carrying the OUTPUT's limits)
 * @param {EvalContext} context
 * @param {Object} record - Record settings (degreesMode, places, ...)
 * @param {Map} preSolveVars - Pre-solve variable state to reset to
 * @param {number} [targetLineIndex] - Line of the OUTPUT declaration being
 *     re-solved; used as the lineIndex of the replacement entry so any
 *     slow-path error about the target points at the right line.
 * @returns {{ value, reason, errors }} reason: 'noEquation' | 'noRoot' | null.
 *     `errors` is slow-path's error list (empty on fast path / noEquation).
 */
function resolveWithLimits(varName, decl, equations, declarations, context, record, preSolveVars, targetLineIndex) {
    const limits = decl.limits;

    // Check if any equation references this variable
    const hasEquation = equations.some(eq =>
        eq.leftAST && eq.rightAST && eq.allVars && eq.allVars.has(varName));
    if (!hasEquation) return { value: undefined, reason: 'noEquation', errors: [] };

    // Angular-aware in-limits check (mirrors applyDirectValue lines 468-486)
    function valueInLimits(value) {
        if (!limits) return true;
        try {
            const low = evaluate(parseTokens(limits.lowTokens), context);
            const high = evaluate(parseTokens(limits.highTokens), context);
            const isAngular = decl.format === 'degrees';
            if (isAngular) {
                const M = record.degreesMode ? 360 : 2 * Math.PI;
                const modM = (x) => ((x % M) + M) % M;
                let arcLen = modM(high - low);
                if (arcLen === 0 && low !== high) arcLen = M;
                return modM(value - low) <= arcLen;
            }
            const lo = Math.min(low, high), hi = Math.max(low, high);
            return value >= lo && value <= hi;
        } catch (e) {
            return false;
        }
    }

    // Fast path: main-solve value already in limits → use it
    if (context.variables.has(varName)) {
        const value = context.variables.get(varName);
        if (valueInLimits(value)) return { value, reason: null, errors: [] };
    }

    // Slow path: full pipeline re-solve with OUTPUT's limits.
    // Prepend a single INPUT entry for the target carrying the OUTPUT's
    // limits and (if provided) the correct re-solve-target lineIndex.
    // buildVariablesMap is first-wins and filters out OUTPUTs, so this
    // entry naturally wins over any other declarations for the same name.
    // Slow-path errors about the target then point at the current
    // re-solved OUTPUT's line.
    const modifiedDecls = [
        {
            name: varName,
            value: null,
            lineIndex: targetLineIndex != null ? targetLineIndex : 0,
            declaration: {
                type: VarType.INPUT,
                limits,
                format: decl.format
            }
        },
        ...declarations
    ];

    // Reset to pre-solve state; delete target so re-solve treats it as unknown.
    const savedVars = new Map(context.variables);
    if (preSolveVars) context.variables = new Map(preSolveVars);
    context.variables.delete(varName);
    let solveResult;
    try {
        solveResult = solveEquations(context, modifiedDecls, record, equations);
    } catch (e) {
        context.variables = savedVars;
        return { value: undefined, reason: 'noRoot', errors: [] };
    }
    const value = context.variables.has(varName) ? context.variables.get(varName) : undefined;
    context.variables = savedVars;

    const errors = (solveResult && solveResult.errors) || [];
    if (value !== undefined && valueInLimits(value)) {
        return { value, reason: null, errors };
    }
    return { value: undefined, reason: 'noRoot', errors };
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
// Trace buffer: null = disabled, [] = collecting lines for user-visible output.
// Set by solveRecord(..., traceMode=true) for the outer solve only.
let _traceBuffer = null;
function _trace(msg) {
    if (_traceBuffer !== null) _traceBuffer.push(msg);
}

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

/**
 * Check whether every variable referenced by an AST is already in context.
 * Used to split body definitions into pre-recursion and in-recursion phases:
 * fully-known defs (e.g. `r: rand()` with no deps, `r: rate/100/12` when rate is
 * a user input) evaluate exactly once before the recursive solver starts.
 */
function isFullyKnownAST(ast, context) {
    if (!ast) return false;
    for (const v of findVariablesInAST(ast)) {
        if (!context.hasVariable(v)) return false;
    }
    return true;
}

/**
 * Boolean terminal check for the recursive solver: returns true iff all
 * `requiredVars` have values AND every fully-evaluable equation balances.
 *
 * NaN handling: equations where either side evaluates to NaN are treated as
 * unverifiable (not as failures). This matches the semantics the user wants
 * for Test 7 (a = sqrt(-b) with a=6, b=3 is degenerate but shouldn't block
 * the solve) — the final post-recursion balance pass still reports it as
 * a user-visible error.
 *
 * `requiredVars` is the Set of variables that were unknown at the start of
 * the solve. This guard prevents a trivially-empty no-progress state from
 * returning true: a record where nothing got solved must not be mistaken
 * for "balanced".
 */
function checkAllEquationsBalance(context, equations, record, places, requiredVars, erroredEquations) {
    for (const v of requiredVars) {
        if (!context.hasVariable(v)) return false;
    }
    for (const eq of equations) {
        if (!eq.leftAST || !eq.rightAST) continue;
        if (erroredEquations && erroredEquations.has(eq.startLine)) continue;
        const unknowns = [...eq.allVars].filter(v => !context.hasVariable(v));
        if (unknowns.length > 0) continue; // not yet fully evaluable — skip
        let leftVal, rightVal;
        try {
            leftVal = evaluate(eq.leftAST, context);
            rightVal = evaluate(eq.rightAST, context);
        } catch (e) {
            // Evaluation error — treat as unverifiable, not a failure.
            // (The post-recursion pass reports it to the user.)
            continue;
        }
        // NaN on either side: unverifiable, skip.
        if (!Number.isFinite(leftVal) || !Number.isFinite(rightVal)) continue;
        const result = eq.modN
            ? modCheckBalance(leftVal, rightVal, record.degreesMode ? 360 : 2 * Math.PI, places)
            : checkBalance(leftVal, rightVal, places);
        if (!result.balanced) return false;
    }
    return true;
}

/**
 * Capture the minimum state needed to roll a recursive branch back.
 * See the big comment in restoreState for what is and isn't snapshotted.
 */
function snapshotState(context, solveFailures, unsolvedEquations, erroredEquations, computedValues, errors, solved) {
    return {
        variables: new Map(context.variables),
        solveFailures: new Map(solveFailures),
        unsolvedEquations: new Map(unsolvedEquations),
        erroredEquations: new Set(erroredEquations),
        computedValues: new Map(computedValues),
        errorsLen: errors.length,
        solved,
    };
}

/**
 * Roll a branch back to a snapshot. REPLACES context.variables with a fresh
 * Map (doesn't merge), so no code outside solveEquations may hold a reference
 * to context.variables across a restore call.
 *
 * NOT restored (append-only): context.constants, context.userFunctions,
 * context.usedConstants, context.usedFunctions, context.preSolveValues.
 * Small leakage on rejected branches is accepted — these only affect the
 * "Reference Constants and Functions" section and don't change solve
 * correctness.
 */
function restoreState(context, solveFailures, unsolvedEquations, erroredEquations, computedValues, errors, snap) {
    context.variables = new Map(snap.variables);
    solveFailures.clear();
    for (const [k, v] of snap.solveFailures) solveFailures.set(k, v);
    unsolvedEquations.clear();
    for (const [k, v] of snap.unsolvedEquations) unsolvedEquations.set(k, v);
    erroredEquations.clear();
    for (const v of snap.erroredEquations) erroredEquations.add(v);
    computedValues.clear();
    for (const [k, v] of snap.computedValues) computedValues.set(k, v);
    errors.length = snap.errorsLen;
    return snap.solved;
}

/**
 * Yield all (subset × cartesian-of-alternates) combos from defSubs, in
 * order of increasing subset size. Each yielded Map contains one sub
 * entry per chosen key.
 *
 * Ordering matters: the backtracker's DFS tries candidates in the order
 * they're yielded, so preferring smaller subsets first keeps exploration
 * cheap. A smaller subset leaves more variables free in the substituted
 * equations, which is usually what reduces a multi-unknown system to a
 * 1-unknown Brent's target. Full cartesian comes last (rarely needed).
 *
 * For cyclically-related sub pairs (e.g., `x → z/2` and `z → 2*x` from
 * the same equation), size-1 combos try each direction independently
 * before any size-2 combo applies both simultaneously. This avoids the
 * cycle-guarded no-op case where both subs applied together round-trip
 * back to the original equation.
 */
function* subCombinations(defSubs) {
    const keys = [...defSubs.keys()];
    if (keys.length === 0) { yield new Map(); return; }
    for (let size = 0; size <= keys.length; size++) {
        yield* subsetsOfSize(keys, size, defSubs);
    }
}

function* subsetsOfSize(keys, size, defSubs, start = 0, chosen = []) {
    if (chosen.length === size) {
        yield* cartesianOver(chosen, defSubs);
        return;
    }
    const remaining = size - chosen.length;
    for (let i = start; i <= keys.length - remaining; i++) {
        yield* subsetsOfSize(keys, size, defSubs, i + 1, [...chosen, keys[i]]);
    }
}

function* cartesianOver(chosenKeys, defSubs) {
    if (chosenKeys.length === 0) { yield new Map(); return; }
    const [first, ...rest] = chosenKeys;
    for (const alt of defSubs.get(first)) {
        for (const m of cartesianOver(rest, defSubs)) {
            m.set(first, alt);
            yield m;
        }
    }
}

/**
 * Dedupe mod-equivalent roots for °= equations. Two roots that differ by
 * a multiple of modN collapse to one, keeping the smallest positive rep.
 */
function dedupeModEquivalent(values, modN) {
    const seen = new Map(); // canonical rep → value
    const out = [];
    for (const v of values) {
        let canon = ((v % modN) + modN) % modN;
        if (canon > modN / 2) canon -= modN; // fold to (-modN/2, modN/2]
        const key = Math.round(canon * 1e9) / 1e9; // bucket nearby values
        if (!seen.has(key)) {
            seen.set(key, v);
            out.push(v);
        }
    }
    return out;
}

function solveEquations(context, declarations, record = {}, equations, bodyDefinitions = []) {
    _trace(`========== solveEquations (${equations.length} equations, ${bodyDefinitions.length} input expressions) ==========`);
    const places = record.places != null ? record.places : 4;
    const errors = [];
    // Report any equation parse errors from preParseEquations
    for (const eq of equations) {
        if (eq.parseError) errors.push(`Line ${eq.startLine + 1}: ${eq.parseError}`);
    }
    const computedValues = new Map();
    const solveFailures = new Map(); // Track last failure per variable
    let solved = 0;

    // Build variables map for lookup (never reassigned after setup)
    const variables = buildVariablesMap(declarations);

    // Derive requiredVars for the terminal check: every variable that appears in
    // some equation and isn't yet in context is required. Declared-but-unreferenced
    // outputs (e.g. `d->` with no equation) are NOT required — the post-solve
    // formatOutput pass reports them as "no value to output". Including
    // equation-referenced-but-undeclared variables (e.g. `y` in `f(y;...) = 0`)
    // matches the old iterative solver's behavior of looping until no further
    // equations could be solved.
    const requiredVars = new Set();
    for (const eq of equations) {
        if (!eq.allVars) continue;
        for (const v of eq.allVars) {
            if (!context.hasVariable(v)) requiredVars.add(v);
        }
    }

    const maxIterations = 50;
    const erroredEquations = new Set();
    const unsolvedEquations = new Map(); // line → [unknown names]

    // Split body definitions into two phases:
    //   Pre-recursion: defs whose RHS references only already-known vars.
    //     Evaluates ONCE per solve — covers `r: rand()`, `t: Now()`, and
    //     `r: rate/100/12` when rate is a user input. No re-evaluation on backtrack.
    //   In-recursion (pendingBodyDefs): defs that depend on unknowns. These retry
    //     in pass [1] of the deterministic advance loop as their deps get solved.
    //     Snapshot/restore handles them naturally via context.variables.
    const pendingBodyDefs = [];
    if (bodyDefinitions.length > 0) {
        _trace(`--- Pre-recursion body definitions ---`);
        for (const def of bodyDefinitions) {
            if (!def.ast || context.hasVariable(def.name)) continue;
            if (isFullyKnownAST(def.ast, context)) {
                try {
                    const value = evaluate(def.ast, context);
                    context.setVariable(def.name, value);
                    // Body defs don't count toward "Solved N" — they're declaration
                    // evaluations, not equation solves (matches old iterative solver).
                    _trace(`  ${def.name} = ${_astStr(def.ast)} = ${value}`);
                } catch (e) {
                    // No unknowns but still errors — push to errors at terminal pass.
                    pendingBodyDefs.push(def);
                    _trace(`  ${def.name}: eval error, deferred (${e.message})`);
                }
            } else {
                pendingBodyDefs.push(def);
                _trace(`  ${def.name}: deferred (has unknown deps)`);
            }
        }
    }

    // Apply a direct-eval computed value for a variable, respecting its limits.
    // Returns true if the value was accepted; false if it failed limit validation
    // (recording a solveFailure in that case). Variables map has only INPUTs,
    // so OUTPUT limits don't reach this code path.
    function applyDirectValue(varName, value, sourceLine) {
        const varInfo = variables.get(varName);
        if (varInfo && varInfo.declaration && varInfo.declaration.limits) {
            try {
                const lowAST = parseTokens(varInfo.declaration.limits.lowTokens);
                const highAST = parseTokens(varInfo.declaration.limits.highTokens);
                let low = evaluate(lowAST, context);
                let high = evaluate(highAST, context);
                const isAngular = varInfo.declaration.format === 'degrees';
                if (!isAngular && low > high) [low, high] = [high, low];
                let inRange;
                if (isAngular) {
                    const M = context.degreesMode ? 360 : 2 * Math.PI;
                    const modM = (x) => ((x % M) + M) % M;
                    // Arc-based range check: compute the arc length from low to high
                    // around the unit circle. This uniformly handles full-circle,
                    // wraparound, and normal ranges without special-casing.
                    //   - Full circle ([0:360], [10:370], ...): arcLen = 0 after mod,
                    //     widened to M so any value is in range.
                    //   - Wraparound ([327.8:5.5]): arcLen is the short arc through 0.
                    //   - Normal ([10:350]): arcLen = h - l.
                    let arcLen = modM(high - low);
                    if (arcLen === 0 && low !== high) arcLen = M;
                    const offset = modM(value - low);
                    inRange = offset <= arcLen;
                    if (inRange && (value < low || value > low + arcLen)) {
                        // Renormalize into [low, low + arcLen]. Values already in
                        // that window are preserved exactly (no FP round-trip).
                        value = low + offset;
                    }
                } else {
                    inRange = value >= low && value <= high;
                }
                if (!inRange) {
                    solveFailures.set(varName, {
                        error: `Computed value ${value} is outside limits [${low}, ${high}]`,
                        line: sourceLine
                    });
                    return false;
                }
            } catch (e) {
                // Limit eval errors are tolerated here; end-of-solve validation reports them.
            }
        }
        context.setVariable(varName, value);
        computedValues.set(varName, value);
        solveFailures.delete(varName);
        if (sourceLine != null) unsolvedEquations.delete(sourceLine);
        solved++;
        return true;
    }

    // Deterministic advance: run passes [1] pendingBodyDefs retry,
    // [2] substitution map, [3] unambiguous direct-eval,
    // [4] build sweep subs. Loops until no progress.
    //
    // [3] "unambiguous only" — a variable is resolved here only when exactly one
    // of its subs evaluates to a finite value. Multiple finite subs defer the
    // decision to enumerateAlternatives (Kind 1 branching).
    //
    // Returns { substitutions, definitionSubs } from the final pass (used by
    // the branching step).
    function deterministicAdvance() {
        let substitutions = null;
        let definitionSubs = null;
        let progressed = true;
        while (progressed) {
            progressed = false;

            // [1] Retry pending body defs (those with unknown deps at start).
            // Body defs don't count toward "Solved N" (matches old iterative solver).
            _trace(`  [1] Input expressions${pendingBodyDefs.length === 0 ? ' (none)' : ''}`);
            for (const { name, ast } of pendingBodyDefs) {
                if (!ast || context.hasVariable(name)) continue;
                try {
                    const value = evaluate(ast, context);
                    context.setVariable(name, value);
                    progressed = true;
                    _trace(`    ${name} = ${_astStr(ast)} = ${value}`);
                } catch (e) {
                    _trace(`    ${name}: deferred (${e.message})`);
                }
            }

            // Handle incomplete equations (expr =) — deterministic side-effect-free
            // computation, not a branching decision. Save to computedValues.
            for (const eq of equations) {
                if (!eq.leftAST || eq.rightAST) continue;
                const key = `__incomplete_${eq.startLine}`;
                if (computedValues.has(key)) continue;
                try {
                    const value = evaluate(eq.leftAST, context);
                    if (Number.isFinite(value)) {
                        computedValues.set(key, value);
                        solved++;
                        progressed = true;
                        _trace(`    Incomplete: ${eq.leftText} = ${value}`);
                    }
                } catch (e) { /* unknown variables — skip */ }
            }

            // [2] Build substitution map
            substitutions = buildSubstitutionMap(equations, context, errors);
            _trace('  [2] Substitution map');
            if (substitutions.size > 0) {
                for (const [k, subs] of substitutions) {
                    for (const s of subs) {
                        _trace(`    line ${s.sourceLine + 1}: ${k} → ${_astStr(s.ast)}`);
                    }
                }
            } else {
                _trace('    (none)');
            }

            // [3] Evaluate fully-known substitutions.
            //
            // Each fully-known sub is classified as either a non-NaN candidate
            // (real value, Infinity, or -Infinity) or a NaN fallback. NaN is
            // treated as inferior to any real/Infinity answer because it usually
            // signals "this substitution path failed in this context" (e.g.
            // sqrt of negative, 0/0). But when a variable has exactly one
            // fully-known sub and it's NaN, we still store NaN so the user sees
            // the degenerate answer directly instead of a generic "no value"
            // error.
            //
            // Resolution rule:
            //   0 non-NaN + 0 NaN  → deferred (wait for more info next iteration)
            //   1 non-NaN          → forced choice, resolve here
            //   2+ non-NaN         → ambiguous, defer to Kind 1 branching
            //   0 non-NaN + 1 NaN  → NaN fallback, resolve (single option)
            //   0 non-NaN + 2+ NaN → deferred (multiple NaN subs — no obvious pick)
            _trace('  [3] Evaluate fully-known substitutions');
            for (const [varName, subs] of substitutions) {
                if (context.hasVariable(varName)) continue;
                const candidates = [];
                const nanFallbacks = [];
                const unknownSubs = [];
                for (const sub of subs) {
                    const subUnknowns = [...findVariablesInAST(sub.ast)]
                        .filter(v => !context.hasVariable(v));
                    if (subUnknowns.length > 0) {
                        unknownSubs.push({ sub, unknowns: subUnknowns });
                        continue;
                    }
                    try {
                        const v = evaluate(sub.ast, context);
                        if (typeof v !== 'number') continue;
                        if (Number.isNaN(v)) nanFallbacks.push({ sub, value: v });
                        else candidates.push({ sub, value: v });
                    } catch (e) { /* skip */ }
                }
                let chosen = null;
                if (candidates.length === 1) {
                    chosen = candidates[0];
                } else if (candidates.length === 0 && nanFallbacks.length === 1) {
                    chosen = nanFallbacks[0];
                }
                if (chosen) {
                    const { sub, value } = chosen;
                    try {
                        if (applyDirectValue(varName, value, sub.sourceLine)) {
                            progressed = true;
                            _trace(`    ${varName} = ${_astStr(sub.ast)} = ${value}`);
                        } else {
                            _trace(`    ${varName}: outside limits, skipped`);
                        }
                    } catch (e) {
                        if (!(e instanceof EvalError)) {
                            errors.push(`Line ${sub.sourceLine + 1}: ${e.message}`);
                        }
                    }
                } else if (candidates.length >= 2) {
                    // Ambiguous — leave for Kind 1 branching.
                    _trace(`    ${varName}: ambiguous (${candidates.length} alternates) — deferred to branching`);
                } else if (_traceBuffer !== null) {
                    _trace(`    ${varName}: deferred`);
                    for (const { sub, unknowns } of unknownSubs) {
                        _trace(`      line ${sub.sourceLine + 1}: unknowns ${unknowns.join(', ')}`);
                    }
                }
            }

            // [4] Build sweep subs — only if [3] didn't resolve everything.
            // Stores full alternate arrays for the cartesian product in branching.
            // Variables with INPUT limits are "answer variables" being Brent's'd
            // on directly; skip them so we don't substitute them away. Since
            // the variables map contains only INPUTs, OUTPUT limits never enter.
            definitionSubs = new Map();
            if (!progressed) {
                for (const [varName, subs] of substitutions) {
                    if (context.hasVariable(varName)) continue;
                    const varInfo = variables.get(varName);
                    if (varInfo && varInfo.declaration && varInfo.declaration.limits) continue;
                    definitionSubs.set(varName, subs);
                }
            }
            _trace(`  [4] Sweep subs: ${[...definitionSubs.keys()].join(', ') || '(none)'}`);
        }
        return { substitutions, definitionSubs };
    }

    // Definition-equation guard used by Kind 2, Kind 3, and the post-recursion
    // "too many unknowns" classifier. Returns true if this equation should be
    // skipped: either its LHS variable was already handled via substitutions,
    // or its LHS variable is still unbound (don't Brent's a bare definition).
    function isSkippableDefEquation(eq) {
        if (eq.modN) return false;
        const def = isDefinitionEquation(eq.leftText, eq.rightText, eq.rightAST);
        if (!def) return false;
        const rhsUnknowns = [...findVariablesInAST(def.expressionAST)]
            .filter(v => !context.hasVariable(v));
        if (rhsUnknowns.length === 0) return true;
        if (!context.hasVariable(def.variable)) return true;
        return false;
    }

    // Run Brent's on an equation with a given sub combo and yield each root as
    // a branching candidate. Handles the error / limitsDeferred / tooManyUnknowns
    // bookkeeping that Kind 2 and Kind 3 would otherwise duplicate.
    function* rootsFromBrents(eq, comboSubs, kind) {
        const modValue = eq.modN ? (record.degreesMode ? 360 : 2 * Math.PI) : null;
        let r;
        try {
            r = solveEquationInContext(eq.startLine, context, variables,
                comboSubs, modValue, eq.leftAST, eq.rightAST, { allRoots: true });
        } catch (e) {
            _trace(`    ${kind} line ${eq.startLine + 1}: ${e.message}`);
            errors.push(`Line ${eq.startLine + 1}: ${e.message}`);
            erroredEquations.add(eq.startLine);
            return;
        }
        if (r.limitsDeferred) {
            _trace(`    ${kind} line ${eq.startLine + 1}: limits deferred`);
            return;
        }
        if (r.tooManyUnknowns) {
            _trace(`    ${kind} line ${eq.startLine + 1}: too many unknowns (${r.tooManyUnknowns.join(', ')})`);
            unsolvedEquations.set(eq.startLine, r.tooManyUnknowns);
            return;
        }
        if (!r.solved) {
            if (r.error && r.variable) {
                _trace(`    ${kind} line ${eq.startLine + 1}: ${r.error} for '${r.variable}'`);
                solveFailures.set(r.variable, { error: r.error, line: eq.startLine });
            }
            return;
        }
        const roots = eq.modN ? dedupeModEquivalent(r.values, eq.modN) : r.values;
        for (const value of roots) {
            yield {
                kind,
                variable: r.variable,
                value,
                eq,
                combo: comboSubs.size > 0 ? comboSubs : null,
                sourceLabel: `from line ${eq.startLine + 1}`,
            };
        }
    }

    // Build the candidates the branching step will try, in preference order.
    // Generator so unused alternatives aren't computed.
    //
    //   Kind 1: direct-eval alternates (variables with ≥2 finite fully-known subs).
    //           Cheapest; catches Test 7's NaN recovery.
    //   Kind 2: sweep-0 natural 1-unknown equations (all roots via allRoots).
    //   Kind 3: sweep-1 with cartesian combos of sub alternates (all roots).
    function* enumerateAlternatives(substitutions, definitionSubs) {
        // --- Kind 1: direct-eval alternates ---
        // Matches [3]'s candidate rule: non-NaN (finite or ±Infinity) counts.
        // Yield each sub when the variable has ≥2 candidates ([3] would have
        // deferred it here).
        for (const [varName, subs] of substitutions) {
            if (context.hasVariable(varName)) continue;
            const cands = [];
            for (const sub of subs) {
                const subUnknowns = [...findVariablesInAST(sub.ast)].filter(v => !context.hasVariable(v));
                if (subUnknowns.length > 0) continue;
                try {
                    const v = evaluate(sub.ast, context);
                    if (!Number.isNaN(v)) cands.push({ sub, value: v });
                } catch (e) { /* skip */ }
            }
            if (cands.length < 2) continue; // [3] already resolved (1) or deferred (0)
            for (const { sub, value } of cands) {
                yield {
                    kind: 'directEval',
                    variable: varName,
                    value,
                    sub,
                    sourceLine: sub.sourceLine,
                    sourceLabel: `from line ${sub.sourceLine + 1}, direct eval`,
                };
            }
        }

        // --- Kind 2: sweep-0 natural 1-unknown equations ---
        for (const eq of equations) {
            if (!eq.leftAST || !eq.rightAST) continue;
            if (erroredEquations.has(eq.startLine)) continue;
            if (isSkippableDefEquation(eq)) continue;
            // Only natural 1-unknown for sweep 0.
            const eqUnknowns = [...eq.allVars].filter(v => !context.hasVariable(v));
            if (eqUnknowns.length !== 1) continue;
            // Skip if the unknown is in definitionSubs (would be substituted in sweep 1).
            if (definitionSubs.has(eqUnknowns[0])) continue;
            yield* rootsFromBrents(eq, new Map(), 'sweep0');
        }

        // --- Kind 3: sweep-1 cartesian sub combos × equations × roots ---
        if (definitionSubs.size === 0) return;
        for (const comboSubs of subCombinations(definitionSubs)) {
            for (const eq of equations) {
                if (!eq.leftAST || !eq.rightAST) continue;
                if (erroredEquations.has(eq.startLine)) continue;
                // isSkippableDefEquation filters "bare definition of unbound
                // var" equations; but in Kind 3 a non-self sub from the combo
                // can reduce such an equation (e.g., applying `x → z/2` from
                // eq1 to `x = sqrt(25-z²)` yields `z/2 = sqrt(25-z²)`, a
                // 1-unknown equation in z). Skip only when the combo has no
                // non-self sub to offer — self-source subs are filtered by
                // solveEquationInContext and would leave the eq multi-unknown.
                if (isSkippableDefEquation(eq)) {
                    const hasNonSelf = [...comboSubs.values()]
                        .some(sub => sub.sourceLine !== eq.startLine);
                    if (!hasNonSelf) continue;
                }
                yield* rootsFromBrents(eq, comboSubs, 'sweep1');
            }
        }
    }

    // Apply a branching decision: set the variable and, for sweep-1 combos,
    // lock in the chosen sub alternates so the next recursion level doesn't
    // have to re-discover the combo's forced values. Returns true if the
    // primary variable was successfully bound; false if applyDirectValue
    // rejected it (e.g. limit check failure).
    function applyDecision(alt) {
        const sourceLine = alt.kind === 'directEval'
            ? alt.sourceLine
            : (alt.eq ? alt.eq.startLine : null);
        if (!applyDirectValue(alt.variable, alt.value, sourceLine)) {
            return false;
        }
        // For sweep-1 combos: evaluate each chosen sub against the now-updated
        // context so subsequent advance passes don't re-explore the combo.
        if (alt.combo && alt.combo.size > 0) {
            for (const [subVar, sub] of alt.combo) {
                if (context.hasVariable(subVar)) continue;
                try {
                    const v = evaluate(sub.ast, context);
                    if (Number.isFinite(v)) {
                        applyDirectValue(subVar, v, sub.sourceLine);
                    }
                } catch (e) { /* leave for next advance pass */ }
            }
        }
        return true;
    }

    function buildAttemptTraceLines(alt) {
        const lines = [];
        if (alt.kind === 'directEval') {
            lines.push(`      from (line ${alt.sub.sourceLine + 1}): ${alt.variable} = ${_astStr(alt.sub.ast)}`);
            return lines;
        }
        lines.push(`      from (line ${alt.eq.startLine + 1}): ${alt.eq.text.trim()}`);
        if (alt.combo && alt.combo.size > 0 && alt.eq.allVars) {
            for (const [varName, sub] of alt.combo) {
                if (sub.sourceLine === alt.eq.startLine) continue;
                if (alt.eq.allVars.has(varName)) {
                    lines.push(`      with (line ${sub.sourceLine + 1}): ${varName} → ${_astStr(sub.ast)}`);
                }
            }
        }
        return lines;
    }

    // bestCandidate is a snapshot of a "final but imperfect" state — used to
    // surface partial answers to the user when no branch reaches a fully-
    // balanced solution. First-wins: the deepest solveRecursive call to invoke
    // saveCandidate captures its state, because DFS unwinds bottom-up.
    //
    // Two callers:
    //   (a) Inside the branching loop, eagerly on limit-rejection — the
    //       solveFailures entry would otherwise be wiped by the subsequent
    //       restoreState call.
    //   (b) At the end of solveRecursive before returning 'none' — catches the
    //       "stuck with no alternatives", "all set but balance failed", and
    //       "all branches exhausted without balancing" cases uniformly.
    //
    // On top-level failure, we restore bestCandidate before post-solve error
    // reporting so values and solveFailures reflect the actual best-effort state.
    let bestCandidate = null;
    function saveCandidate(depth, reason) {
        if (bestCandidate) return;
        bestCandidate = snapshotState(context, solveFailures, unsolvedEquations,
                                      erroredEquations, computedValues, errors, solved);
        _trace(`  · candidate (depth ${depth}): ${reason}`);
    }

    function solveRecursive(depth) {
        if (depth >= maxIterations) return 'none';
        const myDepth = depth + 1;
        _trace(`--- Advance (depth ${myDepth}) ---`);
        const { substitutions, definitionSubs } = deterministicAdvance();

        const allSet = [...requiredVars].every(v => context.hasVariable(v));
        if (allSet) {
            if (checkAllEquationsBalance(context, equations, record, places, requiredVars, erroredEquations)) {
                _trace(`  ✓ balanced (depth ${myDepth})`);
                return 'balanced';
            }
            // Fall through to branching; the stuck-save below will catch this
            // state (branching won't yield anything when allSet is true).
        }

        _trace(`  [5] Branching (depth ${myDepth})`);
        let anyAlt = false;
        for (const alt of enumerateAlternatives(substitutions, definitionSubs)) {
            anyAlt = true;
            const snap = snapshotState(context, solveFailures, unsolvedEquations,
                                       erroredEquations, computedValues, errors, solved);

            _trace(`    Try ${alt.kind}: ${alt.variable} = ${alt.value} (${alt.sourceLabel})`);
            for (const line of buildAttemptTraceLines(alt)) _trace(line);

            if (!applyDecision(alt)) {
                // applyDirectValue rejected the value (limit failure). The branch
                // made no progress, so recursing would see the same state and
                // yield the same alternatives — explosion. Save the rejection
                // state eagerly (the solveFailures entry would otherwise be
                // wiped by the restoreState call below) so the user still sees
                // the "outside limits" error, then skip the recursion.
                saveCandidate(myDepth, `rejected by limit check: ${alt.variable} = ${alt.value}`);
                solved = restoreState(context, solveFailures, unsolvedEquations,
                                      erroredEquations, computedValues, errors, snap);
                _trace(`    Rejected: ${alt.variable} = ${alt.value} (limit check)`);
                continue;
            }

            if (solveRecursive(myDepth) === 'balanced') return 'balanced';

            solved = restoreState(context, solveFailures, unsolvedEquations,
                                  erroredEquations, computedValues, errors, snap);
            _trace(`    Rejected: ${alt.variable} = ${alt.value} (downstream failed)`);
        }
        if (!anyAlt) _trace(`    (no alternatives available)`);

        // Fallback save: if no eager save fired during this invocation and
        // nothing reached 'balanced' downstream, capture the post-advance state
        // as a last-resort candidate. First-wins ensures the deepest such call
        // (which unwinds first in DFS order) captures the most-progressed state.
        saveCandidate(myDepth, 'no balanced branch found');
        return 'none';
    }

    const status = solveRecursive(0);
    if (status !== 'balanced' && bestCandidate) {
        // No perfectly-balanced branch was found. Fall back to the first state
        // in which all unknowns were bound so error reporting uses real values.
        solved = restoreState(context, solveFailures, unsolvedEquations,
                              erroredEquations, computedValues, errors, bestCandidate);
        _trace(`========== solveEquations fell back to candidate (no balanced branch) ==========`);
    } else if (status !== 'balanced') {
        _trace(`========== solveEquations FAILED (no complete solution) ==========`);
    }

    // Post-recursion classification: clear any stale unsolvedEquations entries
    // (rootsFromBrents may have populated them from intermediate branching
    // attempts where the list-of-unknowns doesn't reflect the final state), then
    // repopulate based on the actual final state. Equations with ≥2 remaining
    // unknowns get reported as "Too many unknowns". Skips definition equations
    // whose LHS variable still isn't bound (they're handled via substitutions).
    unsolvedEquations.clear();
    for (const eq of equations) {
        if (!eq.leftAST || !eq.rightAST) continue;
        if (erroredEquations.has(eq.startLine)) continue;
        if (isSkippableDefEquation(eq)) continue;
        const eqUnknowns = [...eq.allVars].filter(v => !context.hasVariable(v));
        if (eqUnknowns.length >= 2) {
            unsolvedEquations.set(eq.startLine, eqUnknowns);
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

    // Validate limit expressions for all declared variables (catches undefined references
    // even when the variable wasn't actually solved via Brent's)
    for (const decl of declarations) {
        if (!decl.declaration.limits) continue;
        try {
            const lowAST = parseTokens(decl.declaration.limits.lowTokens);
            evaluate(lowAST, context);
        } catch (e) {
            errors.push(`Line ${decl.lineIndex + 1}: Invalid lower limit for '${decl.name}' - ${e.message}`);
        }
        try {
            const highAST = parseTokens(decl.declaration.limits.highTokens);
            evaluate(highAST, context);
        } catch (e) {
            errors.push(`Line ${decl.lineIndex + 1}: Invalid upper limit for '${decl.name}' - ${e.message}`);
        }
        if (decl.declaration.limits.stepTokens) {
            try {
                const stepAST = parseTokens(decl.declaration.limits.stepTokens);
                evaluate(stepAST, context);
            } catch (e) {
                errors.push(`Line ${decl.lineIndex + 1}: Invalid step for '${decl.name}' - ${e.message}`);
            }
        }
    }

    // Check equation consistency (reuses precomputed equations)
    // First-wins ordering: a variable's status is set by the first equation it appears in
    // Check equation balance and build highlighting status
    const equationVarStatus = new Map();
    let firstFailedEq = null;
    const definitionDeps = new Map(); // undeclared var → RHS vars (for highlighting expansion)
    for (const eq of equations) {
        try {
            if (!eq.leftAST || !eq.rightAST) continue;
            // Track undeclared-var definitions for highlighting expansion
            if (eq.leftAST.type === 'VARIABLE' && !variables.has(eq.leftAST.name) && !definitionDeps.has(eq.leftAST.name)) {
                definitionDeps.set(eq.leftAST.name, findVariablesInAST(eq.rightAST));
            }
            if (erroredEquations.has(eq.startLine)) continue;

            const unknowns = [...eq.allVars].filter(v => !context.hasVariable(v));

            if (unknowns.length === 0) {
                const leftVal = evaluate(eq.leftAST, context);
                const rightVal = evaluate(eq.rightAST, context);
                const eqText = eq.text.length > 30 ? eq.text.substring(0, 30) + '...' : eq.text;

                // Non-finite shortcut: if either side is NaN or ±Infinity and
                // they're not strictly equal, emit a concrete message naming the
                // actual values instead of routing through checkBalance (which
                // produces misleading "relative diff NaN%" phrasing because the
                // diff arithmetic on non-finite inputs produces NaN).
                if (!Number.isFinite(leftVal) || !Number.isFinite(rightVal)) {
                    if (leftVal === rightVal) continue; // Infinity === Infinity etc.
                    const fmt = (v) => Number.isNaN(v) ? 'NaN'
                        : v === Infinity ? 'Infinity'
                        : v === -Infinity ? '-Infinity'
                        : String(v);
                    errors.push(`Line ${eq.startLine + 1}: Equation doesn't balance: ${eqText} (left = ${fmt(leftVal)}, right = ${fmt(rightVal)})`);
                    if (!firstFailedEq) firstFailedEq = eq;
                    continue;
                }

                const result = eq.modN
                    ? modCheckBalance(leftVal, rightVal, record.degreesMode ? 360 : 2 * Math.PI, places)
                    : checkBalance(leftVal, rightVal, places);
                const balanced = result.balanced;

                if (!balanced) {
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
                    if (!firstFailedEq) firstFailedEq = eq;
                }
            }
        } catch (e) {
            errors.push(`Line ${eq.startLine + 1}: ${e.message}`);
        }
    }

    // Expand undeclared vars through definition substitutions
    function expandVars(allVars) {
        const expanded = new Set();
        for (const v of allVars) {
            if (definitionDeps.has(v)) {
                for (const dep of definitionDeps.get(v)) expanded.add(dep);
            } else {
                expanded.add(v);
            }
        }
        return expanded;
    }

    // Apply highlighting: all balanced → all green.
    // Any failure → orange on failing eq's expanded vars, except vars balanced earlier. No green.
    if (firstFailedEq) {
        // Collect declared vars from real equations (not undeclared definitions) that balanced before the failure
        const priorBalanced = new Set();
        for (const eq of equations) {
            if (eq === firstFailedEq) break;
            if (!eq.leftAST || !eq.rightAST) continue;
            if (erroredEquations.has(eq.startLine)) continue;
            if (definitionDeps.has(eq.leftAST.name)) continue; // skip undeclared-var definitions
            for (const v of expandVars(eq.allVars)) {
                if (variables.has(v)) priorBalanced.add(v);
            }
        }
        for (const v of expandVars(firstFailedEq.allVars)) {
            if (variables.has(v) && !priorBalanced.has(v)) {
                equationVarStatus.set(v, 'unsolved');
            }
        }
    } else {
        for (const eq of equations) {
            if (!eq.leftAST || !eq.rightAST) continue;
            for (const v of expandVars(eq.allVars)) {
                if (variables.has(v)) equationVarStatus.set(v, 'solved');
            }
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
        format: record.format || 'float',
        currencySymbol: record.currencySymbol || '$',
        degreesMode: record.degreesMode
    };

    // Fill empty variable declarations with computed values (or constants)
    // Uses pre-parsed declarations to avoid re-tokenizing lines
    const lines = text.split('\n');
    for (const info of declarations) {
        if (!info.valueTokens || info.valueTokens.length === 0) {
            let value = null;
            // Check for per-declaration re-solve value (OUTPUT-with-limits)
            if (computedValues.has(`__resolvevar_${info.lineIndex}`)) {
                value = computedValues.get(`__resolvevar_${info.lineIndex}`);
                if (value === undefined) continue; // re-solve failed; specific error already pushed
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
                    groupDigits: format.groupDigits,
                    currencySymbol: format.currencySymbol || '$',
                    degreesMode: format.degreesMode
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
 * Remove existing references, trace, and table outputs sections from text.
 * All are appended at the end of each solve and should be stripped first.
 */
function removeReferencesSection(text) {
    const before = text;
    text = text.replace(/\n*"--- Table Outputs ---"[\s\S]*$/, '');
    text = text.replace(/\n*"\*?--- Solve Trace ---"[\s\S]*$/, '');
    text = text.replace(/\n*"\*?--- Reference Constants and Functions ---"[\s\S]*$/, '');
    // If anything was stripped, leave a single trailing newline
    if (text !== before) text = text.trimEnd() + '\n';
    return text;
}

/**
 * Append solve trace section showing the outer-solve decision steps as text.
 * Headers (---..., ===...) are emitted as "*label" lines that render as
 * prominent section headers in the variables panel; content lines are
 * grouped into multi-line quoted comment blocks. Appended at the end of text.
 */
function appendTraceSection(text, trace) {
    if (!trace || trace.length === 0) return text;

    const out = ['"*--- Solve Trace ---"'];
    let contentBuf = [];
    const flushContent = () => {
        if (contentBuf.length > 0) {
            out.push('"' + contentBuf.join('\n') + '\n"');
            contentBuf = [];
        }
    };
    const isHeader = (line) => /^(-{3,}|={3,})/.test(line);
    for (const line of trace) {
        if (isHeader(line)) {
            flushContent();
            out.push(`"*${line}"`);
        } else {
            contentBuf.push(line);
        }
    }
    flushContent();

    return text.trimEnd() + '\n\n\n\n' + out.join('\n');
}

/**
 * Append table outputs section showing table results as text
 */
function appendTableOutputsSection(text, tables) {
    if (!tables || tables.length === 0) return text;

    // Check if any tables have data
    const isGridType = (t) => t.type === 'grid' || t.type === 'gridGraph';
    const hasTables = tables.some(t => {
        if (isGridType(t)) return t.grid && t.grid.length > 0;
        if (t.type === 'vectorDraw') return t.vectors && t.vectors.length > 0;
        return t.rows && t.rows.length > 0;
    });
    if (!hasTables) return text;

    const lines = ['"--- Table Outputs ---"'];

    for (const table of tables) {
        // Title line with table type prefix. Append a "(N/M solved)" indicator
        // inside the title quotes when the table didn't fully solve — matches
        // the UI's variables panel status display (see CLAUDE.md
        // "Solve status indicator").
        if (table.title) {
            const status = table.solveInfo
                ? ` (${table.solveInfo.solved}/${table.solveInfo.total} solved)`
                : '';
            lines.push(`${table.keyword} "${table.title}${status}"`);
        }

        if (isGridType(table)) {
            if (!table.grid || table.grid.length === 0) continue;
            lines.push(`"${table.iter1Label}"\t"${table.iter2Label}"\t"${table.cellHeader}"`);
            lines.push(`\t${table.colValues.join('\t')}`);
            for (let r = 0; r < table.rowValues.length; r++) {
                lines.push(`${table.rowValues[r]}\t${table.grid[r].join('\t')}`);
            }
        } else if (table.type === 'vectorDraw') {
            if (!table.vectors || table.vectors.length === 0) continue;
            // Each vector has its own set of 4 column labels, so emit a header+value
            // pair per vector. This keeps every label paired with its value even when
            // different vectors use different column names.
            for (const v of table.vectors) {
                if (v.cols) {
                    lines.push(v.cols.map(c => '"' + (c.header || c.name) + '"').join('\t'));
                }
                lines.push((v.formatted || []).join('\t'));
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

    const lines = ['"*--- Reference Constants and Functions ---"'];

    // Add used constants (including those shadowed by local declarations)
    // Use ->> so they appear as full-precision read-only output rows in the panel
    for (const name of [...usedConstants].sort()) {
        const value = context.constants.get(name);
        const comment = context.constantComments.get(name);
        if (value !== undefined) {
            let line = `${name}->> ${value}`;
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
        text = text.trimEnd() + '\n\n\n\n' + lines.join('\n');
    }

    return text;
}

/**
 * Main solve function - orchestrates discovery, solving, and formatting
 * @param {boolean} traceMode - If true, collect a user-visible solve trace
 */
function solveRecord(text, context, record, parserTokens, skipTables = false, traceMode = false) {
    // Set up trace buffer for this solve (outer only — paused during table eval)
    const prevTraceBuffer = _traceBuffer;
    if (traceMode) _traceBuffer = [];

    // Remove any existing references, trace, and table outputs sections before solving
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

    // Trace discovered variables (grouped by whether they have a known value)
    if (_traceBuffer !== null) {
        _trace('--- Variable discovery ---');
        const withValue = [];
        const unknown = [];
        for (const decl of declarations) {
            if (context.hasVariable(decl.name)) {
                withValue.push(`${decl.name} = ${context.getVariable(decl.name)}`);
            } else {
                unknown.push(decl.name);
            }
        }
        if (withValue.length > 0) {
            _trace('  known:');
            for (const line of withValue) _trace(`    ${line}`);
        }
        if (unknown.length > 0) {
            _trace(`  unknown: ${unknown.join(', ')}`);
        }
    }

    // Find equations and expression outputs
    const { equations: outerEquations, exprOutputs } = findEquationsAndOutputs(text, allTokens, context.localFunctionLines);
    preParseEquations(outerEquations);

    if (_traceBuffer !== null && outerEquations.length > 0) {
        _trace(`--- Equations (${outerEquations.length}) ---`);
        for (const eq of outerEquations) {
            const modTag = eq.modN ? ' [°=]' : '';
            _trace(`  line ${eq.startLine + 1}${modTag}: ${eq.text.substring(0, 80)}`);
        }
    }

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

    // Re-solve each OUTPUT-with-limits via full pipeline. INPUT drives the main
    // solve; OUTPUT-with-limits is a display instruction that does its own
    // complete solve (fast path when main value is in limits). Each OUTPUT
    // stores its result under `__resolvevar_${lineIndex}` so multiple outputs
    // of the same variable with different limits produce distinct display values.
    const computedValues = solveResult.computedValues;
    for (const decl of declarations) {
        if (decl.declaration.type !== VarType.OUTPUT) continue;
        if (!decl.declaration.limits) continue;
        const { value, reason, errors: reErrors } = resolveWithLimits(
            decl.name, decl.declaration, outerEquations, declarations,
            context, record, preSolveVars, decl.lineIndex);
        errors.push(...reErrors);
        if (reason === 'noEquation' && !solveResult.solveFailures.has(decl.name)) {
            errors.push(`Line ${decl.lineIndex + 1}: No equation references '${decl.name}' — cannot apply limits`);
        }
        computedValues.set(`__resolvevar_${decl.lineIndex}`, value);
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

    // Pass 4: Evaluate tables (after all normal solving is complete) — pause tracing
    const tables = [];
    if (!skipTables) {
        const savedBuf = _traceBuffer;
        _traceBuffer = null; // skip table internals in trace
        const savedVars = new Map(context.variables);
        for (const td of tableDefs) {
            // Restore outer context so tables don't leak state to each other
            context.variables = new Map(savedVars);
            const tableResult = evaluateTable(td, context, record, outerEquations, preSolveVars);
            errors.push(...tableResult.errors);
            tables.push(tableResult);
        }
        context.variables = savedVars;
        _traceBuffer = savedBuf;
    }

    // Pass 5: Append references section showing used constants and functions
    // Skip for reference records (Constants, Functions, Default Settings)
    const isInReferenceCategory = record.category === 'Reference';
    if (!isInReferenceCategory) {
        text = appendReferencesSection(text, context);
    }

    // Pass 6: Append trace section (before table outputs) and table outputs section
    const trace = (traceMode && _traceBuffer) ? _traceBuffer.slice() : null;
    if (trace && trace.length > 0) {
        text = appendTraceSection(text, trace);
    }
    text = appendTableOutputsSection(text, tables);

    // Restore previous trace buffer
    _traceBuffer = prevTraceBuffer;

    // Dedup errors: main solve and each slow-path re-solve can produce
    // overlapping messages (e.g. the same balance error surfacing from
    // multiple OUTPUT-with-limits re-solves, or a slow-path message
    // identical to one already pushed by main solve). Preserve first-
    // occurrence order; drop exact duplicates.
    const dedupedErrors = [...new Set(errors)];

    return { text, solved: solveResult.solved, errors: dedupedErrors, equationVarStatus: solveResult.equationVarStatus, tables, trace };
}

/**
 * Evaluate a table definition (unified 1D/2D).
 * Parses body for iterators (x<- 0..4), unknowns (z<-), definitions (v: 10),
 * outputs (z->), and equations. Dimensionality determined by iterator count.
 */
function evaluateTable(tableDef, context, record, outerEquations, preSolveVars) {
    const errors = [];
    const isGrid = tableDef.keyword === 'grid' || tableDef.keyword === 'gridgraph';
    const isVectorDraw = tableDef.keyword === 'vectordraw';
    const keyword = tableDef.keyword;
    const emptyResult = () => {
        if (isGrid) return { type: 'grid', keyword, title: tableDef.title, iter1Label: '', iter2Label: '', rowValues: [], colValues: [], cellHeader: '', grid: [], fontSize: null, startLine: tableDef.startLine, endLine: tableDef.endLine, errors };
        if (isVectorDraw) return { type: 'vectorDraw', keyword, title: tableDef.title, vectors: [], formatOpts: null, fontSize: null, startLine: tableDef.startLine, endLine: tableDef.endLine, errors };
        return { type: 'table', keyword, title: tableDef.title, columns: [], rows: [], fontSize: null, startLine: tableDef.startLine, endLine: tableDef.endLine, errors };
    };

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
        groupDigits: record.groupDigits || false,
        currencySymbol: record.currencySymbol || '$',
        degreesMode: record.degreesMode
    };

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
                declaration: { type: VarType.OUTPUT, limits: col.limits, format: col.format }
            });
        }
    }

    // Structural check: columns with limits but no body equation referencing the
    // variable can't be re-solved. Report once (not per row/cell) and mark in
    // noEquationColumns so getColumnValue returns undefined without attempting
    // a guaranteed-to-fail re-solve.
    const noEquationColumns = new Set();
    for (const col of columns) {
        if (!col.limits || col.ast) continue;
        const hasEq = equations.some(eq =>
            eq.leftAST && eq.rightAST && eq.allVars && eq.allVars.has(col.name));
        if (!hasEq) {
            noEquationColumns.add(col.name);
            errors.push(`Line ${tableDef.startLine}: No equation references '${col.name}' — cannot apply limits`);
        }
    }

    // Per-cell balance check inputs: every well-formed equation. The previous
    // version filtered to equations whose allVars directly intersected the
    // unknowns, but that missed indirect references — e.g. `a/sin(A) = b/sin(B)`
    // uses `a, b, A, B` (none of them the actual unknowns `cmg, drift`), yet
    // the equation's truth depends on cmg/drift through the substitutions
    // `a = drift, A = cmg - cts, B = set - cmg`. Checking every equation uniformly
    // catches these cases; equations whose vars all come from preSolveVars still
    // balance trivially (they balanced in the outer solve), so the extra checks
    // are cheap no-ops.
    const balancePlaces = record.places != null ? record.places : 4;
    const balanceEquations = [];
    for (const eq of equations) {
        if (!eq.leftAST || !eq.rightAST) continue;
        const eqVars = new Set([
            ...findVariablesInAST(eq.leftAST),
            ...findVariablesInAST(eq.rightAST)
        ]);
        balanceEquations.push({
            leftAST: eq.leftAST, rightAST: eq.rightAST, modN: eq.modN, eqVars
        });
    }

    // Per-cell pre-solve snapshot used by getColumnValue's OUTPUT-with-limits
    // re-solve path. Captured after iterators are set but before solveEquations
    // runs, so re-solves restart from the row's clean state (not outer
    // preSolveVars, which would lose iterator values).
    let cellPreSolveVars = null;

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
        // Snapshot for per-column re-solves (before solveEquations mutates context)
        cellPreSolveVars = new Map(context.variables);
        // Solve with body definitions handled inside the iterative loop
        const solveResult = solveEquations(context, tableDeclarations, record, equations, defASTs);
        // Collect variables that failed to solve
        const badVars = new Set();
        for (const [varName, failure] of solveResult.solveFailures) {
            badVars.add(varName);
        }
        // A variable is "body-derived" (eligible to be blanked) if it wasn't
        // already known at row-start. Iterators and outer constants/INPUTs
        // are in cellPreSolveVars — their values came from outside the per-
        // row solve, not from it, so they always display honestly.
        const isBlankable = (name) => !cellPreSolveVars.has(name);

        // Per-cell balance check: track failure separately from blanking,
        // because a row can fail balance without any var to blame (e.g. the
        // user's outer INPUTs and the iterator together don't satisfy an
        // equation). The row still counts as unsolved — we just don't hide
        // any column. When there IS a body-derived var in the failing eq,
        // blank it (and body unknowns).
        let balanceFailed = false;
        for (const beq of balanceEquations) {
            try {
                const leftVal = evaluate(beq.leftAST, context);
                const rightVal = evaluate(beq.rightAST, context);
                const modN = beq.modN ? (record.degreesMode ? 360 : 2 * Math.PI) : null;
                const result = modN
                    ? modCheckBalance(leftVal, rightVal, modN, balancePlaces)
                    : checkBalance(leftVal, rightVal, balancePlaces);
                if (!result.balanced) {
                    balanceFailed = true;
                    for (const unk of unknowns) badVars.add(unk.name);
                    for (const v of beq.eqVars) {
                        if (isBlankable(v)) badVars.add(v);
                    }
                }
            } catch (e) { }
        }
        // Transitive propagation: if any variable in an equation is already
        // bad, treat the equation's other body-derived vars as bad too —
        // their values were computed from (or constrained with) a bad var.
        // Handles cases like `x = x + 1` (fails → x bad) then `x = z` (balances
        // trivially because z was derived from x, but z is still unreliable).
        // Outer INPUTs and iterators aren't propagated to (their values came
        // from the user, not from the failing solve). Repeat until stable.
        let changed = true;
        while (changed) {
            changed = false;
            for (const beq of balanceEquations) {
                let hasBad = false;
                for (const v of beq.eqVars) {
                    if (badVars.has(v)) { hasBad = true; break; }
                }
                if (!hasBad) continue;
                for (const v of beq.eqVars) {
                    if (isBlankable(v) && !badVars.has(v)) {
                        badVars.add(v);
                        changed = true;
                    }
                }
            }
        }
        return { badVars, balanceFailed };
    }

    // Extract a column's value after evaluateCell ran. Three cases:
    //   AST column (`Label z+1->`)  → evaluate expression
    //   Column with limits          → full-pipeline re-solve (fast path if
    //                                 the cell-solve value is already in range)
    //   Plain column (`z->`)        → read from context
    // Callers apply their own badVars filter and angular normalization.
    function getColumnValue(col) {
        if (col.ast) {
            try { return evaluate(col.ast, context); } catch (e) { return undefined; }
        }
        if (col.limits) {
            if (noEquationColumns.has(col.name)) return undefined;
            const { value } = resolveWithLimits(
                col.name, col, equations, tableDeclarations,
                context, record, cellPreSolveVars);
            return value;
        }
        return context.getVariable(col.name);
    }

    // ==================== VECTORDRAW (polar vector diagram) ====================
    if (tableDef.keyword === 'vectordraw') {
        // Each vector is 4 columns: start_dir, start_mag, end_dir, end_mag
        if (columns.length === 0 || columns.length % 4 !== 0) {
            errors.push(`Line ${tableDef.startLine}: vectorDraw requires multiples of 4 outputs (start_dir, start_mag, end_dir, end_mag per vector)`);
            return emptyResult();
        }
        // Solve once (no iteration yet) — use balance check to suppress bad values
        const { badVars } = evaluateCell([]);
        // Wraparound normalization for 'degrees'-format columns: large values
        // (or bogus solver results far outside the principal range) lose
        // precision in Math.sin/cos when the graph is rendered.
        const angularM = record.degreesMode ? 360 : 2 * Math.PI;
        function getColValue(col) {
            if (!col.ast && badVars.has(col.name)) return undefined;
            let value = getColumnValue(col);
            if (value != null && isFinite(value) && col.format === 'degrees') {
                value = value - angularM * Math.floor(value / angularM);
            }
            return value;
        }
        // Format a column's value for text output using its own format specifier
        function formatColValue(col, value) {
            if (value == null || !isFinite(value)) return '';
            return formatVariableValue(value, col.format, !!col.fullPrecision, formatOpts);
        }
        // Tally solveInfo by *distinct variables* referenced across all
        // columns: how many unique vars are bound vs. how many are referenced.
        // This matches the user's reading of "N unsolved cells" by collapsing
        // duplicate references (e.g. `cts` appearing in two different columns
        // counts once) and ignoring pure-constant columns entirely.
        const refVars = new Set();
        for (const col of columns) {
            if (col.ast) {
                for (const v of findVariablesInAST(col.ast)) refVars.add(v);
            } else if (col.name) {
                refVars.add(col.name);
            }
        }
        let definedVars = 0;
        for (const v of refVars) {
            if (!badVars.has(v) && context.hasVariable(v)) definedVars++;
        }
        const solveInfo = definedVars < refVars.size
            ? { solved: definedVars, total: refVars.size }
            : null;

        // Group columns into vectors of 4 for the output.
        const vectors = [];
        for (let i = 0; i < columns.length; i += 4) {
            const sdCol = columns[i], smCol = columns[i + 1];
            const edCol = columns[i + 2], emCol = columns[i + 3];
            const startDir = getColValue(sdCol);
            const startMag = getColValue(smCol);
            const endDir = getColValue(edCol);
            const endMag = getColValue(emCol);
            // Label preference: end-direction column's label, then end-mag's label
            const dirLabel = (edCol.header && edCol.header !== edCol.name) ? edCol.header : null;
            const magLabel = (emCol.header && emCol.header !== emCol.name) ? emCol.header : null;
            vectors.push({
                startDir, startMag, endDir, endMag,
                dirName: edCol.name, dirLabel,
                magName: emCol.name, magLabel,
                // Column info + formatted values for text output
                cols: [sdCol, smCol, edCol, emCol],
                formatted: [
                    formatColValue(sdCol, startDir),
                    formatColValue(smCol, startMag),
                    formatColValue(edCol, endDir),
                    formatColValue(emCol, endMag)
                ]
            });
        }
        return {
            type: 'vectorDraw',
            keyword,
            title: expandedTitle,
            vectors,
            formatOpts,
            fontSize,
            solveInfo,
            startLine: tableDef.startLine,
            endLine: tableDef.endLine,
            errors
        };
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
        let goodRows = 0, totalRows = 0;

        for (let rowCount = 0; ; rowCount++) {
            const val = iter.start + rowCount * iter.step;
            if (iter.step > 0 ? val > iter.end : val < iter.end) break;
            if (rowCount >= maxRows) { errors.push(`Line ${tableDef.startLine}: Table exceeded ${maxRows} rows`); break; }

            context.preSolveValues = rowCount === 0 ? new Map() : prevValues;
            const { badVars, balanceFailed } = evaluateCell([{ name: iter.name, value: val }]);
            totalRows++;
            if (!balanceFailed && badVars.size === 0 && unknowns.every(u => context.hasVariable(u.name))) goodRows++;

            // Collect output values (formatted and raw)
            const row = [];
            const rawRow = [];
            for (const col of columns) {
                if (badVars.has(col.name)) { row.push(''); rawRow.push(null); continue; }
                const value = getColumnValue(col);
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
        const solveInfo = goodRows < totalRows ? { solved: goodRows, total: totalRows } : null;
        return { type, keyword, title: expandedTitle, columns, rows, rawRows, formatOpts, fontSize, solveInfo, startLine: tableDef.startLine, endLine: tableDef.endLine, errors };
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

    // Thin wrapper around the shared getColumnValue that tolerates null col
    // (grid call sites pass rowHeaderCol/colHeaderCol/cellVar which may be absent).
    function getColValue(col) {
        if (!col) return undefined;
        return getColumnValue(col);
    }

    const isGridGraph = tableDef.keyword === 'gridgraph';
    const grid = [];
    const rawGrid = [];
    const rawRowHeaderValues = [];
    const rawColHeaderValues = [];
    const formattedRowValues = [];
    const formattedColValues = [];
    let goodCells = 0, totalCells = 0;
    for (let r = 0; r < rowValues.length; r++) {
        const gridRow = [];
        const rawGridRow = [];
        for (let c = 0; c < colValues.length; c++) {
            context.preSolveValues = new Map();
            const { badVars, balanceFailed } = evaluateCell([
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

            // Track solve success per cell
            totalCells++;
            if (!balanceFailed && badVars.size === 0 && unknowns.every(u => context.hasVariable(u.name))) goodCells++;

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
    const solveInfo = goodCells < totalCells ? { solved: goodCells, total: totalCells } : null;
    return {
        type, keyword, title: expandedTitle, solveInfo,
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
        solveRecord, solveEquations, formatOutput, solveEquationInContext, findVariablesInAST, buildVariablesMap, appendTraceSection
    };
}
