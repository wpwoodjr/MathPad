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
    degreesMode: true,
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

"*Try it"

"Press the Solve button (above) to see the value of x when y is 0.53 and also a graph of the equation (if the graph isn't visible, you can expand this panel by dragging the divider above 'FORMULAS' below)."

  x->
  y: 0.53

tableGraph(">v sqrt(x+4) / acos(0.7) = y**3") = {
  x: -2.5..4.5..0.5
  y<-
  x->
  y->
}


"*MathPad for web"

"I've always loved MathPad but never found anything to replace its combination of simplicity and power.  This is a modern web-based reimplementation.  Most original MathPad records should still work.  New features include:

  * Tables, grids, and graphs
  * Vector diagrams - polar, navigation, and cartesian
  * Split panes - variables pane for data entry/display, formulas pane for definitions
  * Solver with recursive backtracking and algebraic substitution
  * Format suffixes — $ (money), % (percent), ° (mod-aware degrees), @d (date), @t (duration)
  * Degrees/radians mod-aware equality operator °=
  * Written with pure client-side JavaScript
  * Auto saves to local storage
  * Google Drive integration (in testing)

Try the tutorials and examples, and most of all have fun!

On mobile, the tutorials and examples are under the hamburger (three bars) icon at top left.

Light / dark theme: click the ☀/☾ icon in the top bar (or the sidebar on narrow screens) to toggle. Your choice is remembered for next time."`,
                category: 'Tutorial',
                places: 1,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
            },
            {
                id: generateId(),
                title: '1.1: Your First Equation',
                text: `"1.1: Your First Equation"

--Variables--

---
"*Your First Equation"
---

"MathPad solves equations. You set some values, leave others blank, and press Solve."

"Below, the equation 'a + b = c' uses three variables. a and b are inputs (you can edit them). c is an output ('c->' tells the solver to fill it in)."

a: 3
b: 4

"Equation:" a + b = c

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
                title: '1.2: Any Variable Can Be the Unknown',
                text: `"1.2: Any Variable Can Be the Unknown"

--Variables--

---
"*Any Variable Can Be the Unknown"
---

"In MathPad, an equation isn't an assignment — it's a relationship all the variables together must satisfy. Solve fills in whichever variables you leave blank."

"Below, all three variables are declared as INPUTs (the ':' marker). a and b are filled in; c is blank."

a: 3
b: 4
c:

"Equation:" a + b = c

"*Try it"

"Press Solve. c becomes 7."

"Now try:"
"  Clear a (delete its value) and type 12 into c. Solve. a becomes 8."
"  Then type 3 back into a, clear b, and Solve. b becomes 9."

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
                title: '1.3: Markers and the Clear Button',
                text: `"1.3: Markers and the Clear Button"

--Variables--

---
"*Markers and the Clear Button"
---

"The marker between a variable's name and its value controls how it behaves on Solve and Clear:"

"   ':'    INPUT — your value, kept across Solve and Clear"
"   '<-'   clearable INPUT — Clear erases it; Solve keeps it"
"   '->'   OUTPUT — solver fills it in; cleared before each Solve (and by Clear)"

a: 0
b<- 0
c->

"Equation:" a + b = c

"*Try each step in order"

"  1. Press Solve. c is computed so the equation balances (c = 0)."
"  2. Change b to 5 above. Press Solve. c becomes 5."
"  3. Press the Clear button. Watch what happens:"
"       a stays at 0 (':' is persistent)"
"       b clears to empty ('<-' is cleared by Clear)"
"       c clears to empty too ('->' is also cleared by Clear)"
"  4. Type 3 into b and press Solve. c becomes 3 (re-derived fresh)."

"The difference between '<-' and '->' isn't visible on Clear (both clear), but it shows on Solve: '<-' keeps the user's value across solves, '->' always recomputes."


---
"*Full-precision markers"
---

"Each of the three markers above has a 'doubled' twin that displays the value at FULL precision, ignoring the record's Places setting:"

"   '::'    like ':' but solves to full precision"
"   '<<-'   like '<-' but solves to full precision"
"   '->>'   like '->' but outputs full precision"

"Use the doubled form when the rounded display would lose information that matters — for example:"

sin(45°) °->
sin(45°) °->>
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
                title: '2.1: Comments, Labels, and Layout',
                text: `"2.1: Comments, Labels, and Layout"

--Variables--

---
"*Making Records Readable"
---

"MathPad shows your record in two places:"

"  •  the FORMULAS EDITOR (the syntax-highlighted text area below) — where you type and edit everything"
"  •  this VARIABLES PANEL — where MathPad shows a friendly, structured view of the same content"

"Both views update together. You type the annotations below into the FORMULAS EDITOR; the VARIABLES PANEL renders them like this:"

"   1. Quoted strings (like this) appear as text in the variables panel."
"   2. Strings starting with '*' become section headers."
"   3. In a declaration, text before the variable name becomes its label. Always quote the label text so characters like ':' or '%' inside it don't confuse the parser — see the examples below."
"   4. '//' starts a line comment, visible only in the formulas editor."

"Below is a small tip calculator. Notice the labels next to each input — they're for humans. The solver only uses the variable name."


---
"*The --Variables-- marker"
---

"Open the formulas editor for this record (click into the syntax-highlighted area below). Near the top you'll see a line:"

"   --Variables--"

"That marker splits the record in two:"

"  •  Lines ABOVE it are still computed and still affect the solve, but they're HIDDEN from the variables panel."
"  •  Lines BELOW it are SHOWN in the variables panel."

"Use it to keep intermediate helpers, function definitions, and supporting equations out of the way, exposing only the inputs and outputs you actually want users to see and edit."


---
"*Tip Calculator"
---

"Subtotal"     sub $: $42.50
"Tip percent"  pct %: 20%

"Tip"          tip $->
"Total"        total $->

"Tip:"   tip = sub * pct
"Total:" total = sub + tip

"*Try it"

"Press Solve. Tip becomes $8.50 and Total becomes $51.00."

"Change Subtotal or Tip percent above and Solve again."

"(The '$:' and '%:' markers tell MathPad how to display the value — '$' for money, '%' for percent. Tutorial 2.2 covers these in detail.)"

"Switch to the formulas editor to see the raw text — labels, equations, and '//' comments all live there. The variables panel renders a friendly view of it."
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
                title: '2.2: Number Formatting',
                text: `"2.2: Number Formatting"

--Variables--

---
"*Number Formatting"
---

"A declaration's marker can carry a format hint that tells MathPad how to display the value. The format character goes immediately before the marker — they read as one piece: '$:', '%->', '°:', '@d:', '@t:'."

"   $    money (currency symbol, two decimals, comma groups)"
"   %    percent (the user types 5%, stored as 0.05)"
"   °    angle (mode-aware: mod 360 in degrees mode, mod 2π in radians mode)"
"   @d   date (locale-aware)"
"   @t   duration (H:MM:SS)"


---
"*Compound Interest"
---

"Principal"      pv $: $5,000
"Annual rate"    rate %: 5%
"Years"          years: 10

"Total amount"   total $->
"Interest"       interest $->

"Compound interest:" total = pv * (1 + rate)**years
"Interest earned:"   interest = total - pv

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
                title: '2.3: Built-in Functions',
                text: `"2.3: Built-in Functions"

--Variables--

---
"*Built-in Functions"
---

"MathPad has 50+ built-in functions. Call them with parentheses; separate arguments with semicolons (';'). A few groups:"

"   Math:    sqrt, abs, round, floor, ceil, mod, exp, ln, log"
"   Trig:    sin, cos, tan, asin, acos, atan (degrees or radians)"
"   Logic:   if(condition; valueIfTrue; valueIfFalse)"
"   Stats:   min, max, avg, sum"

"Function names are case-insensitive (sqrt and Sqrt are the same), but lowercase is the convention."


---
"*Pythagorean Theorem"
---

"Side a"      a: 3
"Side b"      b: 4

"Pythagorean theorem:" c = sqrt(a**2 + b**2)

"Hypotenuse"  c->

"Solve → c = 5 (the classic 3-4-5 triangle)."


---
"*Right Triangle"
---

"This record is in degrees mode (see settings ⚙), so sin/cos work with degrees."

"Angle"      angle°: 30°
"Length"     length: 10

"Adjacent side:" adj = length * cos(angle)
"Opposite side:" opp = length * sin(angle)

"Adjacent"   adj->
"Opposite"   opp->

"Solve → adj = 8.66, opp = 5.00 (30°, 10-unit hypotenuse)."


---
"*Conditional"
---

"if(condition; valueIfTrue; valueIfFalse) picks one of two values."

"Score"      score: 75

"Pass/fail:" pass = if(score >= 60; 1; 0)

"Pass"       pass->

"Solve → pass = 1 (score >= 60). Change score to 50 and Solve again — pass becomes 0."


---
"*Iteration: sum and prod"
---

"sum and prod have two forms. The variadic form adds (or multiplies) a fixed list of arguments. The binding form runs an expression over an integer range, with a local index variable:"

"   sum(expr; var; start; end)        sum of 'expr' for var = start..end"
"   prod(expr; var; start; end)       same with multiplication"

"The index is local to the expression — it doesn't conflict with a variable of the same name outside."

"Sum 1..100:" total = sum(k; k; 1; 100)
total->                                          "5050"

"Five factorial via prod:" fact5 = prod(k; k; 1; 5)
fact5->                                          "120"

"Sum 1/k² for k = 1..1000 (partial Basel series):" basel = sum(1/k**2; k; 1; 1000)
basel->                                          "approaches π²/6 ≈ 1.6449"
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
                title: '2.4: Record Settings',
                text: `"2.4: Record Settings"

--Variables--

---
"*Record Settings"
---

"Each record has its own settings — decimal places, comma separators, format (float / scientific / engineering), degrees vs radians, and more. They live in the settings panel."

"Find the settings panel: on wider screens it's docked to the right of the variables and formulas panels; on narrower screens, toggle it with the ⚙ icon in the top bar."

"*A number to experiment with"

aLong: 1234.5678901

aLong->

"*Places"

"'Places' is the number of digits after the decimal point. The default for this record is 2, so aLong shows 1,234.57."

"Try changing Places in the settings panel to 4. Solve. aLong shows 1,234.5679."
"Try Places = 0. Solve. aLong shows 1,235."

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
"   Currency       what the '$' marker actually shows ($ default; try € or £)"

"*How settings interact with marker formats"

"Record settings are defaults. The format character on a marker ($, %, °, @d, @t) overrides the defaults for that one variable. So you can have a record where most values are 'float, 4 places' but one specific variable is a percentage or a date."
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
                title: '3.1: Two Equations, Four Variables',
                text: `"3.1: Two Equations, Four Variables"

--Variables--

---
"*Edit any value, solve for the rest"
---

"Tutorial 1.2 showed one equation with three variables: you could fill in any two and solve for the third. The same idea scales up."

"Below, two equations relate four variables: sum, diff, a, and b. The '<-' marker means all four are emptied by the Clear button — handy when you want to try a different combination. Fill in any two, leave the other two blank, and MathPad solves the blanks."

sum<- 10
diff<-  4
a<-
b<-

"Sum:"        a + b = sum
"Difference:" a - b = diff

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
                title: '3.2: Variable Limits',
                text: `"3.2: Variable Limits"

--Variables--

---
"*Variable Limits"
---

"Some equations have more than one solution. Square brackets after the variable name tell MathPad where to look:"

"   x[lo:hi]:"

"The Try-it steps below use the small ⟲ button next to a variable's name in the variables panel. Clicking it clears that variable and runs Solve — a quick way to ask MathPad 'what should this variable be?' without manually clearing it first."


---
"*Two-root quadratic"
---

"x² = target has two solutions: x = +√target and x = -√target. Without a hint, MathPad finds the positive root (its search starts from the positive side). Limits steer it to the other one."

target: 16
x[-10:0]:

"Equation:" x*x = target

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

"Equation:" sin(y) = ratio

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
                title: '3.3: Conditionals and Choices',
                text: `"3.3: Conditionals and Choices"

--Variables--

---
"*Tiered Values with Nested If"
---

"Tutorial 2.3 introduced if(condition; thenValue; elseValue). Nest it to express tiered values like tax brackets, shipping tiers, or discount levels."

"Simplified income tax rates. Equations and function definitions normally end at the newline, but wrapping them in '{ … }' lets them span multiple lines:"

income$: $75,000

"Rate by bracket:" { rate = if(income < 10000; 0%;
                             if(income < 50000; 10%;
                               if(income < 100000; 22%; 32%))) }
"Tax owed:"        tax = income * rate

"Effective rate"  rate%->
"Tax owed"        tax$->

"*Try it"

"Change income to $8,000 (rate = 0%), $30,000 (10%), or $200,000 (32%). Solve after each."


---
"*Choose: pick by index"
---

"choose(n; v1; v2; v3; …) returns the Nth value (1-indexed)."

month: 4

"Days in month:" days = choose(month; 31; 28; 31; 30; 31; 30; 31; 31; 30; 31; 30; 31)

"Days in month"  days->

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

"Shipping rule:" shipping = if(orderTotal > 50 && member == 1; 0; 7.99)

"Shipping"  shipping$->

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
                title: '3.4: Mod-Aware Equations (°=)',
                text: `"3.4: Mod-Aware Equations (°=)"

--Variables--

---
"*Why mod-aware?"
---

"Angles wrap. A compass heading of 380° is the same direction as 20°, and -10° is the same as 350°. Regular '=' treats those as different numbers and won't balance."

"The '°=' operator treats both sides as equal modulo a full turn:"
"   mod 360 in degrees mode"
"   mod 2π in radians mode"

"It's an equation operator (top-level only), used in place of '=' when wrapping matters."


---
"*Compass turn"
---

"newBearing equals oldBearing + turn (modulo 360°). With one equation and three variables, type values into any two and click ⟲ next to the third to ask MathPad to find it."

oldBearing°: 350°
turn[-180:180]°:     30°
newBearing°:

"Compass turn:" newBearing °= oldBearing + turn

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

"Equation:" 3*x °= target

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
                title: '4.1: Tables',
                text: `"4.1: Tables"

--Variables--

---
"*Tables"
---

"A table evaluates a calculation across a range of values, producing one row per iteration."

"   table('Title') = { body }"


---
"*Fahrenheit to Celsius"
---

"Below is a table converting Fahrenheit to Celsius for f = 0, 10, 20, …, 100."

"Before you press Solve, the table shows as a collapsed placeholder — click '>' next to its title to view the source (including the inline comments that annotate each line). Press Solve and the rendered table replaces the placeholder."

table("F to C") = {
  // equation, evaluated each row
  c = (f - 32) * 5/9
  // f sweeps 0 to 100 in steps of 10
  f: 0..100..10
  // output column: label, variable, format, marker
  "F°" f °->
  // second output column
  "C°" c °->
}

"Each row solves independently. Columns appear in declaration order. The '°' in '°->' is the format part of the marker — it makes values display with a degree symbol (32° instead of 32)."

"*Try it"

"In the formulas editor, change f's range:"
"   f: 0..100..10    →    f: -40..40..5"
"Press Solve. The table re-renders over the new range."

"The step is optional — 'f: 0..100' defaults to step 1."

"Click 'as graph' next to the table title to see the same data plotted as a line. Click 'as data' to switch back. (Tutorial 4.2 covers graph tables in detail.)"


---
"*Solving for an unknown each row"
---

"The body equation can have an unknown to solve, just like a regular record. The table below appears after Solve runs (which it has, since you already pressed Solve for the first table). To see the source with its inline annotations, press Clear to revert the table to a placeholder, then click '>' next to its title to expand."

table("Square roots") = {
  // equation with unknown x
  x*x = y
  // y sweeps 0 to 25 in steps of 5
  y: 0..25..5
  // first output column (just y)
  y->
  // second output column (labeled 'Sqrt')
  Sqrt x->
}

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
                title: '4.2: Graph Tables',
                text: `"4.2: Graph Tables"

--Variables--

---
"*Graph Tables"
---

"tableGraph is just like table — same body syntax — but the result renders as an SVG line graph instead of a numeric table."

"   tableGraph('Title') = { body }"


---
"*A sine wave"
---

"Press Solve now — the graph appears immediately below."

tableGraph("y = sin(x)") = {
  // equation, evaluated each row
  y = sin(x)
  // x sweeps 0 to 360 in steps of 10
  x: 0..360..10
  // first output column → X-axis (the ° on x°-> formats tick labels with the degree symbol)
  "angle°" x°->
  // second output column → Y-series
  "sin(x)" y->
}

"The FIRST output column becomes the X-axis. Subsequent output columns become Y-series. (The text export is still tabular — graphing is just how it displays.)"


---
"*Multiple lines on one graph"
---

"Add an inner iterator with its own '->' output, and each value of that iterator becomes a separate labeled line."

tableGraph("y = amp*sin(x)") = {
  // equation
  y = amp*sin(x)
  // outer iterator (X-axis)
  x: 0..360..10
  // inner iterator: 1, 2, 3
  amp: 1..3
  // X-axis (° on x°-> formats tick labels with the degree symbol)
  "angle°" x°->
  // Y-axis
  "y" y->
  // makes amp a line-grouping variable
  amp amp->
}

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
                title: '4.3: Grids',
                text: `"4.3: Grids"

--Variables--

---
"*Grids"
---

"A grid is a 2D table: one iterator drives the rows, another drives the columns, and a value output fills the cells."

"   grid('Title') = { body }"


---
"*Multiplication table"
---

"Press Solve now — the grid appears immediately below."

grid("Multiplication") = {
  // equation, evaluated per cell
  product = x * y
  // first iterator → row headers
  x: 1..10
  // second iterator → column headers
  y: 1..10
  // first output → row headers
  X x->
  // second output → column headers
  Y y->
  // third output → cell value
  product product->
}

"Hover any cell to see its row + column + header highlighted."


---
"*Solving per cell"
---

"The multiplication grid above used a direct assignment ('product = x * y') — the solver just evaluates the right side and stores it. Grid bodies can also hold proper equations, where the unknown is buried inside an expression and Brent's root-finder works it out per cell."

"Here c is squared in the equation, so the solver has to find c such that c² = a² + b² (the positive root)."

grid("Hypotenuse c² = a² + b²") = {
  // equation: c is the unknown, found by the solver per cell
  c*c = a*a + b*b
  // rows
  a: 1..5
  // columns
  b: 1..5
  // row headers
  A a->
  // column headers
  B b->
  // solved cell value
  C c->
}

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
                title: '4.4: Compass Rose',
                text: `"4.4: Compass Rose"

--Variables--

---
"*vectorDraw"
---

"vectorDraw renders a set of vectors as an SVG diagram. The 'type' argument tells MathPad how to interpret each (a, b) pair:"

"   navigation    (bearing, magnitude)  — 0° = north, increasing clockwise"
"   polar         (angle, magnitude)    — 0° = east, increasing counter-clockwise"
"   cartesian     (x, y)                — raw coordinates"

"   vectorDraw('Title'; type) = { body }"


---
"*A compass rose"
---

"Eight unit vectors radiating from the origin at the standard bearings. Press Solve now — the diagram appears immediately below."

vectorDraw(">v Compass Rose"; navigation) = {
  // Each vector is FOUR output declarations in a row:
  //   start direction, start magnitude, end direction (with label), end magnitude.
  // All eight vectors here start at the origin (magnitude 0) and end Dist units out.

  Dist: 1

  0 °->          // vector 1: start direction (unused when magnitude is 0)
  0 ->           // start magnitude (0 → at origin)
  N 0 °->        // end bearing; 'N' is the legend label
  Dist ->        // end magnitude (vector length)

  // vectors 2–8: same start, different end bearings
  0 °->
  0 ->
  NE 45 °->
  Dist ->

  0 °->
  0 ->
  E 90 °->
  Dist ->

  0 °->
  0 ->
  SE 135 °->
  Dist ->

  0 °->
  0 ->
  S 180 °->
  Dist ->

  0 °->
  0 ->
  SW 225 °->
  Dist ->

  0 °->
  0 ->
  W 270 °->
  Dist ->

  0 °->
  0 ->
  NW 315 °->
  Dist ->
}

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
                title: '4.5: Outer Parameters',
                text: `"4.5: Outer Parameters"

--Variables--

---
"*Driving a table with outer values"
---

"Variables declared OUTSIDE a table or grid are visible inside it. This lets you parameterize the calculation — keep the equation general and pull values like rates, scale factors, or starting points from a single place above. Change an outer value, press Solve, and every row recomputes with the new parameter. Without this, you'd have to bake constants into the equation, making 'what if rate were 7%?' a tedious edit."


---
"*Example: years to reach each target"
---

"Outer pv, rate, and years describe one compound-interest scenario — useful for any single calculation in this record. The table re-uses pv and rate per row, but sweeps fv and re-solves for years."

pv$:    $1,000
rate%:  5%
years:  20

fv = pv * (1 + rate)**years

"Outer growth (one scenario, using years = 20):"
fv $->

table("Years to grow \\pv$\\ to each target at \\rate%\\") = {
  // No equation in the body — the table inherits the outer 'fv = pv * (1+rate)**years'.
  // (Tables only override outer equations if you put one in the body.)
  // iterator: target value
  fv: 2000..10000..2000
  // 'years<-' shadows the outer years=20 — solve for years per row
  years<-
  "Target" fv $->
  "Years"  years->
}

"Change pv or rate above and Solve. Both the outer fv (at years=20) and every table row recompute together."


---
"*Shadowing outer values with var<-"
---

"There's a subtler use of outer variables: when one is referenced by an equation that also runs inside a table, the outer value flows in by default. 'var<-' inside the table body shadows it, telling the solver to treat that variable as a per-row unknown — re-found for each row independently, while the outer declaration keeps its value for use elsewhere (here, by the outer fv calculation above)."

"*Try it"

"  •  Remove 'years<-' from the table body and Solve. The outer years=20 now applies to every row, so years is fully determined — no per-row unknown remains for the solver to find, and the Years column comes back blank. Add 'years<-' back to fix it."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 5, 1, 12, 0, 0),
            },
            {
                id: generateId(),
                title: '5.1: User-Defined Functions',
                text: `"5.1: User-Defined Functions"

--Functions--
"BMI = weight (kg) / height² (m). Returns a unitless number."
bmi(weight; height) = weight / height**2

--Variables--

---
"*Writing your own function"
---

"MathPad has 50+ built-in functions. You can also define your own — useful for any formula you'll reuse, or for keeping a busy equation readable."

"Syntax:"

"   name(arg1; arg2; ...) = expression"

"By convention, function definitions are grouped under a '--Functions--' section in the formulas editor (technically they can appear anywhere). This record's formulas editor has 'bmi' defined that way — once defined, you can call it anywhere a formula or expression is used."

"In the formulas editor, a definition's signature — the 'name(arg1; arg2; ...)' part up to the '=' — gets a subtle highlighted band. That's how you tell a function definition apart from an ordinary equation at a glance (both are otherwise just 'left = right')."

weight:  70             // kg
height:  1.75           // m

"Body Mass Index:" myBmi = bmi(weight; height)

myBmi->

"User-defined functions are usable wherever expressions are valid — including inside table bodies:"

table("vv BMI by weight (at height = \\height\\ m)") = {
  // The table inherits no outer equation; it just calls bmi(...) per row.
  weight: 50..120..10
  "Weight (kg)" weight->
  "BMI"         bmi(weight; height)->
}

"*Try it"

"Press Solve. myBmi ≈ 22.86."

"Change weight and Solve — myBmi updates, but the table doesn't (its 'weight: 50..120..10' iterator overrides the outer weight)."

"Change height and Solve — both myBmi and every row of the table update, because the table doesn't override height."


---
"*Sharing functions across records"
---

"A function in this record's '--Functions--' section is local to THIS record. To make one available in EVERY record, put it in the special FUNCTIONS record (in the sidebar's ★ section, alongside Constants)."

"The Functions record already includes:"

"  •  pmt(pv; rate; n; fv; pmtDue)  loan / annuity payment"
"  •  compound(pv; rate; n)         compound interest"
"  •  ctof(c)                       Celsius → Fahrenheit"
"  •  ftoc(f)                       Fahrenheit → Celsius"

"*Try it"

"  •  Open the Functions record from the sidebar (★ section, near the top)."
"  •  At the bottom of that record, add:"
"        imperialBmi(lb; inches) = lb / inches**2 * 703"
"  •  Come back to this record. In the formulas editor below '--Variables--', add a line like:"
"        usBmi = imperialBmi(155; 70)"
"  •  Add a display line:  usBmi->"
"  •  Solve. usBmi ≈ 22.24 — your new global function works from here just like the built-ins."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 5, 1, 12, 0, 0),
            },
            {
                id: generateId(),
                title: '5.2: The Constants Record',
                text: `"5.2: The Constants Record"

--Variables--

---
"*Built-in constants"
---

"MathPad ships with a CONSTANTS record (sidebar's ★ section, alongside Functions). Any variable defined there is visible from every record — use them directly in equations, no need to redefine locally."

"What's already in there:"

"  •  pi, euler, golden             mathematical constants"
"  •  lightSpeed, gravitational     physics"
"  •  planck, boltzmann, avogadro   more physics"
"  •  secsPerHour, secsPerDay       time conversion shortcuts"

"In the formulas editor, names defined in the Constants record get highlighted as built-ins (the same style as pi or sqrt) — a visual reminder that they're reference values, not your record's local variables."


---
"*Example: circle math"
---

radius:  5

"Circumference:" circumference = 2 * pi * radius
"Area:"          area = pi * radius**2

circumference->
area->


---
"*Example: how far does light travel?"
---

"lightSpeed is about 300,000,000 m/s. The table below uses it alongside the local iterator t."

table("vv Light-distance vs time") = {
  // t sweeps seconds; lightSpeed comes from the Constants record
  t: 1..10..1
  meters = lightSpeed * t
  "Seconds" t->
  "Meters"  meters->
}


---
"*Adding your own constants"
---

"To make a value available in every record, add it to the Constants record."

"*Try it"

"  •  Open the Constants record from the sidebar."
"  •  Add a line at the bottom:"
"        feetPerMeter: 3.28084"
"  •  Come back here. In the formulas editor (below '--Variables--'), add:"
"        roomFt = 10 * feetPerMeter"
"        roomFt->"
"  •  Solve. roomFt ≈ 32.81."

"The new constant works everywhere now, with the same highlighting as the built-in ones."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 5, 1, 12, 0, 0),
            },
            {
                id: generateId(),
                title: '5.3: Dates and Times',
                text: `"5.3: Dates and Times"

--Variables--

---
"*Date and duration formats"
---

"Two format markers handle calendar work:"

"  •  @d  date         locale-aware (MM/DD/YYYY or DD/MM/YYYY)"
"  •  @t  duration     H:MM:SS"

"Append '>>' (e.g. @d->>, @t->>) to include time-of-day or fractional seconds."

"Durations of 24h or more display with a day count: '2d 5:30:00' is 2 days plus 5 hours 30 minutes. The parser accepts the same form on input."

"Internally, dates are stored as seconds since Jan 1, 1970 UTC (epoch); durations are just numbers of seconds. The format markers control display and parsing."

"Input also accepts the same formats. Type a date or duration directly into a '@d:' or '@t:' variable — MathPad parses it back to seconds:"

"   when@d: 4/1/2026                  (or 4/1/2026 14:30 for a specific time)"
"   dur@t:  1:30:00                   (or 1d 5:30:00 for over 24 hours)"


---
"*Built-in functions"
---

"   Now()                      current date+time (epoch seconds)"
"   Date(y; m; d; h; mn; s)    build a date from components (3–6 args)"
"   Days(d1; d2)               days from d1 to d2 (positive if d1 is earlier)"
"   Year(d), Month(d), Day(d)  extract components"
"   Hour(d), Minute(d), Second(d)"
"   Weekday(d)                 1 (Mon) … 7 (Sun)"
"   Hours(t)                   duration t (seconds) → fractional hours"
"   TimePart(d)                seconds since local midnight"

"From the Constants record: secsPerHour (3600), secsPerDay (86400)."


---
"*Example: countdown to a deadline"
---

today = Now()

"Today is:" today @d->>

deadline = Date(Year(today); 12; 31)
"Deadline:" deadline @d->

daysLeft = Days(today; deadline)

"Days remaining:" daysLeft->
"Time remaining:" daysLeft*secsPerDay @t->

"Date(y; m; d) builds a date from components, so Date(Year(today); 12; 31) is the end of the current year. Days(d1; d2) returns fractional days; multiplying by secsPerDay gives total seconds, which @t formats as 'Nd H:MM:SS'."

"Change the deadline expression in the formulas editor to your own target date and Solve."


---
"*Example: travel times"
---

"How long does it take to drive a distance at a given speed?"

"   time (hours) = distance / speed"

"The '@t' format expects seconds, so multiply hours by secsPerHour to get the value @t will display as H:MM:SS:"

grid("vv Travel time by distance and speed") = {
  // distance in miles, speed in mph; result in seconds for the @t format
  t = distance / speed * secsPerHour
  distance: 50..500..50
  speed: 30..70..10
  "Distance (mi)" distance->
  "Speed (mph)"   speed->
  "Time"          t @t->
}

"For 250 miles at 60 mph: 4:10:00. Hover any cell to see its row and column highlighted."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 5, 1, 12, 0, 0),
            },
            {
                id: generateId(),
                title: '5.4: Pre-Solve Values and Persistence',
                text: `"5.4: Pre-Solve Values and Persistence"

--Variables--

---
"*Looking at the previous solve"
---

"Sometimes a calculation needs to refer to its own previous result — a counter that increments, a change tracker, a running total. MathPad gives you two postfix operators for this:"

"  •  x~     the pre-solve value of x  (value stored in the text before this Solve began)"
"  •  x~?    1 if x has a pre-solve value, 0 otherwise"

"Use 'x~?' as a guard around 'x~' so the first Solve (when no value exists yet) doesn't error."


---
"*Persistent outputs (:> and :>>)"
---

"You already know two output markers:"

"  •  ->     cleared by the Clear button AND before each Solve"
"  •  ->>    same, but full precision"

"Two more markers persist through Clear:"

"  •  :>     cleared only before each Solve (survives Clear)"
"  •  :>>    same, but full precision"

"Use ':>' for derived values that should remain visible as part of the record across Clear cycles — counters, accumulators, and anything you want to compare to its previous self."


---
"*Example: solve counter"
---

"Each press of Solve increments the count. Press Clear and the count stays — only manually editing the value resets it."

solveCount = if(solveCount~?; solveCount~ + 1; 1)
solveCount:>

"How it works:"
"  •  First Solve: solveCount~? is 0, so the if() picks the else branch (1)."
"  •  Subsequent Solves: solveCount~? is 1, so it reads solveCount~ (the prior result) and adds 1."
"  •  The ':>' marker stores the new value in the record text, surviving the Clear button."

"Try it: press Solve a few times, then press Clear, then Solve again. The count keeps climbing."


---
"*Example: running total"
---

"Inside a table, '~' has a sibling meaning: it refers to the PREVIOUS ROW's value (not the previous Solve). Combined with '~?' as a guard for the first row, this gives you running totals, cumulative sums, and compound growth — patterns that would otherwise need a recursive function."

"This table compounds an annual contribution at a fixed return rate. The 'balance' column uses the previous row's balance, grows it by 'rate', and adds the year's contribution."

contrib$: 5000
rate%: 7%

table("vv Investment growth, $5,000/yr at 7%") = {
  year: 1..10
  balance = if(balance~?; balance~; 0) * (1 + rate) + contrib
  totalIn = contrib * year
  interest = balance - totalIn

  "Year"        year->
  "Contributed" totalIn$->
  "Balance"     balance$->
  "Interest"    interest$->
}

"How it works, row by row:"
"  •  Row 1 (year 1): balance~? is 0 (no previous row), so the if() picks 0. Balance = 0 + first contribution."
"  •  Row 2+: balance~ holds the prior row's balance, which compounds."

"Change 'contrib' or 'rate' and Solve to see how the curve shifts."


---
"*A note on constants"
---

"Unshadowed constants always have a pre-solve value (their constant value), so 'pi~?' is always 1 and 'pi~' is pi. The ~ operator is interesting mainly for variables that change between Solves."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 5, 1, 12, 0, 0),
            },
            {
                id: generateId(),
                title: '6.1: Sidebar, Categories, and Tabs',
                text: `"6.1: Sidebar, Categories, and Tabs"

--Variables--

---
"*The sidebar"
---

"The SIDEBAR holds every record in your MathPad. On wider screens it sits along the left edge; on narrower screens it's hidden behind the hamburger menu (☰) in the header — tap to slide it open, tap a record or the backdrop to close."

"Records are grouped by CATEGORY — click a category header to collapse or expand its records. The count next to the category name shows how many records it contains."

"Click a record to open it as a PREVIEW (italicized tab, single slot — opening another preview replaces it). Double-click, or edit the record, to PROMOTE it to a regular tab that survives reloads."

"Each category header has two small controls:"

"  •  A↓        toggle between insertion order (default) and alphabetical sort"
"  •  ✕         delete the category (only shown when it's empty — 'Unfiled' and 'Reference' can't be deleted)"

"Tip: the divider between the sidebar and the editor area is draggable. Drag it left or right to resize, and MathPad remembers the width across sessions."


---
"*Special records"
---

"Three records are special. They live in the 'Reference' category, appear at the top of it, and are marked with a ★:"

"  •  ★ Constants          its variables are available in EVERY record (pi, e, secsPerDay, your own)"
"  •  ★ Functions          its user-defined functions are callable from EVERY record"
"  •  ★ Default Settings   its title, settings, and content are the template for + New Record"

"Tutorials 5.1 and 5.2 cover Constants and Functions in detail. Default Settings is where you adjust the starting decimal places, format, and other per-record settings that every new record inherits."

"You only get one of each — MathPad picks the record whose title matches exactly."


---
"*Creating and organizing records"
---

"At the bottom of the sidebar:"

"  •  + New Record         creates a blank record in the 'Unfiled' category"
"  •  Import               loads records from a text file (covered in 6.3)"
"  •  Export               saves all records to a text file (covered in 6.3)"
"  •  Reset                wipes everything back to the default starter records"

"To move a record into a different category, open its detail panel (⚙ button in the header) and pick from the Category dropdown. The dropdown also includes a 'New category…' option that prompts you for a new name."

"To rename a record, double-click its title in the sidebar — or just edit the first line of the record in the formulas editor (the title comes from there)."


---
"*On smaller screens"
---

"The sidebar collapses into the hamburger menu (☰) at narrower widths. Below ~560px, the Help and Theme buttons also move from the header down into the sidebar to free up header space."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 5, 2, 12, 0, 0),
            },
            {
                id: generateId(),
                title: '6.2: Keyboard Shortcuts',
                text: `"6.2: Keyboard Shortcuts"

--Variables--

---
"*Global"
---

"These work from anywhere in the app (Cmd substitutes for Ctrl on Mac):"

"   Ctrl+Enter         Solve the current record"
"   Ctrl+Shift+Enter   Solve and append a '--- Table Outputs ---' text section"
"   Ctrl+S             Solve (same as Ctrl+Enter, no append)"
"   Ctrl+Shift+S       Clear inputs and outputs (same as the Clear button)"
"   Ctrl+Z             Undo (routes to the active editor)"
"   Ctrl+Y             Redo (or Ctrl+Shift+Z)"
"   Escape             Close an open modal or the mobile sidebar"


---
"*Solve button modifiers"
---

"The Solve button responds to modifier keys when you click it:"

"   Solve              Normal solve"
"   Shift+click        Solve, then append a '--- Table Outputs ---' text section (same as Ctrl+Shift+Enter)"
"   Ctrl+click         Solve in TRACE mode — appends a '*--- Solve Trace ---' section showing the steps the solver took. Useful when a result surprises you."
"   Ctrl+Shift+click   Both — trace plus table outputs"


---
"*Undo across Solves"
---

"MathPad treats Solve as just another edit on the undo stack — the same Ctrl+Z that undoes typing will also undo a Solve, restoring the variable values and status text from BEFORE the solve ran. You can step back through a long session and replay it forward with Ctrl+Y."

"Variable-panel edits, Tab indent, and Ctrl+/ comment toggle are all undoable too."


---
"*Formulas editor"
---

"When the cursor is in the formulas editor (the syntax-highlighted area below the variables panel):"

"   Tab                Indent 2 spaces (or indent every selected line)"
"   Shift+Tab          Outdent the current line (or every selected line)"
"   Ctrl+/             Toggle '// ' line comment on the current line or selection"
"   Escape             Defocus the editor"


---
"*Variables panel"
---

"When you click into an input value in the variables panel:"

"   Tab                Move to the next input (wraps around)"
"   Shift+Tab          Move to the previous input"
"   Enter              Commit the edit and Solve"
"   Escape             Revert the in-progress edit"

"Tab cycling is handy for sweeping through a record's inputs to try different values — press Tab to advance, type a new value, Enter to Solve."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 5, 2, 12, 0, 0),
            },
            {
                id: generateId(),
                title: '6.3: Import and Export',
                text: `"6.3: Import and Export"

--Variables--

---
"*Export"
---

"The 'Export' button at the bottom of the sidebar saves EVERY record to a single text file named 'mathpad_export_YYYY-MM-DD.txt'. The file lands in your browser's downloads folder."

"Use export to:"

"  •  back up your MathPad before experimenting"
"  •  copy records to another browser or device"
"  •  share a record (paste the text into a message, or attach the file)"


---
"*Import"
---

"The 'Import' button opens a file picker. Pick a previously-exported MathPad .txt file and confirm — IMPORT REPLACES ALL EXISTING RECORDS, so export first if you want to keep what you have."

"The exported text format is also accepted from the original 1997 PalmOS MathPad's MpExport utility, so old PalmOS archives can be imported as-is."


---
"*The file format"
---

"Each record is a plain-text block, separated from the next by a line of 27 tildes:"

"   ~~~~~~~~~~~~~~~~~~~~~~~~~~~"

"Inside a block, the first few lines are metadata (Category, Places, Format, etc.); the rest is the record's text exactly as it appears in the formulas editor. A small example block looks like this:"

"   Category = \\"Examples\\"; Secret = 0"
"   Places = 2; StripZeros = 1"
"   Format = \\"float\\"; GroupDigits = 1; DegreesMode = 1"
"   Created = \\"2026-04-12T09:00:00.000Z\\"; Modified = \\"2026-04-15T18:23:11.000Z\\""
"   \\"My calculator\\""
"   "
"   a + b = c"
"   a: 3"
"   b: 4"
"   c->"
"   ~~~~~~~~~~~~~~~~~~~~~~~~~~~"

"What's preserved on round-trip: titles, content, category, decimal places, format, group digits, degrees mode, currency symbol, status, and creation / modification timestamps."


---
"*Tips"
---

"  •  EDIT BEFORE IMPORT — the export file is plain text. You can open it in any editor, trim it to one record, fix a typo, or stitch two exports together (just keep the tilde separators between records)."

"  •  SHARING ONE RECORD — copy a single block from your export file (everything from one tilde line through the next) and paste it as a snippet. The recipient can wrap it with their own export-style header lines if needed, or just type the formulas directly into a new record."

"  •  RESET — the 'Reset' button next to Import/Export wipes your current MathPad back to the default starter records (Welcome, tutorials, examples). Export first if you've made changes you'd like to keep."
`,
                category: 'Tutorial',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 5, 2, 12, 0, 0),
            },
            {
                id: generateId(),
                title: 'Sample tables',
                text: `"Sample tables"
--Variables--
"*Sample tables"
"Three quick demos — a table, a multi-iterator table, and a grid. Press Solve to fill them in."

"1d table with font size 18"
table("vv single iterator x:0..4, y=x*2, z=x*y"; 18) = {
  y = x*2
  z = x*y
  x: 0..4
  x->
  y->
  z->
}

"1d, 2 iterator table with default font size"
table("vv two iterators x:0..4, y=0..8..2, z=x*y") = {
  z = x*y
  x: 0..4
  y: 0..8..2
  x->
  y->
  z->
}

"2d grid"
grid("vv two iterators x:0..4, y=0..8..2, z=x*y") = {
  z = x*y
  x: 0..4
  y: 0..8..2
  x->
  y->
  z->
}`,
                category: 'Examples',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 5, 6, 12, 0, 0),
            },
            {
                id: generateId(),
                title: 'Sample tableGraphs',
                text: `"Sample tableGraphs"
--Variables--
"*Simple tableGraph - single iterator, single series"

tableGraph("vv One iterator: x; One series: cube root") = {
  x: 1..9..0.5
  x->
  Cube Root x**(1/3)->
}

"*Single iterator, multi-series tableGraph"
"After Solving, click 'as table' to see the calculated values for the graph"

tableGraph("vv One iterator: x; Two series: square and cube root") = {
  x: 1..9..0.5
  x->
  Square Root sqrt(x)->
  Cube Root x**(1/3)->
}

"*Multi-iterator, single series tableGraphs"
"- the first iterator (x) becomes the X-axis;
- the others (y, z) become grouping iterators — each combination draws one line per series"

tableGraph("vv Two iterators: x and y; One series: length") = {
  x: 0..6..0.5
  y: 0..6..3
  x->
  y->
  Length sqrt(x**2 + y**2)->
}

tableGraph("vv Three iterators: x, y, and z; One series: length") = {
  x: 0..6..0.5
  y: 0..6..3
  z: 0..6..3
  x->
  y->
  z->
  Length sqrt(x**2 + y**2 + z**2)->
}

"*Multi-iterator, multi-series tableGraphs"

tableGraph("vv Two iterators: x and y; Two series: square root and cube root") = {
  x: 0..6..0.5
  y: 0..6..3
  x->
  y->
  Square Root sqrt(x**2 + y**2)->
  Cube Root (x**2 + y**2)**(1/3)->
}

tableGraph("vv Three iterators: x, y, and z; Two series: square root and cube root") = {
  x: 0..6..0.5
  y: 0..6..3
  z: 0..6..3
  x->
  y->
  z->
  Square Root sqrt(x**2 + y**2 + z**2)->
  Cube Root (x**2 + y**2 + z**2)**(1/3)->
}`,
                category: 'Examples',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: true,
                created: Date.UTC(2026, 5, 7, 12, 0, 0),
            },
            {
                id: generateId(),
                title: 'Table inheritance',
                text: `"Table inheritance"
--Variables--

"*Solve a simple loan, then let a table reuse the SAME formula and variables — overriding the rate and pmt per row. It shows how a table inherits the record's equations and inputs."

"Time value of money formula:" pmt = pv * rate / (1 - (1 + rate)**-n)

"*Loan"
"Amount"           pv $: $20000
"Annual rate"      rate%: 6%
"Years"            n: 5
"Annual payment"   pmt$<-

"*Payment by rate"
"The table below has no equation and no pv/n of its own — it inherits the 'pmt =' formula and the pv and n values above. The iterator overrides 'rate', so each row uses a different rate."

"There's a catch worth understanding: 'pmt' is solved in the loan above, and its value is written back into the 'pmt$<-' line — so the table would otherwise inherit that one fixed payment. To make each row RE-solve pmt from the inherited formula, the table body re-declares it as an unknown with 'pmt<-'. (Delete that line and re-solve: the pinned $4,747.93 clashes with the formula at every rate but 6%, so those Payment cells come up blank.)"

table("vv Payment by interest rate") = {
  rate: 0.04..0.08..0.005
  pmt<-
  "Rate"      rate%->
  "Payment"   pmt $->
}

"Notice the 6% row equals the 'Annual payment' above — same formula, same pv and years, just rate swapped for the iterator value and pmt recalculated. Change pv, rate, or years and re-solve: the single result and every table row update together."`,
                category: 'Examples',
                places: 2,
                stripZeros: true,
                groupDigits: true,
                format: 'float',
                degreesMode: false,
                created: Date.UTC(2026, 5, 8, 12, 0, 0),
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
"Future value of account(s)" fv = pv * (1 + gain)**years
"Gross total return" return = yearlyPmtRate + fees + gain

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

"*Estimate fixed and variable monthly retirement withdrawals"

"Enter retirement account(s) present value, life expectancy, yearly gain (or future value), fees, and total expected annual return; then click the Solve button.  Correct any orange results by pressing \u27F2 next to one of the orange values."

"*Future value of account(s)"
"Present value" pv $: $1,000,000
"Life expectancy" years : 20
"Yearly gain" gain %<- 1.125%
"Future value" fv $<-

"*Gross total return"
"Management fees" fees %: 0.65%
"Yearly payment rate" yearlyPmtRate %<-
"Total return" return %<- 6%


"*Variable payments (monthly as percentage of each year's account(s) balance)"
"Year one" year1 $->
"Last year" yearN $->
"Total payments" totVPmt $->
"Total fees" totVFees $->


"*Fixed monthly payments"
"Monthly payment" fixedPmt $->
"Total payments" totFPmt $->
"Total fees" totFFees $->


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
"*Update values, then click solve or the solve ⟲ icon next to a variable."
"For example, set Present Value to $200,000 and press the solve ⟲ icon next to Payment."

"*Time value of money"
"Present Value" pv $: $100,000
"Future Value" fv $: $0               "(balloon payment)"
"Annual Rate" rate %: 6.125%
"Loan Term" years : 30                "Term in years"
"Payment" pmt $:


"*Seldom used tweaks"
"Payments/Year" pmtsYr: 12
"Compounds/Year" cmpndsYr: pmtsYr     "generally equals payments/year"
"Annuity Due" pmtDue[0..1]: end       "end or begin of period"


"*Prepayments"
"Prepayment" extraPmt $: $0           "Extra principal payment per period"
"Actual Term" actYears : years        "Actual term given prepayments"



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
                title: 'Example: Fourier Square Wave',
                text: `"Fourier Square Wave"

--Functions--

"Square wave as a Fourier series — (4/pi) times the sum of sin((2k-1)x)/(2k-1) for k from 1 to N. The (2k-1) factor picks off only the odd harmonics; even ones vanish for a symmetric square wave."
square(x; N) = (4/pi) * sum(sin((2*k-1)*x) / (2*k-1); k; 1; N)

--Variables--

---
"*Fourier approximation of a square wave"
---

"This record is in degrees mode, so sin() takes degrees and the fundamental's period is 360°."

"Press Solve to render the graph below. The graph plots y = square(x; N) over two full periods. Change N to see the approximation sharpen as more harmonics are added."

"Number of harmonics" N: 10

tableGraph("Square wave (N = \\N\\ terms)") = {
  // x sweeps two periods; small step keeps the transitions crisp
  x: 0..720..2
  y = square(x; N)
  "x°" x °->
  "y"  y->
}


---
"*Try it"
---

"Change N to 1, 3, 10, 50, or 200 and Solve after each."

"  •  N = 1  — just a single sine"
"  •  N = 3  — recognizable as a square wave with rounded corners"
"  •  N = 50 — sharp transitions, but visible ripples near each step"
"  •  N = 200 — very sharp, but the overshoot just at each transition stays about 9% — that's the Gibbs phenomenon, a fundamental property of Fourier series at discontinuities."

"*Why sum() and not recursion?"

"You could write the series recursively, but sum() avoids the recursion-depth limit and is faster for large N. The local variable k inside sum(...; k; 1; N) is bound to each integer in the range; outside the call, k means nothing."`,
                category: 'Math',
                places: 4,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: true,

            },
            {
                id: generateId(),
                title: 'Constants',
                text: `"Physical and mathematical constants"

--Variables--
"*Constants defined here are available in all records"

"*Naming convention: descriptive lowercase or camelCase names. They read more clearly in equations than single letters and leave the single-letter namespace free for your own variables. pi keeps its conventional lowercase form."

pi: 3.141592653589793
euler: 2.71828182845905
lightSpeed: 299792458 "speed of light m/s"
gravitational: 6.67430e-11 "gravitational constant"
planck: 6.62607015e-34 "Planck constant"
boltzmann: 1.380649e-23 "Boltzmann constant"
avogadro: 6.02214076e23 "Avogadro number"
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
hypot(a; b) = sqrt(a**2 + b**2)


"Quadratic discriminant"
disc(a; b; c) = b**2 - 4*a*c`,
                category: 'Reference',
                places: 2,
                stripZeros: true,
                groupDigits: false,
                format: 'float',
                degreesMode: false,

            },
            { id: generateId(), ...DEFAULT_SETTINGS_RECORD }
        ],
        categories: ['Tutorial', 'Examples', 'Unfiled', 'Finance', 'Math', 'Medical', 'Science', 'Reference'],
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
