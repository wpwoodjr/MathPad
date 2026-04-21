# MathPad Architecture Notes
This document describes the variable and equation system design.
Uses indentation and formatting (#, ##, ###) to indicate hierarchy of relevance.

## Input variables:
    ### Input variables may have constant assigned values, for example:
        x: 3
        x<- 3
        x: 16/9
        x<- 16/9
        x: sqrt(3)
            3 is a constant so sqrt can evaluate it
        x: pi

        If y already has a value, then other variables can be set using it:
            y: pi
            x: y
            y2: y**2
        Out-of-order and chained dependencies are handled automatically:
            x: y
            y: 2
            (x evaluates to 2 via retry pass)

    ### Equation examples (equations use =)
        x = 3
            Would make more sense to say "x: 3" but this example should work
        x = 16/9
            Would make more sense to say "x: 16/9" but this example should work
        16/9 = x
        x*9 = 16
        These are all the same:
            width = height*9/16
            height = width*16/9
            width/height = 9/16
            9/16 = width/height
            9 = 16*width/height
            width*16 = height*9
        Equations may need substitution simplification:
            width/height = 9/16
                might become width = height*9/16
            width * height = 1000
                becomes height/9/16 * height = 1000
        pmt = -(pv + fv / (1 + mint)**n) * mint / (1 - (1 + mint)**-n)
        Degree equality:
            heading °= target_heading
                mod-aware comparison (mod 360 or mod 2π per degreesMode)

## Variables really only have a name and a value (and possibly a valueText if needed for equations).
    It should be an error to specify a variable with an input syntax (: :: <- <<-) if it already has a value for whatever reason.
    Error if input var (: :: <- <<-) references unknown variable
    Variables are always stored with full precision.  Formatting options ($, %, °, #, ::, ->>) are not inherent to the variable.

## Variable markers
    ### Input markers:
        :       persistent
        <-      cleared by Clear button
        <<-     full precision, cleared by Clear
        ::      full precision, persistent
    ### Output markers:
        ->      cleared before solve
        ->>     full precision, cleared before solve
        :>      persistent output (cleared before solve, NOT by Clear)
        :>>     persistent output, full precision

## Formatting options
    ### Example input formatting:
        These are all the same for input parsing:
            pmt: $10,000
            pmt$: $10,000
            pmt$: 10,000
        pmt: $3.999
            doesn't lose precision, stores internally as 3.999 not 4.00
        rate%: 5%
            inputs as 0.05
            outputs as rate*100 with record's decimal places setting
        rate%: 5
            inputs as 5
            outputs as rate*100 with record's decimal places setting
        angle°: 400
            outputs as mod 360 with record's decimal places setting
        These are all the same for input parsing:
            hexnum: 255
            hexnum: 0FF#16
            hexnum#16: 255
            hexnum#16: 377#8
                hexnum#16 determines how hexnum is formatted on output, not the format of the input value which has its own formatting
            hexnum: FF#16
                leading zeros should not be necessary when disambiguating variables from numbers with bases since the # indicates a number with a base
        octalnum: 100#8
        base17num<- G0#17

    ### Example formatting on output:
        pmt$: (formatted as $ followed by pmt with 2 decimal places, comma grouping)
        rate%: (formatted as rate*100 with record's places setting followed by %)
        angle°: (formatted as angle mod 360 with record's places setting followed by °)
        pmt$:: (formatted as $ followed by pmt with full precision)
        rate%->> (formatted as rate*100 with full precision followed by %)
        hexnum#16: (formatted as hexnum in base 16 followed by #16)

    ### Variable clearing
        When seeing -> ->> :> :>> this indicates that the RHS (not including any comments) on that line should be cleared before solving
        When seeing <- <<- this indicates that the RHS (not including any comments) on that line should be cleared by the Clear button
        :> :>> are NOT cleared by the Clear button (persistent outputs)

## Limits
    Limits are applied during solving to constrain Brent's search range. Examples:
        x[0:1E2]::
        vname[lowlimit:highlimit]->
        x[0:10:0.5]->                           explicit step for Brent's grid scan
    Limits may be combined with formats:
        x[0.0:0.2]%:
    A variable may be solved more than once with different limits:
        x[0:1]->
        x[-1:0]->
    Order doesn't matter for numeric limits — auto-swap normalizes [50:0] to [0:50].
    For angular variables (° format), [low:high] with low > high (mod M) is treated
    as the arc through 0:
        cmg[327.8:5.5]°::                       arc through 0° (37.7° wide)
    Brent's shifts the search range to span this arc; the substitution path uses
    mod-aware comparison and normalizes the value into the user's range.
    M = 360 in degrees mode, 2π in radians mode.

    Limits may reference other variables:
        y[0:x*2]<-                              x can be a known input or solved variable
    If the limit expression depends on a variable that hasn't been solved yet,
    the solve attempt is deferred and retried after the dependency is solved.
    Undefined references in limits are reported at end-of-solve.

## Pre-solve values
    x~      strictly returns value before this solve started
    x~?     1 if x has a pre-solve value, 0 otherwise
    Example: counter: if(counter~?; counter~ + 1; 0)

# Other
## Final Output
    Known values are inserted for -> ->> :> :>> declarations
    Known values are inserted for : or :: declarations that don't have a RHS

## Incomplete equations
    Incomplete equations are equations without a RHS.  The answer is inserted at the RHS during final output.
    Example:
        2**32 - 1 =
        y + x =
            y and x must have values (after solving)

## \expr\ in table/grid titles
    Only supported in table/grid title strings for display purposes.
    Example: table("Payment for \pv$\ loan at \rate%\") = { ... }
    Evaluated via expandInlineExprs (display-only, does not modify source text).

## --Variables-- section
    A --Variables-- line in formulas text causes only items below it to appear in the variables panel.
    Plain text lines become labels, empty lines become spacers, // lines are hidden.

## Special records
    "Constants" — variables available to all records
    "Functions" — user-defined functions: f(x;y) = expr
    "Default Settings" — template for new record settings

## Record Created/Modified Timestamps
    record.created and record.modified are Unix ms timestamps shown in the details panel.

    Created:
        - Set by createRecord() and record duplication via Date.now()
        - Backfilled with sentinel Date.UTC(2026, 3, 1, 3, 14, 15, 926) for legacy records
          (loadData / reloadUIWithData / handleImport call backfillRecordTimestamps)

    Modified:
        - Updates ONLY on direct user input to the textarea (typing, Tab indent, Ctrl+/ comment)
        - Does NOT update on solve, clear, vars panel input, or programmatic changes
        - New records and duplicates start with modified=null (displays as "—")
        - Driven by the userInput parameter on editor.notifyChange:
            notifyChange(metadata, undoRedo, userInput, modifiedAt)
        - userInput=true is passed by onInput (typing) and replaceRange (Tab/Ctrl+/)
        - userInput=false (default) for setValue (solve, clear, vars panel, programmatic)

    Per-undo-state preservation:
        - Each undo state stores a modifiedAt field
        - Editor tracks lastUserEditAt; updated only on userInput=true
        - Programmatic state pushes (setValue) inherit lastUserEditAt unchanged
        - Undo/redo pops a state, restores its modifiedAt to lastUserEditAt, and passes
          modifiedAt to notifyChange. The listener applies it to record.modified.
        - Initial state seeded from record.modified at editor construction time

    Persistence:
        - localStorage and Drive: automatic via JSON
        - Export/import: optional Created = "ISO8601"; Modified = "ISO8601" line
        - Import leaves fields undefined when not in source (so test roundtrips don't add the line)

## solveEquations — recursive backtracking solver
    solveEquations(context, declarations, record, equations, bodyDefinitions)
    Used by both main solver (solveRecord) and table/grid per-row evaluation (evaluateCell)

    The top-level loop is solveRecursive(depth). Each recursion level runs
    deterministicAdvance (phases [1]-[4] below, all zero-branching work), then
    enumerateAlternatives yields candidate decisions (Kind 1/2/3). For each
    candidate the backtracker snapshots state, applies the decision, and
    recurses. First branch that balances wins; if none do, falls back to the
    best-progressed snapshot via first-wins saveCandidate. maxIterations = 50
    caps recursion depth.

    The solver's variables map contains only INPUT declarations — OUTPUT
    limits are display-only, handled by resolveWithLimits after the solve.
    (See the buildVariablesMap filter in solve-engine.js.)

        ### [1] Body definitions (pendingBodyDefs retry)
            Evaluates bodyDefinitions whose deps are now known. Retried each pass.
            Outer solve: declarations that couldn't evaluate at discoverVariables
                (out-of-order deps like b: a+3 before a: 5, or equation-dependent like x: pmt*2)
            Table body: defASTs from table body declarations (cleared per row)

        ### [2] Build substitution map (buildSubstitutionMap in solver.js)
            For each equation, deriveSubstitutions (generator) yields every
            algebraically isolable unknown. Symmetric — both LHS-with-RHS-as-
            target and RHS-with-LHS-as-target are explored. All yields added
            to the map; multiple entries for the same variable become alternates.

            tryIsolateVariables walks a BINARY_OP tree, exploring BOTH subtrees
            at every level via invertOperation — handles arbitrary-depth nesting
            (a*b/D = C → a = C*D/b AND b = C*D/a; var*B + C = D → var = (D-C)/B).

            Cycles in the sub map are allowed (e.g., `x → z/2` and `z → 2*x` from
            `x = z/2`). substituteInAST's cycle guard (visited-set) ensures
            runtime termination, and subset-enumerated Kind 3 combos try each
            direction independently before any combo applies both together.

            Legacy single-result wrappers `deriveSubstitution` and
            `tryIsolateVariable` are kept for back-compat (return first yield).

        ### [3] Evaluate fully-known substitutions
            For each variable's subs array: classify fully-known subs into
            non-NaN candidates (finite or ±Infinity) and NaN fallbacks.
                0 non-NaN + 0 NaN   → deferred (wait for deps)
                1 non-NaN           → forced choice; apply via applyDirectValue
                2+ non-NaN          → ambiguous; defer to Kind 1 branching
                0 non-NaN + 1 NaN   → NaN fallback, apply (user sees degenerate)
                0 non-NaN + 2+ NaN  → deferred
            applyDirectValue checks INPUT-limits (OUTPUT limits are filtered
            out of the solver's variables map).

        ### [4] Build sweep subs (only if [3] made no progress)
            definitionSubs: variables without values and without INPUT+limits.
            Kept as arrays of alternates (Kind 3 iterates subsets × cartesian).

        ### [5] Branching — enumerateAlternatives yields candidates
            Kind 1: direct-eval alternates — variables with ≥2 non-NaN fully-
                    known subs, yielded one per alternate.
            Kind 2: sweep-0 natural 1-unknown equations — Brent's allRoots.
                    Skip if unknown is in definitionSubs (defer to Kind 3).
            Kind 3: sweep-1 subset-enumerated combos × equations × roots.
                    subCombinations yields in increasing subset size order:
                    size 0 = {} (no subs), size 1 = each sub alone, …,
                    size N = full cartesian. Preferring smaller subsets first
                    keeps cyclically-related sub pairs from cancelling via the
                    cycle guard's round-trip (handles width/height-style
                    systems cleanly). Bare-def equations are filtered only
                    when the combo has no non-self sub to apply (self-source
                    subs are stripped by solveEquationInContext, so would yield
                    a tautology).

            Each candidate tried: snapshot → applyDecision → recurse. On
            balanced, return up. On failure, restoreState and try next.

        ### Brent's (solveEquation in solver.js)
            Brent's for 1-unknown equations after substitutions applied.
            tryBracket helper: unified singularity/pole rejection for all bracket
                paths (main scan, near-tangent detection, expandFromGuess fallback).
                Rejects: non-finite fRoot, mod-wrap discontinuities (|fRoot| > modN/4),
                singularities (|fRoot| > max endpoint — pole, not real root).
            expandFromGuess skipped for mod-aware (°=) equations: trig arg reduction
                loses precision at large magnitudes, producing garbage "roots".
            allRoots=true: returns ordered array of all roots found (Kind 2/3).
            Limit deferral: if a variable's limit expression depends on a not-yet-
                solved variable, return { solved: false, limitsDeferred: true } and
                retry on a later Advance pass.

    ## OUTPUT-with-limits re-solve (resolveWithLimits in solve-engine.js)
    Main solve treats all OUTPUT limits as display-only. After main solve, each
    OUTPUT declaration with limits runs its own re-solve:
        Fast path: main-solve value already in declared limits → use it.
        Slow path: filter declarations, prepend a single INPUT entry for the
            target carrying the OUTPUT's limits, call solveEquations with
            modifiedDecls. buildVariablesMap picks the prepended entry (first-wins).
            solveEquations runs the full pipeline, producing the re-solved value.
        Results stored under `__resolvevar_${lineIndex}` in computedValues;
        formatOutput consults that key per-declaration. Slow-path errors are
        returned and merged into solveRecord's errors array (deduped by string).
        innerError removed — slow-path errors carry their own correct line numbers
        because modifiedDecls uses the target lineIndex.

    ## Re-solve pass (always runs)
    After the first solve, formatOutput writes solved values back into the text.
    A second solveRecord pass then runs on the formatted text:
        - First pass always passes skipTables=true (saves duplicate work)
        - Re-solve runs unconditionally and computes tables
        - Re-solve catches rounding errors (rounded values may not satisfy tight tolerances)
        - Re-solve gives a second chance when first solve filled in cleared variables
          but had balance errors (the formatted text may now be self-consistent)
    Both run-tests.js and gen-expected.js use the same flow.

    ## End-of-solve limit validation
    After the recursive loop, validate every declared variable's limit expressions
    (low, high, step). Report undefined references separately as errors. This catches
    bugs where a variable has a value (so the per-attempt limit check doesn't run)
    but its limit expressions are broken.

    ## Solver completeness
    For MathPad's scope (algebraic & practical multi-equation systems), the
    solver covers:
        Algebraic derivation via tryIsolateVariables + invertOperation for
            BINARY_OP chains.
        Multi-sub symmetry — every isolable unknown per equation gets a sub,
            both directions.
        Kind 1 direct-eval for fully-known substitutions, with multi-candidate
            branching for ambiguous cases.
        Kind 2 sweep-0 natural 1-unknown equations via Brent's allRoots.
        Kind 3 sweep-1 subset-enumerated combos over subs × equations × roots.
        Recursive backtracking with snapshot/restore and best-candidate fallback.
        Cycle-safe substitution via substituteInAST's visited-set guard.
        Angular-aware math via °= equations' modN and modN-aware balance check.
        Cross-source subs reducing bare-def equations (Kind 3 filter refinement).
        OUTPUT-with-limits re-solve via resolveWithLimits (full-pipeline).

    Known gaps (by design or scope):
        FUNCTION_CALL sub derivation: abs(x) = z/2, log(x) = y can't isolate x.
            Only the RHS side gets a sub. Monotonic inverses would be
            straightforward to add; non-monotonic (abs) adds branching.
        Genuine multi-unknown numerical root-finding: Brent's is 1D. Systems
            irreducible to 1-unknown by any combo (e.g., sin(x)+cos(y)=1,
            x*y=2) give up. Would need Newton-Raphson or similar 2D solver.
        Global optimization: Brent's requires a sign change. Non-convex
            systems outside knownScale's range may miss brackets.
        Root selection without hints: when multiple valid solutions exist
            (navigation triangle, polynomial with several real roots), the
            solver picks whichever enumeration order finds first. Users
            disambiguate via limits or initial guesses.
        Complex roots: real-only by design. x² = -1 fails.
        Symbolic simplification: x² = y² ⟹ x = ±y isn't algebraically
            recognized. Found numerically via Brent's allRoots if at all.

## Definition evaluation order
    discoverVariables parses literal values (numbers, dates, durations) directly via parseLiteralValue()
    Literals set on context immediately; non-literals (expressions) go into bodyDefinitions
    bodyDefinitions skipped when decl.value !== null (already parsed as literal)
    solveEquations handles expression definitions in its iterative loop via [1]
    preSolveVars updated with resolved bodyDefinition values after solve (for table access)

## Tables, Grids, and Vector Diagrams
    ### Syntax
        table("Title") = { body }       columnar output, 1+ iterators
        table("Title"; fontSize) = { body }   optional font size
        grid("Title") = { body }        2D cell grid, 2+ iterators
        vectorDraw("Title") = { body }  SVG polar vector diagram
    ### Body declarations
        x<- 0..10          iterator (range, step defaults to 1 or -1)
        x: 0..10..2        iterator with explicit step
        z<-  or  z:         unknown (bare, no value) — solved by equations
        z[lo:hi]<-          unknown with limits
        v: 10               definition (expression value)
        Label z->           output column with optional label
        (expr)->            expression output column
    ### Tokens
        .. is DOT_DOT token (parser.js) for range syntax
    ### Equation inheritance
        If body has equations, only those are used
        If body has no equations, outer record equations are inherited
    ### Evaluation (solve-engine.js: evaluateTable)
        findTableDefinitions (variables.js) detects table/grid blocks
        Table lines added to localFunctionLines skip set (not treated as record equations)
        Each row/cell: reset context to preSolveVars, clear unknowns, set iterators
        Calls solveEquations with body defASTs as bodyDefinitions (same pipeline as main solver)
        Per-cell error suppression (bad cells empty, good cells show values)
        Per-cell balance checking: equations containing unknowns verified after solve
        Unused variable warnings with actual line numbers
    ### Grid axis and output mapping
        Iterator declaration order determines axes: first = rows, second = columns
        Output declaration order determines display: first = row headers, second = col headers, third = cell value
        Header values computed from output variable after solving (enables formatted headers like hours@t->)
    ### Equation pre-parsing (preParseEquations)
        Equation ASTs (leftAST, rightAST, allVars) parsed once onto equation objects
        Reused by: solveEquationInContext, buildSubstitutionMap, balance checks, per-cell evaluation
    ### vectorDraw
        Each vector is 4 outputs: start_dir °->, start_mag ->, end_dir °->, end_mag ->
        Start pair is absolute polar from origin; end pair is relative displacement
        Labels on end pair identify vector in legend
        Bearing convention: north up, angles clockwise (sin θ, -cos θ)
        Degrees/radians mode aware; degrees-format values normalized mod M at capture
        Single solve (no iteration); balance check suppresses bad values
        Unique SVG marker IDs via global counter (avoids cross-record DOM collisions)
    ### Solve status indicator
        When not all rows/cells/unknowns solve, title shows "(n/m solved)"
        Per-row (table), per-cell (grid), per-unknown (vectorDraw)
        Requires both: no badVars AND unknown has value in context
        Hidden when everything solves (solveInfo is null)
    ### Rendering (variables-panel.js)
        setTableData() renders table results in variables panel
        _renderTable2() renders 2D grids with row/col/header hover highlighting
        _renderVectorDraw() renders SVG vector diagrams with arrowheads and legend
        Collapsible titles (click to toggle)
        Table output text section ("--- Table Outputs ---") appended for copy/export
        Text output prefixed with keyword (e.g., table "Title", grid "Title", vectordraw "Title")
        Legend values use formatVariableValue (respects places, stripZeros, groupDigits)
