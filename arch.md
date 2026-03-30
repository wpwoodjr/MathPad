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
            heading =° target_heading
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
    Limits may be combined with formats:
        x[0.0:0.2]%:
    A variable may be solved more than once with different limits:
        x[0:1]->
        x[-1:0]->

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

## solveEquations iterative loop
    solveEquations(context, declarations, record, equations, bodyDefinitions)
    Used by both main solver (solveRecord) and table/grid per-row evaluation (evaluateCell)

    while (changed && iterations < 50):

        ### [1] Body definitions (:defs not yet resolved)
            Evaluates bodyDefinitions (array of {name, ast}), skips if already has value
            Outer solve: declarations that failed during discoverVariables
                (out-of-order deps like b: a+3 before a: 5, or equation-dependent like x: pmt*2)
            Table body: defASTs from table body declarations (cleared per row)

        ### [2] Build substitution map (buildSubstitutionMap in solver.js)
            For each equation:
                Try isDefinitionEquation (left side simple variable)
                Else try deriveSubstitution (algebraic isolation)
                Multiple subs per variable stored as array (first + alternates)
            deriveSubstitution uses tryIsolateVariable — recursive peeling of binary ops
                via invertOperation, handles arbitrary-depth nesting (a*b/D = C → a = C*D/b)

        ### [3] Evaluate fully-known substitutions
            For each variable's subs array: try each, evaluate first fully-evaluable one
            Check limits, set variable. Direct computation avoids Brent's.
            Alternates enable direct eval when primary sub has unknowns
                (e.g. k has sub k→j+350 with unknown j, alt k→l/2 with known l)

        ### [4] Build sweep subs (only if [3] didn't set changed)
            Filter substitutions: variable has no value, no limits
            Uses first sub per variable for inlining
            Serves as skip list for sweep 0 and substitutions for sweep 1

        ### [5] Equation solving (only if nothing changed)
            Sweep 0: no subs → natural 1-unknown equations only
                Skip if the sole unknown is in [4] (should be substituted, not solved directly)
                Prevents spurious roots (e.g. adjTemp solved from hours equation in isolation)
            Sweep 1: apply [4] subs → solve equations reduced to 1 unknown
            Incomplete equations (expr =): evaluate and insert result
            For definition equations (var = expr):
                If RHS fully known: skip (already handled by [3])
                If variable has no value: skip (don't Brent's a bare definition)
                Otherwise fall through to Brent's (e.g. user set x:5, solve x=a+b for a)
            Brent's root-finding for 1-unknown equations
            Break-on-solve: after solving one equation, restart loop so [1] and [3]
                can evaluate with the new value before a second Brent's step

## Definition evaluation order
    discoverVariables evaluates : definitions in a single top-to-bottom pass (no retry loop)
    Definitions that fail (out-of-order deps, equation-dependent) go into bodyDefinitions
    solveEquations handles them in its iterative loop via [1]
    preSolveVars updated with resolved bodyDefinition values after solve (for table access)

## Tables and Grids
    ### Syntax
        table("Title") = { body }       columnar output, 1+ iterators
        table("Title"; fontSize) = { body }   optional font size
        grid("Title") = { body }        2D cell grid, 2+ iterators
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
        Unused variable warnings with actual line numbers
    ### Rendering (variables-panel.js)
        setTableData() renders table results in variables panel
        _renderTable2() renders 2D grids with row/col/header hover highlighting
        Collapsible titles (click to toggle)
        Table output text section ("--- Table Outputs ---") appended for copy/export
