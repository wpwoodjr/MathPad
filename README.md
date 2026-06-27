# History

<img align="right" width="140" alt="MathPad icon" src="https://github.com/user-attachments/assets/77817643-bd90-4c19-9ec7-9f2654016c79" />

MathPad is an equation solver, originally created by **Rick Huebner** for PalmOS PDAs (circa 1997–2000). I always loved MathPad but never found anything to replace its combination of simplicity and power.  This repository contains a modern web-based reimplementation, plus the original MathPad 1.5 release (documentation, PRC files, and desktop utilities).

# MathPad

**Write equations the way you'd write them on paper, fill in what you know, and MathPad solves for whatever's left — in either direction.**

Instead of rearranging formulas by hand, you write the relationships once and let it find the unknown — give it the inputs and it computes the result, or give it the result and it works backward to an input. It handles linked systems of equations, 50+ built-in functions, tables and graphs, dates and money, and ships with an interactive tutorial. One web page, no install, no account, works offline.

**[Try it online →](https://mathpad.hoodoop.com/)**

### A 30-second taste

This is a Mathpad record.  The first line is the title, the second is the equation for time value of money.  Below that are the variables.  In this case we will solve for `pmt`:
```
TVM (Loan Amortization)
pmt = -pv/((1-(1+int/12)**-n)/(int/12))

pv $<- $150,000
int %<- 6.25%
n <- 360
pmt $<-
```

Click **Solve** and `pmt $<-` becomes `pmt $<- -923.58`. The trick is that you can leave *any* variable blank instead: clear `int`, set `pv` to `$100,000`, and Solve — MathPad sees that `int` is now the unknown and works backward to find `int %<- 10.62%`. Same equation, no rearranging; you just choose which value you don't know.

<img width="727.5" height="750" alt="image" src="https://github.com/user-attachments/assets/05ab23e2-34a9-4b5a-ac04-40988d686073" />


### Why MathPad?

It hits a sweet spot between a calculator, a spreadsheet, and Wolfram. A **calculator** makes you rearrange the formula to solve backward — and can't at all when there's no closed form, like getting a loan's rate from its payment; MathPad just blanks the unknown and finds it numerically. A **spreadsheet** is one-directional and buries formulas inside cells, while MathPad solves in any direction and shows the relationships *as* readable, named equations. **Wolfram** is far more powerful but built for one-shot queries or heavyweight notebooks; MathPad is a set of lightweight documents you keep and re-solve as your numbers change — free, instant, and offline. (Reach for a spreadsheet when you have big datasets, and Wolfram for symbolic math or calculus.)

# Web Application

Open `docs/index.html` in any browser — no build step, no server — or use the [live version](https://mathpad.hoodoop.com/).

### Core Features

- **Automatic Equation Solving** — detects unknown variables and solves using Brent's root-finding method. Solve forward or backward: give it any combination of knowns and unknowns
- **50+ Built-in Functions** — math, trig (degrees/radians), date/time, iteration (`sum`/`prod` binding form), and control flow
- **User-defined Functions** — define functions like `f(x;y) = expr` in any record, or in the "Functions" record to make them available globally
- **Global Constants** — define constants in a "Constants" record, available to all other records
- **Interactive Tutorial Series** — six lesson groups in the sidebar's Tutorial category cover the language and the app, from a first equation through tables, dates, and the workflow tools
- **Tables, Grids, and Graphs** — iterate variables over ranges to produce columnar tables or 2D grids, then click `as graph` to visualize it
- **Vector Diagrams** — `vectorDraw` renders SVG vector diagrams in navigation, polar, or cartesian coordinates with legend and per-vector solving
- **Import/Export** — compatible with original PalmOS MathPad export format
- **Optional Google Drive sync** — keep your records in the cloud and synced across devices; works entirely in the browser without it

### Editor

- **Multiple tabs** — work on multiple records.  Records are saved across browser sessions.
- **Syntax-highlighted editor** with line numbers and real-time token coloring.
- **Variables panel** — structured view of all variables with editable inputs, equation balance highlighting (green/orange/red), and flash animation on value changes.
- **Undo/redo** — full undo history with Ctrl+Z / Ctrl+Y.
- **Split-pane layout** — resizable variables panel above the formulas editor
- **Resizable sidebar** — drag to adjust sidebar width, persisted across sessions
- **Light/dark theme** — light by default, toggle with one click; your choice persists across sessions

### Number Formatting

- **Configurable** decimal places, trailing zero stripping, comma grouping
- Scientific and engineering notation
- **Money format** (`price$:`) — displays as `$1,234.56`; the currency symbol is configurable per record (€, £, ¥, ₹, … — suffix currencies show after the number)
- **Percent format** (`rate%:`) — stores as decimal, displays with `%`
- **Angular format** (`angle°:`) — mode-aware: degrees mode displays mod 360 with `°` suffix; radians mode displays mod 2π with no symbol
- **Date/duration formats** (`@d`, `@t`) — locale-aware date display; H:MM:SS duration display, with `Nd H:MM:SS` for durations ≥ 24h
- **Numeric bases** (`hex#16:`) — bases 2 through 36
- **Inline evaluation** (`\expr\`) — evaluates expression in table/grid titles for display

### Variable Types

| Syntax | Behavior |
|--------|----------|
| `var: value` | Persistent variable |
| `var<- value` | Input — cleared by Clear button |
| `var<<- value` | Input — full precision, cleared by Clear |
| `var:: value` | Full precision, persistent |
| `var->` | Output — cleared and recomputed on Solve |
| `var->>` | Output — full precision |
| `var:>` | Persistent output — recomputed on Solve, kept on Clear |
| `var:>>` | Persistent output — full precision |
| `var[lo:hi]:` | Constrain search range for root-finding (auto-swap if reversed) |
| `var[lo:hi:step]:` | With explicit step for Brent's grid search |
| `cmg[a:b]°:` | `°` format is display-only; for wrap-through-0° search, extend the linear range past 360 (e.g. `[327.8:365.5]`) |
| `x~` | Pre-solve value (value before this solve started) |
| `x~?` | 1 if variable has a pre-solve value, 0 otherwise |

### Equations

An equation is a line with `=` between two expressions. If all variables have values, MathPad checks that both sides balance. If there's an unknown, it solves using Brent's root-finding method.

| Syntax | Behavior |
|--------|----------|
| `a = b` | Standard equation — balance check or solve for unknown |
| `a °= b` | Degree equality — compares mod 360 (or mod 2π in radians mode), so `359.99 °= 0.01` balances |

`°=` is only valid at the top level of an equation line (for balance checks and Brent's solving); it is not a general expression operator.

### Solving Linked Systems

When a record has several unknowns, MathPad reduces the system before root-finding: it derives algebraic substitutions to isolate variables (**symmetrically** — `x = z/2` yields both `x → z/2` *and* `z → 2*x`), partitions independent equations into separate components to avoid combinatorial blow-up, and runs a recursive backtracker to find a consistent assignment. In practice you can hand it a tangle of related equations and let it work out the order and the algebra. (For the exact substitution forms recognized, see [arch.md](arch.md).)

<img align="right" width="264" height="472" alt="image" src="https://github.com/user-attachments/assets/6019be55-e919-4aaa-a8f4-32b2ff8bfe95" />

### Tables, Grids, and Vector Diagrams

Use `table` for columnar output, `grid` for 2D cell grids, and `vectorDraw` for vector diagrams (navigation, polar, or cartesian):

```
table("Distance vs Time") = {
  distance = speed * time
  speed: 60
  time: 1..5
  time->
  distance->
}

grid("Multiplication") = {
  z = x * y
  z<-
  x: 1..5
  y: 1..5
  x->
  y->
  z->
}
```

**Table body declarations:**
- `x: 0..10` or `x: 0..10..2` — iterator (range with optional step)
- `z<-` — unknown for equation solving (bare, no value)
- `v: 10` — definition (expression value)
- `Label z->` — output column with optional label

Tables inherit the record's outer equations and values when the body doesn't define its own; a body declaration overrides the inherited one. Each row/cell is solved independently. Optional font size: `table("Title"; 12) = { ... }`.

<img align="right" width="500" alt="image" src="https://github.com/user-attachments/assets/c74bf2e4-aa22-4ddf-b779-5a4b2772a34f" />

**Multiple iterators** iterate as nested loops over the cartesian product. First-declared = outermost (changes slowest); last-declared = innermost (changes fastest). Iterator bounds are evaluated once up-front, so inner iterators cannot depend on outer iterator values.

`tableGraph` renders the rows as an SVG line graph instead of a column table. Column 0 is the X-axis; remaining columns are Y series (one line each). With multiple iterators, grouping is opt-in: an inner iterator becomes a line-grouping variable only if it has a `iter->` output column. The column's label (e.g. `Y` in `Y y->`) is used in the legend (`Y = 1.0`). Hover a graph to get a crosshair and an `(x, y)` coordinate readout at the pointer.

```
tableGraph("z = x^y") = {
  z = x**y
  x: 1..2..0.1
  y: 1..2..0.1
  X x->
  Y y->
  Z z->
}
```

<img align="right" width="500" alt="image" src="https://github.com/user-attachments/assets/6de14e36-457c-4362-b485-f17b2e5c0a5c" />

**Vector Diagrams:**

```
Ground track
smg: 9.538
cmg °: 0°

Boat through water
speed: 10
cts °: 342.54°

Current
drift: 3
set °: 90°

vectorDraw("v Course visualization"; navigation) = {
  0 °->
  0 ->
  "Course to steer" cts °->
  "Boat speed" speed->

  0 °->
  0 ->
  "Course made good" cmg °->
  "Speed made good" smg->

  cts °->
  speed ->
  "Current Set" set °->
  "Drift" drift->
}
```

The second argument is the coordinate **type** (required): `navigation` (0° = up, +° clockwise — bearings), `polar` (0° = right, +° counter-clockwise — math), or `cartesian` (raw `x, y`, no angle handling). For navigation/polar each pair is `(direction, magnitude)`; for cartesian each pair is `(x, y)`. An optional font size goes third: `vectorDraw("Title"; polar; 12)`.

Each vector is defined by four outputs: a start pair (absolute position from the origin) and an end pair. Labels on the end pair identify the vector in the legend. Direction columns respect the record's degrees/radians mode; legend values use the record's places, strip zeros, and group digits settings.

When a table, grid, or vector diagram doesn't fully solve, its title shows `(n/m solved)` to indicate partial results.

### Keyboard Shortcuts

- `Ctrl+Enter` or `Ctrl+S` — Solve current record
- `Ctrl+Shift+Enter` — Solve and append a `--- Table Outputs ---` text section
- `Ctrl+Shift+S` — Clear inputs and outputs
- `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) — Undo / Redo (also undoes Solves)
- `Tab` / `Shift+Tab` (formulas) — Indent / outdent 2 spaces
- `Ctrl+/` (formulas) — Toggle line comment
- `Tab` / `Shift+Tab` (vars panel) — Cycle through variable inputs
- `Enter` (vars panel) — Commit edit and Solve
- `Escape` — Revert edited variable value, unfocus formulas, or close modals

Solve button modifiers: **Shift+click** appends table outputs; **Ctrl+click** appends a `--- Solve Trace ---` section showing the solver's steps.

## Example: Loan Calculator

Here's a walkthrough using the built-in TVM (Time Value of Money) example:

```
"Loan calculator"

--Functions--
pmt(pv; rate; n; fv) = -(pv + fv / (1 + rate)**n) * rate / (1 - (1 + rate)**-n)

--Equations--
pmt = pmt(pv; rate/12; years*12; fv)

--Variables--
   pv $<- $100,000     "present value (loan or annuity)"
   fv $<- $0           "future value (balloon payment)"
 rate %<- 6.125%       "annual interest rate %"
years <- 30            "number of years"
  pmt $<-              "monthly payment"
```

**How it works:**

1. `--Functions--` and `--Equations--` are visual labels; only `--Variables--` is a real section marker (controls what shows in the variables panel)
2. The function definition is reusable from anywhere below it
3. The equation ties the function to the variables MathPad will solve for
4. The variables section lists inputs and outputs — `$` formats as money, `%` as percent, `@d` as date, `@t` as duration
5. The `<-` marker means input variables (editable in the variables panel)
6. **Comments** in double quotes describe each variable

**Try it:**

1. Copy the Loan Calculator text and paste it into a new MathPad record
2. Click **Solve** — MathPad calculates `pmt: -$607.61` (monthly payment; negative because cash flows out)
3. Change `pv` to `$250,000` and click the ⟲ icon next to `pmt` — it clears `pmt` and re-solves with the new principal
4. To solve backwards, set `pmt: -$2,000` and click ⟲ next to `pv` — MathPad finds the loan amount that produces that payment

Each editable variable has a ⟲ icon that clears it and solves, making it easy to compute any variable from the others. MathPad automatically detects the unknown and solves using root-finding.

## Differences from PalmOS MathPad 1.5

**New in the web app:**

- **Simultaneous equation solving** — the original solved one unknown at a time; the web app uses recursive backtracking with algebraic substitution and component partitioning to handle linked systems
- **Tables, grids, and vector diagrams** with per-cell solving (`table`, `grid`, `tableGraph`, `vectorDraw`)
- **Variables panel** with structured display, equation balance highlighting (green/orange/red), and inline editing
- **Format suffixes** — `$` (money), `%` (percent), `°` (mode-aware degrees), `@d` (date), `@t` (duration); plus `°=` for mod-aware equality
- **Extended limits** — `[lo:hi:step]`, expression bounds, auto-swap, mod-aware wraparound for angular vars
- **Pre-solve access** — `x~` (value before this solve) and `x~?` (existence check)
- **New markers** — `<<-` (full-precision input), `:>` and `:>>` (persistent outputs)
- **Undo/redo, multiple tabs, dark/light themes**

**Behavior changes that affect imported PalmOS records:**

- **`Now`, `Date(...)`, `Days(...)` have changed semantics.** Web `Now` is Unix seconds (since 1970); original was days since 1904. `Date(y;m;d;h;min;s)` is now a constructor; `Days(d1;d2)` is now a date-difference. Records that did arithmetic on these will produce different numbers.
- **Trig units are now per-record.** The original was always radians (use `Degrees()`/`Radians()` to convert). The web app has a per-record `degreesMode` toggle that changes Sin/Cos/Tan interpretation directly.
- **`{…}` is now also used for table/grid bodies.** Multi-line equations wrapped in `{…}` still parse the same, but the brace syntax is now overloaded.

**Dropped from the original:**

- Builtins `JDays`, `JDate`, `HMS`
- Confirmation breakpoint suffix `?:` (the dialog that paused after solving)
- Write-protected regions `/* … */`
- Page-position markers `--Input--` / `--Output--` (the web app's `--Variables--` is unrelated)
- Inline `\expr\` substitution outside of table/grid titles
- IR beaming and the Private record flag

## Technical Details

- Pure client-side JavaScript — no build system, no frameworks, no server
- ~18,000 lines of JS across 13 modules
- Brent's root-finding algorithm with adaptive bracketing, known-scale heuristics, and singularity/pole rejection
- Recursive backtracking solver with deterministic-advance phases (direct-eval, substitution building, sweep subs) and three kinds of branching candidates (direct-eval alternates, sweep-0 natural 1-unknown, sweep-1 subset-enumerated substitution combos); falls back to most-progressed snapshot when no balanced branch found
- Equation-graph partitioning into independent components (union-find over shared vars, limit refs, body-def refs) to avoid cartesian-product blow-up on disjoint sub-systems
- Multi-sub symmetric substitution derivation; cycle-safe recursive substitution via visited-set guard
- Token-based parser with AST generation for expression evaluation
- Auto-saves to localStorage with 500ms debounce
- Mobile responsive with touch-friendly controls
- Works offline — no server required

## License

MIT License. See [LICENSE](LICENSE) for details.
