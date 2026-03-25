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

## \expr\ substitutions
    An expr enclosed in backslashes is replaced by the result. Variables may be used if they have a known value.  The substitutions are done during variable discovery.
        \3+4\ becomes 7
        If x: 3, then \x+2\ becomes 5.  If x does not have a value, it's an error
        \cos(1)\ should become 0.5403 (assuming Decimal Places is set to 4)

## --Variables-- section
    A --Variables-- line in formulas text causes only items below it to appear in the variables panel.
    Plain text lines become labels, empty lines become spacers, // lines are hidden.

## Special records
    "Constants" — variables available to all records
    "Functions" — user-defined functions: f(x;y) = expr
    "Default Settings" — template for new record settings

## Definition evaluation order
    : definitions are evaluated in discoverVariables, not in solveEquations
    Retry pass: deferred definitions are retried iteratively until no more progress
    Handles out-of-order deps and chained deps; circular deps terminate cleanly

## Two-sweep equation solving (Pass 2)
    Sweep 0: solve equations with 1 natural unknown (no substitutions)
        Auto-inlines definition equations for undeclared intermediate variables
    Sweep 1: use substitutions for remaining equations
    Break-on-solve: after Brent's solves one equation, break out so definitions can evaluate with the new value
    solveEquations takes equations as parameter (caller owns equation discovery)
        Enables reuse by both main solver and table/grid per-row evaluation

## Algebraic substitution
    deriveSubstitution in solver.js via tryIsolateVariable
    Recursive peeling of binary operations one level at a time via invertOperation
    Handles arbitrary-depth nesting (e.g., a*b/D = C → a = C*D/b)

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
        Each row/cell solved fresh via solveEquations (same pipeline as main solver)
        Pre-solve context reset per row (user declarations only)
        Per-cell error suppression (bad cells empty, good cells show values)
        Unused variable warnings with actual line numbers
    ### Rendering (variables-panel.js)
        setTableData() renders table results in variables panel
        _renderTable2() renders 2D grids with row/col/header hover highlighting
        Collapsible titles (click to toggle)
        Table output text section ("--- Table Outputs ---") appended for copy/export
