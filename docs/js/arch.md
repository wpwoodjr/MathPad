# Variables
This document uses indentation and formatting (#, ##, ###) to indicate a hierarchy of relevance

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
        But not this, because y is not set until after x:
            x: y
            y: 2

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

## Variables really only have a name and a value (and possibly a valueText if needed for equations).  
    It should be an error to specify a variable with an input syntax (: :: or <-) if it already has a value for whatever reason.
    Error if input var (: :: <-) references unknown variable
    Variables are always stored with full precision.  Formatting options ($, %, #, ::, ->>) are not inherent to the variable.

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
            outputs as rate/100 with 2 digits of precision
        rate%: 5
            inputs as 5
            outputs as rate/100 with 2 digits of precision
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
        pmt$: (formatted as $ followed by pmt with precision 2)
        rate%: (formatted as pmt with precision 2 followed by %)
        pmt$:: (formatted as $ followed by pmt with full precision)
        rate%->> (formatted as rate with full precision followed by %)
        hexnum#16: (formatted as hexnum in base 16 followed by #16)
    
    ### Variable clearing
        When seeing -> and ->> this indicates that the RHS (not including any comments) on that line should be cleared by the Clear button, or before solving
        When seeing <- this indicates that the RHS (not including any comments) on that line should be cleared by the Clear button

## Limits
    Limits are a applied during output. Examples:
        x[0:1E2]::
        vname[lowlimit:highlimit]->
    Limits may be combined with formats:
        x[0.0:0.2]%:
    A variable may be solved more than once with different limits:
        x[0:1]->
        x[-1:0]->

# Other
## Final Output
    Known values are inserted for -> and ->> delcarations
    Known values are inserted for : or :: declarations that don't have a RHS

## Incomplete equations
    Incomplete equations are equations without a RHS.  The answer is inserted at the RHS during final output.
    Example:
        2**32 - 1 =
        y + x =
            y and x must have values (after solving)

## \expr\ substitutions
    An expr enclosed in backslashes is replaced by the result. Variables may be used if they have a known value.  The substitutions should be done during variable discovery and again during final output.
        \3+4\ becomes 7
        If x: 3, then \x+2\ becomes 5.  If x does not have a value, leave the \expr\
        \cos(1)\
