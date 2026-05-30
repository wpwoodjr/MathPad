/**
 * MathPad Storage - localStorage persistence and import/export
 */

const STORAGE_KEY = 'mathpad_data';
const STORAGE_VERSION = 2;

/**
 * Strip the three "appended by solveRecord" sections from a record's text:
 *   "--- Table Outputs ---"
 *   "*--- Solve Trace ---"
 *   "*--- Reference Constants and Functions ---"
 * Matches the leftmost marker and eats from there to EOF, so all three
 * appended sections come off in a single pass. Used on initial load and
 * when editing the formulas; persistence (saveData, driveSaveFile) calls
 * cleanDataForSave below to keep these display artifacts out of storage.
 */
const STALE_SECTIONS_RE = /\n*"\*?--- (Table Outputs|Solve Trace|Reference Constants and Functions) ---"[\s\S]*$/;
function stripStaleSections(text) {
    return text.replace(STALE_SECTIONS_RE, '');
}

/**
 * Return a save-ready shallow clone of `data` with each record's text
 * stripped of the appended Tables/Trace/References sections. The in-memory
 * data object is left untouched so the editor keeps showing its current
 * value within the session.
 */
function cleanDataForSave(data) {
    if (!data || !data.records) return data;
    return {
        ...data,
        records: data.records.map(r => ({ ...r, text: stripStaleSections(r.text) }))
    };
}

const DEFAULT_SETTINGS_RECORD = {
    title: 'Default Settings',
    text: `"New Record"

--Variables--

"*This is the template for new records"

"The first line is the default title for new records. This record's settings (for example Decimal Places) are also used as defaults for new records."

"Generally, put functions and equations above the --Variables-- section.  Variable definitions can go here in the --Variables-- section or above it.  When in the Variables section, they'll be visible in the variables panel."`,
    category: 'Reference',
    places: 4,
    stripZeros: true,
    groupDigits: true,
    format: 'float',
    degreesMode: false,
    currencySymbol: '$'
};

/**
 * Default data structure
 */
function createDefaultData() {
    // Generate Welcome record ID first so we can set it as the initial record
    const welcomeRecordId = generateId();

    return backfillRecordTimestamps({
        version: STORAGE_VERSION,
        records: [
            {
                id: welcomeRecordId,
                title: 'Welcome',
                text: `"Welcome"

--Variables--

"*Welcome to MathPad!"

"MathPad was originally created by Rick Huebner for PalmOS PDAs (circa 1997-2000).  Quoting from the original documentation: MathPad is a tool for solving and storing mathematical equations in standard algebraic syntax ... if you write down an equation and tap the Solve button, it computes the answer and fills it in for you. These equations can be simple math expressions like 2+2=, or algebraic expressions using variables such as:"

  sqrt(x+4) / acos(0.7) = y**3

"Press the Solve button (above) to see the value of x when y is 0.53 and also a graph of the equation (hint - you can expand this panel by dragging the divider above 'FORMULAS' below)."

  x->
  y: 0.53

tableGraph("v sqrt(x+4) / acos(0.7) = y**3") = {
  x: -2.5..4.5..0.5
  y<-
  x->
  y->
}


"*MathPad for web"

"I've always loved MathPad but never found anything to replace its combination of simplicity and power.  This is a modern web-based reimplementation.  Most original MathPad records should still work.  Some new features include:

  * Tables, grids, and graphs
  * Vector diagrams - polar, navigation, and cartesian
  * Split panes - variables pane for data entry/display, formulas pane for definitions
  * Solver with recursive backtracking and algebraic substitution
  * Format suffixes — $ (money), % (percent), ° (mod-aware degrees), @d (date), @t (duration)
  * Degrees/radians mod-aware equality operator °=
  * Written with pure client-side JavaScript
  * Auto saves to local storage
  * Google Drive integration (in testing)

Try some of the examples and have fun!

On mobile, the examples are under the hamburger (three bars) icon at top left."`,
                category: 'Tutorial',
                places: 1,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
            },
            {
                id: generateId(),
                title: 'Tutorial 1.1: Your First Equation',
                text: `"Tutorial 1.1: Your First Equation"

--Variables--

"*Your First Equation"

"MathPad solves equations. You set some values, leave others blank, and press Solve."

"Below, the equation 'a + b = c' uses three variables. a and b are inputs (you can edit them). c is an output ('c->' tells the solver to fill it in)."

a: 3
b: 4

a + b = c

c->

"*Try it"

"Press Solve (or Ctrl+Enter). c becomes 7."

"Then change a or b above and Solve again — c updates."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 4, 29, 20, 0, 0),
            },
            {
                id: generateId(),
                title: 'Tutorial 1.2: Any Variable Can Be the Unknown',
                text: `"Tutorial 1.2: Any Variable Can Be the Unknown"

--Variables--

"*Any Variable Can Be the Unknown"

"In MathPad, an equation isn't an assignment — it's a relationship all the variables together must satisfy. Solve fills in whichever variables you leave blank."

"Below, all three variables are declared as INPUTs (the ':' marker). a and b are filled in; c is blank."

a: 3
b: 4
c:

a + b = c

"*Try it"

"Press Solve. c becomes 7."

"Now try:"
"  Clear a (delete its value) and type 12 into c. Solve. a becomes 8."
"  Or clear b and type 12 into c. Solve. b becomes 9."

"The solver finds whichever variable is left blank. If you leave too many blank, you'll see 'Too many unknowns'."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 4, 29, 20, 0, 0),
            },
            {
                id: generateId(),
                title: 'Tutorial 1.3: Markers and the Clear Button',
                text: `"Tutorial 1.3: Markers and the Clear Button"

--Variables--

"*Markers and the Clear Button"

"The marker between a variable's name and its value controls how it behaves on Solve and Clear:"

"   ':'    INPUT — your value, kept across Solve and Clear"
"   '<-'   clearable INPUT — Clear erases it; Solve keeps it"
"   '->'   OUTPUT — solver fills it in; cleared before each Solve (and by Clear)"

a: 0
b<- 0
c->

a + b = c

"*Try each step in order"

"  1. Press Solve. c is computed so the equation balances (c = 0)."
"  2. Change b to 5 above. Press Solve. c becomes 5."
"  3. Press the Clear button. Watch what happens:"
"       a stays at 0 (':' is persistent)"
"       b clears to empty ('<-' is cleared by Clear)"
"       c clears to empty too ('->' is also cleared by Clear)"
"  4. Type 3 into b and press Solve. c becomes 3 (re-derived fresh)."

"The difference between '<-' and '->' isn't visible on Clear (both clear), but it shows on Solve: '<-' keeps the user's value across solves, '->' always recomputes."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 4, 29, 20, 0, 0),
            },
            {
                id: generateId(),
                title: 'Tutorial 2.1: Comments, Labels, and Layout',
                text: `"Tutorial 2.1: Comments, Labels, and Layout"

--Variables--

"*Making Records Readable"

"A record gets clearer with a few simple tools:"

"   1. Quoted strings (like this) appear as text in the panel."
"   2. Strings starting with '*' become section headers."
"   3. In a declaration, words before the variable name become its label."
"   4. '//' starts a line comment, visible only in the formulas editor."

"Below is a small tip calculator. Notice the labels next to each input — they're for humans. The solver only uses the variable name."

"*Tip Calculator"

Subtotal       sub $: $42.50
Tip percent    pct %: 20%

Tip            tip $->
Total          total $->

tip = sub * pct
total = sub + tip

"*Try it"

"Press Solve. Tip becomes $8.50 and Total becomes $51.00."

"Change Subtotal or Tip percent above and Solve again."

"(The '$' and '%' suffixes are format hints — they tell MathPad how to display values. Tutorial 2.2 covers them in detail.)"

"Switch to the formulas editor (the bottom pane) to see the raw text. The labels, the equations, and the '//' comments all live there. The panel renders a friendly view of it."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 4, 29, 20, 0, 0),
            },
            {
                id: generateId(),
                title: 'Tutorial 2.2: Number Formatting',
                text: `"Tutorial 2.2: Number Formatting"

--Variables--

"*Number Formatting"

"MathPad lets you tag values with format suffixes so they display the way you want. The suffix sits between the variable name and the marker."

"   $    money (currency symbol, two decimals, comma groups)"
"   %    percent (the user types 5%, stored as 0.05)"
"   °    angle (mode-aware: mod 360 in degrees mode, mod 2π in radians mode)"
"   @d   date (locale-aware)"
"   @t   duration (H:MM:SS)"

"*Compound Interest"

Principal      pv $: $5,000
Annual rate    rate %: 5%
Years          years: 10

Total amount   total $->
Interest       interest $->

total = pv * (1 + rate)**years
interest = total - pv

"*Try it"

"Press Solve. total becomes $8,144.47, interest becomes $3,144.47."

"The '$' suffix gives the dollar sign, comma groups, and 2-decimal display. The '%' suffix lets you type 5% and stores 0.05."

"Try changing rate to 7% and Solve again."

"Tutorial 2.4 covers the record-wide settings (decimal places, group digits, format, degrees mode) that work alongside these per-variable suffixes."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 4, 29, 20, 0, 0),
            },
            {
                id: generateId(),
                title: 'Tutorial 2.3: Built-in Functions',
                text: `"Tutorial 2.3: Built-in Functions"

--Variables--

"*Built-in Functions"

"MathPad has 50+ built-in functions. Call them with parentheses; separate arguments with semicolons (';'). A few groups:"

"   Math:    sqrt, abs, round, floor, ceil, mod, exp, ln, log"
"   Trig:    sin, cos, tan, asin, acos, atan (degrees or radians)"
"   Logic:   if(condition; valueIfTrue; valueIfFalse)"
"   Stats:   min, max, avg, sum"

"Function names are case-insensitive (sqrt and Sqrt are the same), but lowercase is the convention."

"*Pythagorean Theorem"

Side a    a: 3
Side b    b: 4

Hypotenuse  c->

c = sqrt(a**2 + b**2)


---
"*Right Triangle"
---

"This record is in degrees mode (see settings ⚙), so sin/cos work with degrees."

Angle      angle°: 30°
Length     length: 10

Adjacent   adj->
Opposite   opp->

adj = length * cos(angle)
opp = length * sin(angle)


---
"*Conditional"
---

"if(condition; valueIfTrue; valueIfFalse) picks one of two values."

Score      score: 75

Pass       pass->

pass = if(score >= 60; 1; 0)

"*Try it"

"Press Solve. You'll see:"
"   c = 5     (the classic 3-4-5 triangle)"
"   adj = 8.66 and opp = 5.00 (30°, 10-unit hypotenuse)"
"   pass = 1  (score >= 60)"

"Change score to 50 and Solve — pass becomes 0."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 4, 29, 20, 0, 0),
            },
            {
                id: generateId(),
                title: 'Tutorial 2.4: Record Settings',
                text: `"Tutorial 2.4: Record Settings"

--Variables--

"*Record Settings"

"Each record has its own settings — decimal places, comma separators, format (float / scientific / engineering), degrees vs radians, and more. They live in the details panel."

"Find the details panel: on wider screens it's docked to the right of the variables and formulas panels; on narrower screens, toggle it with the ⚙ icon in the top bar."

"*A number to experiment with"

aLong: 1234.5678901

Display    a-> 1,234.57

a = aLong

"*Places"

"'Places' is the number of digits after the decimal point. The default for this record is 2, so a shows 1,234.57."

"Try changing Places in the details panel to 4. Solve. a shows 1,234.5679."
"Try Places = 0. Solve. a shows 1,235."

"*Group Digits"

"With Group Digits on (the default here), large numbers get comma separators: 1,234.57. Turn it off and you'd see 1234.57."

"*Format"

"Three choices for how numbers display:"
"   float — normal (1,234.57 or 0.0006)"
"   sci   — scientific (1.2346e3 or 5.6e-4)"
"   eng   — engineering (exponents are multiples of 3: 1.2346e3 or 560.0e-6)"

"Try each by changing the Format setting and re-solving."

"*Other settings to know"

"   Strip Zeros    trims trailing zeros (5.00 → 5)"
"   Degrees Mode   whether Sin/Cos use degrees or radians"
"   Currency       what the '$' suffix actually shows ($ default; try € or £)"

"*How settings interact with format suffixes"

"Record settings are defaults. Format suffixes ($, %, °, @d, @t) on individual variables override the defaults where they apply. So you can have a record where most values are 'float, 4 places' but one specific variable is a percentage or a date."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 4, 29, 20, 0, 0),
            },
            {
                id: generateId(),
                title: 'Tutorial 3.1: Two Equations, Four Variables',
                text: `"Tutorial 3.1: Two Equations, Four Variables"

--Variables--

"*Edit any value, solve for the rest"

"Tutorial 1.2 showed one equation with three variables: you could fill in any two and solve for the third. The same idea scales up."

"Below, two equations relate four variables: sum, diff, a, and b. The '<-' marker means all four are emptied by the Clear button — handy when you want to try a different combination. Fill in any two, leave the other two blank, and MathPad solves the blanks."

sum<- 10
diff<-  4
a<-
b<-

a + b = sum
a - b = diff

"*Try it"

"  1.  Press Solve. a = 7, b = 3 (the values that satisfy both equations)."

"  2.  Press the Clear button to empty all four. Type 9 into a and 4 into diff. Solve."
"      → b = 5, sum = 14."

"  3.  Press Clear. Type 12 into a and 5 into b. Solve."
"      → sum = 17, diff = 7."

"  4.  Press Clear. Type 100 into sum and 30 into diff. Solve."
"      → a = 65, b = 35."

"Any two filled, the other two solve. Try your own combinations."

"*The rule"

"You generally need as many equations as unknowns. Leave too many blank and you'll see 'Too many unknowns'. Fill in too many in a way the equations can't satisfy and MathPad will report which equation doesn't balance."

"This idea extends to as many equations and variables as you need."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 4, 29, 20, 0, 0),
            },
            {
                id: generateId(),
                title: 'Tutorial 3.2: Variable Limits',
                text: `"Tutorial 3.2: Variable Limits"

--Variables--

"*Variable Limits"

"Some equations have more than one solution. Square brackets after the variable name tell MathPad where to look:"

"   x[lo:hi]:"

"*The ⟲ resolve button"

"Each editable variable in the variables panel has a small ⟲ button just to the left of its name. Clicking it does two things in sequence:"

"   1. Clears that variable's value"
"   2. Solves"

"So instead of 'clear this value, press Solve', you just click ⟲ next to the variable you want MathPad to find. Other variables keep their current values as inputs."

"Special case: if you just typed into a variable, clicking its own ⟲ skips the clear and just solves — useful when you want to test the value you typed."

"*Two-root quadratic"

"x² = target has two solutions: x = +√target and x = -√target. Without a hint, MathPad finds the positive root (its search starts from the positive side). Limits steer it to the other one."

target: 16
x[-10:0]:

x*x = target

"*Try it"

"  1.  Press Solve. x = -4."

"To try the other root, change x's limits. Limits aren't values — they're part of the declaration, edited in the formulas editor (the syntax-highlighted area below the variables panel). Click into it and edit the brackets directly:"

"   x[-10:0]:   becomes   x[0:10]:"

"  2.  In the formulas editor, change x's limits to [0:10]. Click x's ⟲ button."
"      → x = +4."

"  3.  In the formulas editor, change x's limits back to [-10:0]. Type 9 into target. Click x's ⟲ button."
"      → x = -3."

"And like any MathPad equation, you can flip direction — give x a value and ask MathPad to find target:"

"  4.  Type 7 into x. Click target's ⟲ button."
"      → target = 49 (no limits needed; one root)."


---
"*Periodic functions"
---

"sin(y) = ratio is true at infinitely many angles. Limits pick one."

ratio:    0.5
y[0:90]°:

sin(y) = ratio

"Note: pressing Solve solves the whole record at once, so by now y is already 30° (the only sine-0.5 angle in [0:90])."

"*Try it"

"  1.  In the formulas editor, change y's limits to [90:180]. Click y's ⟲ button."
"      → y = 150°."

"  2.  In the formulas editor, change y's limits back to [0:90]. Type 0.866 into ratio. Click y's ⟲ button."
"      → y = 60°."

"And flip:"

"  3.  Type 45° into y. Click ratio's ⟲ button."
"      → ratio = 0.71."

"*Limits on outputs"

"Limits also work on outputs:  y[lo:hi]°->"
"MathPad re-solves that variable in its own range after the main solve. Useful when one equation has multiple roots and you want a specific branch without affecting other variables."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 4, 29, 20, 0, 0),
            },
            {
                id: generateId(),
                title: 'Tutorial 3.3: Conditionals and Choices',
                text: `"Tutorial 3.3: Conditionals and Choices"

--Variables--

"*Tiered Values with Nested If"

"Tutorial 2.3 introduced if(condition; thenValue; elseValue). Nest it to express tiered values like tax brackets, shipping tiers, or discount levels."

"Simplified income tax rates. A declaration ends at the newline, so the whole nested if has to live on one line:"

income$: $75,000

rate%: if(income < 10000; 0%; if(income < 50000; 10%; if(income < 100000; 22%; 32%)))

tax$: income * rate

Effective rate  rate%->
Tax owed        tax$->

"*Try it"

"Change income to $8,000 (rate = 0%), $30,000 (10%), or $200,000 (32%). Solve after each."


---
"*Choose: pick by index"
---

"choose(n; v1; v2; v3; …) returns the Nth value (1-indexed)."

month: 4

days: choose(month; 31; 28; 31; 30; 31; 30; 31; 31; 30; 31; 30; 31)

Days in month  days->

"*Try it"

"Change month to 2 (February → 28), 7 (July → 31), or 11 (November → 30)."


---
"*Compound conditions"
---

"Conditions can combine with the boolean operators:"

"   &&    and"
"   ||    or"
"   !=    not equal"
"   ==    equal (in conditions)"

"Example: free shipping if order is over $50 AND customer is a member."

orderTotal$: $65
member:      1

shipping$: if(orderTotal > 50 && member == 1; 0; 7.99)

Shipping  shipping$->

"*Try it"

"Set member to 0 (not a member): shipping becomes $7.99 even on a $65 order."
"Set orderTotal to $40: shipping becomes $7.99 even for a member."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 4, 29, 20, 0, 0),
            },
            {
                id: generateId(),
                title: 'Tutorial 3.4: Mod-Aware Equations (°=)',
                text: `"Tutorial 3.4: Mod-Aware Equations (°=)"

--Variables--

"*Why mod-aware?"

"Angles wrap. A compass heading of 380° is the same direction as 20°, and -10° is the same as 350°. Regular '=' treats those as different numbers and won't balance."

"The '°=' operator treats both sides as equal modulo a full turn:"
"   mod 360 in degrees mode"
"   mod 2π in radians mode"

"It's an equation operator (top-level only), used in place of '=' when wrapping matters."

"*Compass turn"

"newBearing equals oldBearing + turn (modulo 360°). With one equation and three variables, type values into any two and click ⟲ next to the third to ask MathPad to find it."

oldBearing°: 350°
turn[-180:180]°:     30°
newBearing°:

newBearing °= oldBearing + turn

"Why the limits on turn? '°=' has infinitely many solutions for any unknown (100° also satisfies as 460°, -260°, …). The '°' format already mods the DISPLAY into [0, 360), so oldBearing and newBearing don't need limits — they always show in the canonical range. But turn is naturally signed (starboard = positive, port = negative), and [-180:180] tells Brent's to find the smallest signed turn — 'turn 100° starboard' rather than 'turn 460°' or 'turn -260°'."

"*Try it"

"  1.  Press Solve. newBearing = 20° (350 + 30 = 380, wrapped to 20)."

"  2.  Type 90° into newBearing. Click turn's ⟲ button."
"      → turn = 100° (the smallest starboard turn from 350° to 90°)."

"  3.  Type -45° into turn (negative = port, a left turn) and 90° into newBearing. Click oldBearing's ⟲ button."
"      → oldBearing = 135° (heading 135°, port turn of 45° brings you to 90°)."

"Fill in any two, click ⟲ on the third — MathPad solves it."


---
"*Solving for an unknown angle"
---

"Find x where 3x is equivalent to target (mod 360). Infinite solutions exist (x, x+120, x+240, …); limits pick one branch."

target°: 30°
x[0:120]°:

3*x °= target

"*Try it"

"  1.  Press Solve. x = 10°."

"  2.  In the formulas editor, change x's limits to [120:240]. Click x's ⟲ button."
"      → x = 130°."

"  3.  In the formulas editor, change x's limits back to [0:120]. Type 60° into target. Click x's ⟲ button."
"      → x = 20°."

"And flip:"

"  4.  Type 150° into x. Click target's ⟲ button."
"      → target = 90° (3 × 150 = 450°, which wraps to 90° mod 360)."

"*When to reach for °="

"Use '°=' for any equation where the result should be considered the same modulo a full turn — bearings, heading differences, phase angles. For ordinary linear arithmetic, stick with '='."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 4, 29, 20, 0, 0),
            },
            {
                id: generateId(),
                title: 'Tutorial 4.1: Tables',
                text: `"Tutorial 4.1: Tables"

--Variables--

"*Tables"

"A table evaluates a calculation across a range of values, producing one row per iteration."

"   table('Title') = { body }"

"*Fahrenheit to Celsius"

"Below is a table converting Fahrenheit to Celsius for f = 0, 10, 20, …, 100. A few things to note as you read:"

"  •  The table SOURCE (the 'table(…) = { … }' block) lives in the formulas editor — it doesn't show in this variables panel."
"  •  The RENDERED table appears here only after you press Solve."

"Press Solve now — the table appears immediately below."

table("F to C") = {
  c = (f - 32) * 5/9
  f: 0..100..10
  "F°" f °->
  "C°" c °->
}

"*The source"

"Here's what the table's source looks like, with the parts annotated:"

"   table('F to C') = {"
"     c = (f - 32) * 5/9  ← equation, evaluated each row"
"     f: 0..100..10       ← f sweeps 0 to 100 in steps of 10"
"     'F°' f °->          ← output column: label, variable, format, marker"
"     'C°' c °->          ← second output column"
"   }"

"Each row solves independently. Columns appear in declaration order. The '°' between the variable and '->' is the format suffix — it makes values display with a degree symbol (32° instead of 32)."

"*Try it"

"In the formulas editor, change f's range:"
"   f: 0..100..10    →    f: -40..40..5"
"Press Solve. The table re-renders over the new range."

"The step is optional — 'f: 0..100' defaults to step 1."


---
"*Solving for an unknown each row"
---

"The body equation can have an unknown to solve, just like a regular record. The table below appears after Solve runs (which it has, since you already pressed Solve for the first table)."

table("Square roots") = {
  x*x = y
  y: 0..25..5
  y->
  Sqrt x->
}

"Source:"

"   table('Square roots') = {"
"     x*x = y         ← equation with unknown x"
"     y: 0..25..5     ← y sweeps 0 to 25 in steps of 5"
"     y->             ← first output column"
"     Sqrt x->        ← second output column"
"   }"

"MathPad solves x*x = y for x in each row, fresh — limits work too if you need to pick a specific root. The 'Sqrt x->' output column is what makes x appear in the table; without it, x wouldn't be shown."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 4, 30, 20, 0, 0),
            },
            {
                id: generateId(),
                title: 'Tutorial 4.2: Graph Tables',
                text: `"Tutorial 4.2: Graph Tables"

--Variables--

"*Graph Tables"

"tableGraph is just like table — same body syntax — but the result renders as an SVG line graph instead of a numeric table."

"   tableGraph('Title') = { body }"

"*A sine wave"

"Press Solve now — the graph appears immediately below."

tableGraph("y = sin(x)") = {
  y = sin(x)
  x: 0..360..10
  "angle°" x->
  "sin(x)" y->
}

"Source:"

"   tableGraph('y = sin(x)') = {"
"     y = sin(x)       ← equation, evaluated each row"
"     x: 0..360..10    ← x sweeps 0 to 360 in steps of 10"
"     'angle°' x->     ← first output → X-axis"
"     'sin(x)' y->     ← second output → Y-series"
"   }"

"The FIRST output column becomes the X-axis. Subsequent output columns become Y-series. (The text export is still tabular — graphing is just how it displays.)"


---
"*Multiple lines on one graph"
---

"Add an inner iterator with its own '->' output, and each value of that iterator becomes a separate labeled line."

tableGraph("y = amp*sin(x)") = {
  y = amp*sin(x)
  x: 0..360..10
  amp: 1..3
  "angle°" x->
  "y" y->
  amp amp->
}

"Source:"

"   tableGraph('y = amp*sin(x)') = {"
"     y = amp*sin(x)   ← equation"
"     x: 0..360..10    ← outer iterator (X-axis)"
"     amp: 1..3        ← inner iterator: 1, 2, 3"
"     'angle°' x->     ← X-axis"
"     'y' y->          ← Y-axis"
"     amp amp->        ← makes amp a line-grouping variable"
"   }"

"amp sweeps 1, 2, 3. The 'amp amp->' output makes amp a grouping variable: three lines appear, one per amp value, labeled in the legend."

"Without an 'amp->' output column, the iterator just sweeps silently — only one combined line shows."

"*Try it"

"In the formulas editor, change the X range to '0..720' for two full cycles. Or change the equation — try 'y = sin(x) + cos(2*x)'."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 4, 30, 20, 0, 0),
            },
            {
                id: generateId(),
                title: 'Tutorial 4.3: Grids',
                text: `"Tutorial 4.3: Grids"

--Variables--

"*Grids"

"A grid is a 2D table: one iterator drives the rows, another drives the columns, and a value output fills the cells."

"   grid('Title') = { body }"

"*Multiplication table"

"Press Solve now — the grid appears immediately below."

grid("Multiplication") = {
  product = x * y
  x: 1..10
  y: 1..10
  X x->
  Y y->
  product product->
}

"Source:"

"   grid('Multiplication') = {"
"     product = x * y    ← equation, evaluated per cell"
"     x: 1..10           ← first iterator → row headers"
"     y: 1..10           ← second iterator → column headers"
"     X x->              ← first output → row headers"
"     Y y->              ← second output → column headers"
"     product product->  ← third output → cell value"
"   }"

"Hover any cell to see its row + column + header highlighted."


---
"*Solving per cell"
---

"Like table, the body equation can have an unknown that solves per cell."

grid("Hypotenuse a² + b² = c²") = {
  c = sqrt(a*a + b*b)
  a: 1..5
  b: 1..5
  A a->
  B b->
  C c->
}

"Source:"

"   grid('Hypotenuse a² + b² = c²') = {"
"     c = sqrt(a*a + b*b)  ← equation"
"     a: 1..5              ← rows"
"     b: 1..5              ← columns"
"     A a->                ← row headers"
"     B b->                ← column headers"
"     C c->                ← cell value"
"   }"

"*Try it"

"Change either iterator's range or step. The grid resizes. Try 'a: 1..10' and 'b: 1..10' for a fuller picture."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 4, 30, 20, 0, 0),
            },
            {
                id: generateId(),
                title: 'Tutorial 4.4: Compass Rose',
                text: `"Tutorial 4.4: Compass Rose"

--Variables--

"*vectorDraw"

"vectorDraw renders a set of vectors as an SVG diagram. The 'type' argument tells MathPad how to interpret each (a, b) pair:"

"   navigation    (bearing, magnitude)  — 0° = north, increasing clockwise"
"   polar         (angle, magnitude)    — 0° = east, increasing counter-clockwise"
"   cartesian     (x, y)                — raw coordinates"

"   vectorDraw('Title'; type) = { body }"

"*A compass rose"

"Eight unit vectors radiating from the origin at the standard bearings. Press Solve now — the diagram appears immediately below."

vectorDraw("Compass Rose"; navigation) = {
  0 °->
  0 ->
  N 0 °->
  1 ->

  0 °->
  0 ->
  NE 45 °->
  1 ->

  0 °->
  0 ->
  E 90 °->
  1 ->

  0 °->
  0 ->
  SE 135 °->
  1 ->

  0 °->
  0 ->
  S 180 °->
  1 ->

  0 °->
  0 ->
  SW 225 °->
  1 ->

  0 °->
  0 ->
  W 270 °->
  1 ->

  0 °->
  0 ->
  NW 315 °->
  1 ->
}

"*The source"

"Each vector is FOUR output declarations in a row. Here's the first one annotated:"

"   vectorDraw('Compass Rose'; navigation) = {"
"     0 °->         ← vector 1: start direction (unused when magnitude is 0)"
"     0 ->          ← start magnitude (0 → at origin)"
"     N 0 °->       ← end bearing; 'N' is the legend label"
"     1 ->          ← end magnitude (length)"
""
"     0 °->"
"     0 ->          ← vectors 2–8: same start, different end bearings"
"     NE 45 °->"
"     1 ->"
""
"     …             ← (E, SE, S, SW, W, NW)"
"   }"

"Blank lines between vectors are optional but help with readability."

"*Try it"

"In the formulas editor, change one vector's bearing — say, N from 0° to 30°. Solve. That arrow rotates clockwise."

"Add a longer wind arrow: copy any four-line block, change the label, bearing, and magnitude. Solve."

"Change 'navigation' at the top to 'polar' — N's 0° now points east (polar convention), and angles increase counter-clockwise."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 4, 30, 20, 0, 0),
            },
            {
                id: generateId(),
                title: 'Example: Retirement Calculator',
                text: `"Retirement Calculator"

--Functions--
"Time Value of Money"
pmt2(pv; rate; n; fv) = (pv - fv / (1 + rate)**n) * rate / (1 - (1 + rate)**-n)

"Total accumulation of a rate applied to a balance which increases by gain% every period"
{
  totAcc(pv; gain; rate; periods) =
    if(gain == 0; pv * rate * periods; pv * rate * ((1 + gain)**periods - 1) / gain)
}

"Total fees paid given total payment"
fees(pv; fv; totPmt; return; fees) = fees * (totPmt + fv - pv) / (return - fees)

--Equations--
"Variable payments"
totVPmt = totAcc(pv; gain; yearlyPmtRate; years)
totVFees = fees(pv; fv; totVPmt; return; fees)
year1 = pv * yearlyPmtRate / 12
yearN = pv * (1 + gain)**(years - 1) * yearlyPmtRate / 12

"Fixed payments"
fixedPmt = pmt2(pv; return - fees; years; fv) / 12
totFPmt = fixedPmt * years * 12
totFFees = fees(pv; fv; totFPmt; return; fees)

--Variables--

"*Calculates fixed and variable monthly retirement withdrawals"
"Enter retirement account(s) present value, life expectancy, yearly gain (or future value), fees, and total annual return; then click the Solve button.  Correct any orange results by pressing \u27F2 next to one of the orange values."


---
Future value of account(s) fv = pv * (1 + gain)**years
---
"Present value" pv $<- $1,000,000
"Life expectancy" years <- 20
"Yearly gain" gain %<- 1.125%
"Future value" fv $<-


---
Gross total return return = yearlyPmtRate + fees + gain
---
"Management fees" fees %<- 0.65%
"Payment rate" yearlyPmtRate %<-
"Total return" return %<- 6.5%


"*Variable payments (monthly as percentage of account(s) balance each year)"
"Year one" year1 $-> $3,937.50
"Last year" yearN $-> $4,870.04
"Total payments" totVPmt $-> $1,053,152.19
"Total fees" totVFees $-> $144,878.08


"*Fixed monthly payments"
"Monthly payment" fixedPmt $-> $4,297.73
"Total payments" totFPmt $-> $1,031,455.78
"Total fees" totFFees $-> $142,467.37


"*Notes:"
"Values that are interdependent may appear orange after solving.  This indicates that one of them must be adjusted to balance with the others.  Click \u27F2 next to an orange value to adjust it.  All green means all values are balanced."`,
                category: 'Finance',
                places: 3,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: false,

            },
            {
                id: generateId(),
                title: 'Example: Loan Calculator',
                text: `"Loan calculator with graphs and tables"

--Functions--
pmt2(pv; fv; rate; n; pmtDue) = -(pv + fv/(1 + rate)**n)*rate / ((1 - (1 + rate)**-n)*(1 + rate)**pmtDue)

--Equations--
pmt = pmt2(pv; fv; r; years*pmtsYr; pmtDue)
pmt + extraPmt = pmt2(pv; fv; r; actYears*pmtsYr; pmtDue)
r = (1 + rate/cmpndsYr)**(cmpndsYr/pmtsYr) - 1
// these variables never get orange highlighting because they are "solved" here
pmtDue = pmtDue
cmpndsYr = cmpndsYr
pmtsYr = pmtsYr

--Hidden Variables--
lastPmt: round(actYears*pmtsYr - pmtDue)
totPmt: pmt + extraPmt
begin: 1
end: 0

// Begin variables (top) panel
--Variables--
"*Update values, then click solve or the solve ⟲ icon next to a highlighted variable"
"For example, set Present Value to $200,000 and press the solve ⟲ icon next to Payment"

Present Value pv $: $100,000
Future Value fv $: $0               "(balloon payment)"
Annual Rate rate %: 6.125%
Loan Term years : 30                "Term in years"
Payment pmt $:


Payments/Year pmtsYr: 12
Compounds/Year cmpndsYr: pmtsYr     "generally equals payments/year"
Annuity Due pmtDue[0..1]: end       "end or begin of period"


Prepayment extraPmt $: $0           "Extra principal payment per period"
Actual Term actYears : years        "Actual term given prepayments"



"*Graphs and tables"

tableGraph("v Balance over \\actYears\\ year(s) at \\rate%\\, payment = \\pmt$\\, extra payment = \\extraPmt$\\") = {
  pmtNum: 0..lastPmt
  interest: if(pmtNum == 0; 0; round(-balance~ * r; 2)) // round to cents
  totInterest: if(pmtNum == 0; 0; totInterest~ + interest)
  principal: if(pmtNum == 0; pmtDue*totPmt; if(pmtNum == lastPmt; -balance~; totPmt - interest))
  balance: if(pmtNum == 0; pv + pmtDue*totPmt; balance~ + principal)
  year: (pmtNum)/pmtsYr
  "Year" year->
  "Principal Balance" balance$->
  "Total Interest" -totInterest$->
}



grid("v Payment for \\pv$\\ loan at various rates and loan lengths") = {
  // need to repeat equations to remove dependence on extra payments
  pmt = pmt2(pv; fv; r; years*pmtsYr; pmtDue)
  r = (1 + rate/cmpndsYr)**(cmpndsYr/pmtsYr) - 1
  rate: rate-0.5%..rate+0.5%..0.0625%
  years: 5..30..5
  pmt<-
  Rate rate%->
  Years years->
  Payment pmt$->
}



table("v Amortization Schedule for \\actYears\\ year(s) at \\rate%\\, extra payment = \\extraPmt$\\") = {
  pmtNum: 0..lastPmt
  interest: if(pmtNum == 0; 0; round(-balance~ * r; 2)) // round to cents
  totInterest: if(pmtNum == 0; 0; totInterest~ + interest)
  principal: if(pmtNum == 0; pmtDue*totPmt; if(pmtNum == lastPmt; -balance~; totPmt - interest))
  balance: if(pmtNum == 0; pv + pmtDue*totPmt; balance~ + principal)
  year: floor((pmtNum - 1)/pmtsYr) + 1
  payment: principal + interest

  "Pmt#" pmtNum->
  "Year" year->
  "Payment" payment$->
  "Principal" principal$->
  "Interest" interest$->
  "Balance" balance$->
  "Total Interest" totInterest$->
}

"*Notes:"
"Values that are interdependent may appear orange after solving.  This indicates that one of them must be adjusted to balance with the others.  Click ⟲ next to an orange value to adjust it.  All green means all values are balanced."
`,
                category: 'Finance',
                places: 4,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: false,

            },
            {
                id: generateId(),
                title: 'Example: Quadratic',
                text: `"Quadratic equation"
  "ax^2 + bx + c = 0"

--Variables--
"*Press Solve to solve the equation. Try different values for a, b, and c."

a: -1
b: 6
c: 4


"*Here are the equations:"

disc = b**2 - 4*a*c
x1 = (-b + sqrt(disc)) / (2*a)
x2 = (-b - sqrt(disc)) / (2*a)

disc->
x1->
x2->


tableGraph("Quadratic equation \\a\\*x^2 + \\b\\x + \\c\\") = {
  x: min(x1; x2)-1..max(x1; x2)+1..0.1
  y: a*x**2 + b*x + c
  x->
  y->
}
`,
                category: 'Math',
                places: 2,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: false,

            },
            {
                id: generateId(),
                title: 'Example: Factorial',
                text: `"Factorial"
  "Recursive and non-recursive solutions"

--Variables--
"*Factorial of n is the product of all integers from 1 to n:"
"  n! = 1 * 2 * 3 * ... * n
  Note: 170! is the largest factorial that fits in a floating point number"


"Here we develop a recursive function fac(n)"
      fac(n) = if(n <= 1; 1; n * fac(n - 1))
  fac(170)->

"Here we provide a solution using the built-in prod function"
  prod(k; k; 1; 170)->

"There is also a built-in fact function"
  fact(170)->`,
                category: 'Math',
                places: 2,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: false,

            },
            {
                id: generateId(),
                title: 'Example: Fifth Degree Polynomial',
                text: `"Fifth degree polynomial"

Coefficients
c5: 1
c4: -2
c3: -10
c2: 20
c1: 9
c0: -14

--Variables--

"*Press Solve to find all 5 roots and graph the function"

Polynomial function
---
f(x; c5; c4; c3; c2; c1; c0) = c5*x**5 + c4*x**4 + c3*x**3 + c2*x**2 + c1*x + c0
---

Root-finding equation to be solved
---
f(x; c5; c4; c3; c2; c1; c0) = 0
---
Roots
x->                           "Default root near zero"
x[2:2.5]->                    "Search for root in range 2 to 2.5"
x[2.5:3]->                    "-> Solves to record's default precision"
x[-1:0]->>                    "->> Shows full precision"
x[-4:-2]->

tableGraph(">v y = f(x; ...) showing roots") = {
  x: -3.1..3.1..0.2
  // this equation overrides the root-finding one above in the main body
  // otherwise there would be solve failures when f(x) != 0
  y = f(x; c5; c4; c3; c2; c1; c0)
  x->
  "y = f(x; ...)" y->
}`,
                category: 'Math',
                places: 4,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: false,

            },
            {
                id: generateId(),
                title: "Example: Ohm's Law",
                text: `"Ohm's Law"


--Variables--
"*Enter any two then press solve for the other two"


---
v = i*r
---
v: 40       "volts"
i:          "amps"
r:          "ohms"


---
w = v*i
---
w: 200      "watts"


"*Graphs"

tableGraph("v Watts vs amps at typical speaker resistances") = {
  r: 2..10..2
  w: 20..400..10
  v<-
  i<-
  Watts w->
  Ohms r->
  Amps i->
}

tableGraph("v Watts vs volts at typical speaker resistances") = {
  r: 2..10..2
  w: 20..400..10
  v<-
  i<-
  Watts w->
  Ohms r->
  Volts v->
}
`,
                category: 'Science',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: false,

            },
            {
                id: generateId(),
                title: 'Example: Body Mass Index',
                text: `"Body Mass Index"

--Variables--
"*Click Solve to see graphs of BMI by height and weight"


gridGraph("BMI by height (in) & weight (lb)") = {
  bmi = 703 * weight / height**2   "the equation solved at every cell"
  height: 60..78..2                "X-axis iterator: 60–78 in, step 2"
  bmi: 10..45..5                   "line iterator: one curve per BMI value"
  Height (in) height->             "1st output → X-axis label"
  BMI bmi->                        "2nd output → legend (one entry per line)"
  Weight (lb) weight->             "3rd output → Y-axis (the value plotted)"
}


gridGraph("v BMI by height (m) & weight (kg)") = {
  bmi = weight / height**2         "the equation solved at every cell"
  height: 1.50..2.00..0.05         "X-axis iterator: 1.50–2.00 m, step 5 cm"
  bmi: 10..45..5                   "line iterator: one curve per BMI value"
  Height (m) height->              "1st output → X-axis label"
  BMI bmi->                        "2nd output → legend (one entry per line)"
  Weight (kg) weight->             "3rd output → Y-axis (the value plotted)"
}
`,
                category: 'Medical',
                places: 2,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: false,

            },
            {
                id: generateId(),
                title: 'Example: Basel Series',
                text: `"Basel Series"
  "Recursive and non-recursive solutions"

--Variables--
"*The Basel series is the sum of 1/n**2 where n goes from 1 to infinity"

"It is equal to pi**2/6"
  pi**2/6->               "(to 8 places)"


"Here we develop a recursive basel function"
      basel(low; high) = if(low > high; 0; 1/low**2 + basel(low+1; high))

"We are limited to how high n can go by the recursion limit"
  basel(1; 750)->


"Here we develop a solution using the built-in sum function"
"Since sum is not subject to recursion limits we can sum to much higher n"
  sum(1/n**2; n; 1; 10000000)->`,
                category: 'Math',
                places: 8,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: false,

            },
            {
                id: generateId(),
                title: 'Constants',
                text: `"Physical and mathematical constants"

--Variables--
"*Constants defined here are available in all records"

"*Naming convention: single-letter constants are UPPERCASE (C, E, G, H) so they don't clash with lowercase variable names you use in equations. pi keeps its conventional lowercase form. Multi-letter constants (kB, NA) keep their conventional casing."

pi: 3.141592653589793
E: 2.71828182845905
C: 299792458 "speed of light m/s"
G: 6.67430e-11 "gravitational constant"
H: 6.62607015e-34 "Planck constant"
kB: 1.380649e-23 "Boltzmann constant"
NA: 6.02214076e23 "Avogadro number"
golden: 1.61803398874989 "golden ratio"

secsPerHour: 3600
secsPerDay: 86400`,
                category: 'Reference',
                places: 2,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: false,

            },
            {
                id: generateId(),
                title: 'Functions',
                text: `"User-defined functions"

--Variables--
"*Functions defined here are available in all records"


"Time Value of Money"
pmt(pv; rate; n; fv) = -(pv + fv / (1 + rate)**n) * rate / (1 - (1 + rate)**-n)


"Compound interest"
compound(pv; rate; n) = pv * (1 + rate)**n


"Celsius to Fahrenheit"
ctof(c) = c * 9/5 + 32


"Fahrenheit to Celsius"
ftoc(f) = (f - 32) * 5/9


"Hypotenuse"
hypot(a;b) = sqrt(a**2 + b**2)


"Quadratic discriminant"
disc(a;b;c) = b**2 - 4*a*c`,
                category: 'Reference',
                places: 2,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: false,

            },
            { id: generateId(), ...DEFAULT_SETTINGS_RECORD }
        ],
        categories: ['Tutorial', 'Unfiled', 'Finance', 'Math', 'Medical', 'Science', 'Reference', 'Personal'],
        settings: {
            lastRecordId: welcomeRecordId
        }
    });
}

/**
 * Generate a unique ID
 */
/**
 * Check if a record is a special reference record (Constants, Functions, or Default Settings)
 * @param {object} record - The record to check
 * @param {string} [title] - Optional: check for a specific reference record title
 */
function isReferenceRecord(record, title) {
    if (record.category !== 'Reference') return false;
    if (title) return record.title === title;
    return record.title === 'Constants' || record.title === 'Functions' || record.title === 'Default Settings';
}

/**
 * Check if a record title is a reference record title
 */
function isReferenceTitle(title) {
    return title === 'Constants' || title === 'Functions' || title === 'Default Settings';
}

function generateId() {
    return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Load data from localStorage
 */
// Sentinel timestamp for legacy records that don't have a real creation date
// (April 1, 2026 03:14:15.926 UTC — pi-themed placeholder)
const DEFAULT_RECORD_TIMESTAMP = Date.UTC(2026, 3, 1, 3, 14, 15, 926);

/**
 * Backfill missing created timestamps with the sentinel default.
 * Used for legacy records that predate timestamp tracking.
 * Modified is left blank if not set.
 */
function backfillRecordTimestamps(data) {
    if (!data || !data.records) return data;
    for (const record of data.records) {
        if (record.created == null) record.created = DEFAULT_RECORD_TIMESTAMP;
    }
    return data;
}

function loadData() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const data = JSON.parse(stored);
            // Migrate data if needed
            if (!data.version || data.version < STORAGE_VERSION) {
                return backfillRecordTimestamps(migrateData(data));
            }
            // Ensure Default Settings exists even for current version
            ensureDefaultSettingsRecord(data);
            return backfillRecordTimestamps(data);
        }
    } catch (e) {
        console.error('Error loading data from localStorage:', e);
        alert('Error loading saved data. Starting with defaults.\n\n' + e.message);
    }

    return createDefaultData();
}

/**
 * Save data to localStorage
 */
function saveData(data, localOnly = false) {
    try {
        // Save sidebar scroll position (skip during data reload to preserve Drive value)
        if (typeof UI !== 'undefined' && UI.initComplete) {
            const sidebarContent = document.querySelector('.sidebar-content');
            if (sidebarContent && data.settings) {
                data.settings.sidebarScrollTop = sidebarContent.scrollTop;
            }
        }
        data.version = STORAGE_VERSION;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanDataForSave(data)));
        if (!localOnly) markDriveDirty();
        return true;
    } catch (e) {
        console.error('Error saving data to localStorage:', e);
        if (e.name === 'QuotaExceededError') {
            alert('Storage quota exceeded. Please export and delete some records.');
        } else {
            alert('Error saving data: ' + e.message);
        }
        return false;
    }
}

/**
 * Migrate old data format to new
 */
function migrateData(data) {
    // Migration from version 1 to version 2
    if (!data.version || data.version < 2) {
        for (const record of data.records || []) {
            // Convert places: 14 (old default) to places: 4 (new default)
            if (record.places === 14) {
                record.places = 4;
            }
            // Remove dead secret field
            delete record.secret;
            // Add missing format and groupDigits fields
            if (record.format === undefined) {
                record.format = 'float';
            }
            if (record.groupDigits === undefined) {
                record.groupDigits = false;
            }
        }
    }

    // Ensure Default Settings record exists
    ensureDefaultSettingsRecord(data);

    data.version = STORAGE_VERSION;
    return data;
}

/**
 * Ensure Default Settings record exists
 */
function ensureDefaultSettingsRecord(data) {
    if (!data.records) {
        data.records = [];
    }
    const hasDefaultSettings = data.records.some(r => isReferenceRecord(r, 'Default Settings'));
    if (!hasDefaultSettings) {
        data.records.push({ id: generateId(), ...DEFAULT_SETTINGS_RECORD });
    }
}

/**
 * Debounced save function
 */
let saveTimeout = null;
let resched = true;
function doSave(data, delay) {
    if (resched) {
        resched = false;
        saveTimeout = setTimeout(() => {
            doSave(data, delay);
        }, delay);
    } else {
        saveTimeout = null;
        resched = true;
        saveData(data, true);
    }
}
function cancelPendingSave() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
        resched = true;
    }
}
function debouncedSave(data, delay = 500, localOnly = false) {
    if (!UI.initComplete) return;
    if (!localOnly) markDriveDirty();
    if (saveTimeout) {
        resched = true;
    } else {
        doSave(data, delay);
    }
}
/**
 * Export data to MpExport text format
 * Compatible with original MathPad export format
 * @param {object} data - The data to export
 * @param {object} options - Export options
 * @param {number} options.selectedRecordId - ID of currently selected record (optional)
 */
function exportToText(data, options = {}) {
    const SEPARATOR = '~~~~~~~~~~~~~~~~~~~~~~~~~~~';
    const lines = [];
    const { selectedRecordId } = options;

    for (const record of data.records) {
        // Record metadata
        const isSelected = selectedRecordId && record.id === selectedRecordId;
        const selectedFlag = isSelected ? '; Selected = 1' : '';
        lines.push(`Category = "${record.category || 'Unfiled'}"; Secret = ${record.secret ? 1 : 0}${selectedFlag}`);
        lines.push(`Places = ${record.places != null ? record.places : 4}; StripZeros = ${record.stripZeros !== false ? 1 : 0}`);
        lines.push(`Format = "${record.format || 'float'}"; GroupDigits = ${record.groupDigits ? 1 : 0}; DegreesMode = ${record.degreesMode ? 1 : 0}${record.currencySymbol && record.currencySymbol !== '$' ? `; CurrencySymbol = "${record.currencySymbol}"` : ''}`);
        if (record.status) {
            // Escape quotes and newlines in status message
            const escapedStatus = record.status.replace(/"/g, '\\"').replace(/\n/g, '\\n');
            lines.push(`Status = "${escapedStatus}"; StatusIsError = ${record.statusIsError ? 1 : 0}`);
        }
        if (record.created || record.modified) {
            const c = record.created ? new Date(record.created).toISOString() : '';
            const m = record.modified ? new Date(record.modified).toISOString() : '';
            lines.push(`Created = "${c}"; Modified = "${m}"`);
        }

        // Reference records have their title stripped on import, so add it back
        if (record.title && isReferenceTitle(record.title)) {
            lines.push(`"${record.title}"`);
        }

        // Record content (strip trailing blank lines for consistency with
        // import). Use a newline-only strip — `trimEnd()` would also strip
        // tabs, eating table-output rows whose cells are all empty.
        lines.push(record.text.replace(/\n+$/, ''));

        // Separator
        lines.push(SEPARATOR);
    }

    return lines.join('\n');
}

/**
 * Import data from MpExport text format
 * @param {string} text - The text to import
 * @param {object} existingData - Existing data to merge with (or null for new)
 * @param {object} options - Import options
 * @param {boolean} options.clearExisting - If true, clear existing records before import
 */
function importFromText(text, existingData = null, options = {}) {
    // Normalize line endings: \r\n (Windows) and \r (classic Mac) to \n (Unix)
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const SEPARATOR = '~~~~~~~~~~~~~~~~~~~~~~~~~~~';
    const records = [];
    const chunks = text.split(SEPARATOR);
    let selectedRecordIndex = -1;

    for (const chunk of chunks) {
        const trimmed = chunk.trim();
        if (!trimmed) continue;

        const lines = trimmed.split('\n');
        let category = 'Unfiled';
        let secret = false;
        let selected = false;
        let places = 4;
        let stripZeros = true;
        let format = 'float';
        let groupDigits = false;
        let degreesMode = false;
        let currencySymbol = '$';
        let status = '';
        let statusIsError = false;
        let created = null;
        let modified = null;
        let contentStart = 0;

        // Parse metadata lines
        for (let i = 0; i < Math.min(5, lines.length); i++) {
            const line = lines[i].trim();

            // Category, Secret, and optional Selected flag
            const catMatch = line.match(/Category\s*=\s*"([^"]*)"\s*;\s*Secret\s*=\s*(\d+)(?:\s*;\s*Selected\s*=\s*(\d+))?/i);
            if (catMatch) {
                category = catMatch[1];
                secret = catMatch[2] === '1';
                selected = catMatch[3] === '1';
                contentStart = i + 1;
                continue;
            }

            // Places and StripZeros line
            const placesMatch = line.match(/Places\s*=\s*(\d+)\s*;\s*StripZeros\s*=\s*(\d+)/i);
            if (placesMatch) {
                places = parseInt(placesMatch[1]);
                stripZeros = placesMatch[2] === '1';
                contentStart = i + 1;
                continue;
            }

            // Format, GroupDigits, DegreesMode line (later fields optional; ShadowConstants accepted but ignored)
            const formatMatch = line.match(/Format\s*=\s*"([^"]*)"\s*;\s*GroupDigits\s*=\s*(\d+)(?:\s*;\s*DegreesMode\s*=\s*(\d+))?(?:\s*;\s*ShadowConstants\s*=\s*(\d+))?(?:\s*;\s*CurrencySymbol\s*=\s*"([^"]*)")?/i);
            if (formatMatch) {
                format = formatMatch[1];
                groupDigits = formatMatch[2] === '1';
                if (formatMatch[3] !== undefined) {
                    degreesMode = formatMatch[3] === '1';
                }
                // formatMatch[4] is ShadowConstants — accepted for backwards compatibility, ignored
                if (formatMatch[5] !== undefined) {
                    currencySymbol = formatMatch[5];
                }
                contentStart = i + 1;
                continue;
            }

            // Status line (new in v3)
            const statusMatch = line.match(/Status\s*=\s*"(.*)"\s*;\s*StatusIsError\s*=\s*(\d+)/i);
            if (statusMatch) {
                // Unescape quotes and newlines in status message
                status = statusMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
                statusIsError = statusMatch[2] === '1';
                contentStart = i + 1;
                continue;
            }

            // Created/Modified timestamps (ISO format)
            const datesMatch = line.match(/Created\s*=\s*"([^"]*)"\s*;\s*Modified\s*=\s*"([^"]*)"/i);
            if (datesMatch) {
                if (datesMatch[1]) {
                    const t = Date.parse(datesMatch[1]);
                    if (!isNaN(t)) created = t;
                }
                if (datesMatch[2]) {
                    const t = Date.parse(datesMatch[2]);
                    if (!isNaN(t)) modified = t;
                }
                contentStart = i + 1;
                continue;
            }
        }

        // Rest is content
        const contentLines = lines.slice(contentStart);
        const content = contentLines.join('\n').trimEnd();

        if (!content) continue;

        // Extract title from first comment line if present
        let title = '';
        let textContent = content;
        const firstLine = contentLines[0].trim();
        if (firstLine.startsWith('"')) {
            // Title from quoted comment (single-line or multi-line)
            title = firstLine.slice(1).replace(/"$/, '');
            // For reference records, remove title line from content to avoid duplication
            // (export adds the title line, so we remove it on import)
            const isRefRecord = isReferenceTitle(title);
            if (isRefRecord) {
                textContent = contentLines.slice(1).join('\n').trimEnd();
            }
        } else if (firstLine) {
            title = firstLine.substring(0, 30);
            if (firstLine.length > 30) title += '...';
        } else {
            title = 'Untitled';
        }

        const recordId = generateId();
        if (selected) {
            selectedRecordIndex = records.length;
        }
        const recordObj = {
            id: recordId,
            title: title,
            text: textContent,
            category: category,
            places: places,
            stripZeros: stripZeros,
            groupDigits: groupDigits,
            format: format,
            degreesMode: degreesMode,
            currencySymbol: currencySymbol,
            status: status,
            statusIsError: statusIsError
        };
        if (created != null) recordObj.created = created;
        if (modified != null) recordObj.modified = modified;
        records.push(recordObj);
    }

    // Get the selected record ID if one was marked
    const selectedRecordId = selectedRecordIndex >= 0 ? records[selectedRecordIndex].id : null;

    // Merge with existing data or create new
    if (existingData) {
        // Add new categories
        const existingCategories = new Set(existingData.categories);
        for (const record of records) {
            if (record.category && !existingCategories.has(record.category)) {
                existingData.categories.push(record.category);
                existingCategories.add(record.category);
            }
        }

        // Clear existing records if requested, otherwise append
        if (options.clearExisting) {
            existingData.records = records;
        } else {
            existingData.records = [...existingData.records, ...records];
        }
        // Store selected record ID for UI to use
        if (selectedRecordId) {
            existingData.settings = existingData.settings || {};
            existingData.settings.lastRecordId = selectedRecordId;
        }
        return existingData;
    }

    // Create new data structure
    const categories = new Set(['Unfiled']);
    for (const record of records) {
        if (record.category) {
            categories.add(record.category);
        }
    }

    return {
        version: STORAGE_VERSION,
        records: records,
        categories: [...categories],
        settings: {
            degreesMode: false,
            lastRecordId: selectedRecordId
        }
    };
}

/**
 * Download text as a file
 */
function downloadTextFile(text, filename = 'mathpad_export.txt') {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Read a file and return its text content
 */
function readTextFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
}

/**
 * Create a new record using Default Settings as template if available
 */
function createRecord(data) {
    // Ensure Default Settings record exists, then use it as template
    ensureDefaultSettingsRecord(data);
    const ds = data.records.find(r => isReferenceRecord(r, 'Default Settings'));
    const title = ds.text.split('\n')[0].replace(/^"|"$/g, '') || 'New Record';

    return {
        id: generateId(),
        title,
        text: ds.text.split('\n').slice(0, 3).join('\n') + '\n',
        category: 'Unfiled',
        places: ds.places,
        stripZeros: ds.stripZeros,
        groupDigits: ds.groupDigits,
        format: ds.format,
        degreesMode: ds.degreesMode,
        currencySymbol: ds.currencySymbol || '$',
        status: '',
        statusIsError: false,
        created: Date.now(),
        modified: null
    };
}

/**
 * Delete a record by ID
 */
function deleteRecord(data, recordId) {
    data.records = data.records.filter(r => r.id !== recordId);
    return data;
}

/**
 * Find a record by ID
 */
function findRecord(data, recordId) {
    return data.records.find(r => r.id === recordId);
}

/**
 * Update a record
 */
function updateRecord(data, recordId, updates) {
    const record = findRecord(data, recordId);
    if (record) {
        Object.assign(record, updates);
    }
    return data;
}

/**
 * Add a new category
 */
function addCategory(data, categoryName) {
    if (!data.categories.includes(categoryName)) {
        data.categories.push(categoryName);
    }
    return data;
}

/**
 * Delete a category (moves records to Unfiled)
 */
function deleteCategory(data, categoryName) {
    if (categoryName === 'Unfiled') return data;

    // Move records to Unfiled
    for (const record of data.records) {
        if (record.category === categoryName) {
            record.category = 'Unfiled';
        }
    }

    // Remove category
    data.categories = data.categories.filter(c => c !== categoryName);
    return data;
}

/**
 * Rename a category
 */
function renameCategory(data, oldName, newName) {
    if (oldName === 'Unfiled') return data;

    // Update records
    for (const record of data.records) {
        if (record.category === oldName) {
            record.category = newName;
        }
    }

    // Update categories list
    const idx = data.categories.indexOf(oldName);
    if (idx !== -1) {
        data.categories[idx] = newName;
    }

    return data;
}

/**
 * Get records grouped by category
 */
function getRecordsByCategory(data) {
    const groups = new Map();
    const sortPrefs = (data.settings && data.settings.categorySortOrder) || {};

    // Initialize all categories
    for (const cat of data.categories) {
        groups.set(cat, []);
    }

    // Group records
    for (const record of data.records) {
        const cat = record.category || 'Unfiled';
        if (!groups.has(cat)) {
            groups.set(cat, []);
        }
        groups.get(cat).push(record);
    }

    // Apply per-category sort
    for (const [cat, records] of groups) {
        if (sortPrefs[cat] === 'alpha') {
            records.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        }
    }

    return groups;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        STORAGE_KEY, createDefaultData, isReferenceRecord, isReferenceTitle, generateId,
        loadData, saveData, debouncedSave, stripStaleSections, cleanDataForSave,
        exportToText, importFromText, downloadTextFile, readTextFile,
        createRecord, deleteRecord, findRecord, updateRecord,
        addCategory, deleteCategory, renameCategory, getRecordsByCategory
    };
}
