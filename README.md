# MathPad

An algebraic equation solver with automatic unknown detection, root-finding, and Google Drive sync.

## About
<img width="163" height="163" alt="image" src="https://github.com/user-attachments/assets/77817643-bd90-4c19-9ec7-9f2654016c79" />

MathPad was originally created by **Rick Huebner** for PalmOS PDAs (circa 1997-2000). This repository contains:
- A modern web-based reimplementation with full feature parity and cloud sync
- The original MathPad 1.5 release (documentation, PRC files, and desktop utilities)

## Web Application

**Try it online: https://wpwoodjr.github.io/MathPad/**

Or open `docs/index.html` locally in a browser. No build step required.

### Core Features

- **Automatic Equation Solving** — detects unknown variables and solves using Brent's root-finding method. Solve forward or backward: give it any combination of knowns and unknowns
- **50+ Built-in Functions** — math, trig (degrees/radians), date/time, financial, and control flow
- **User-defined Functions** — define functions like `f(x;y) = expr` in any record, or in the "Functions" record to make them available globally
- **Global Constants** — define constants in a "Constants" record, available to all other records
- **Google Drive Sync** — sign in with Google to sync records across devices with automatic conflict detection
- **Tables and Grids** — iterate variables over ranges to produce columnar tables or 2D grids, with per-cell equation solving
- **Vector Diagrams** — `vectorDraw` renders SVG polar vector diagrams with bearing convention, legend, and per-vector solving
- **Import/Export** — compatible with original PalmOS MathPad export format

### Editor

- **Syntax-highlighted editor** with line numbers and real-time token coloring
- **Variables panel** — structured view of all variables with editable inputs, equation balance highlighting (green/orange/red), and flash animation on value changes
- **Undo/redo** — full undo history with Ctrl+Z / Ctrl+Y, restores solve results, status, and per-state modification time. Tab indent / Shift+Tab outdent / Ctrl+/ comment toggle, all undoable.
- **Created/Modified tracking** — record creation and last-edit timestamps shown in the details panel. Modified updates only on direct typing (not solve, clear, or vars panel input).
- **Split-pane layout** — resizable variables panel above the formulas editor
- **Resizable sidebar** — drag to adjust sidebar width, persisted across sessions
- **Multiple tabs** — work on several records simultaneously
- **Dark/light theme** — auto-detects system preference, toggle with one click

### Number Formatting

- Configurable decimal places, trailing zero stripping, comma grouping
- Scientific and engineering notation
- **Money format** (`price$:`) — displays as `$1,234.56`. Configurable currency symbol per record (`$`, `€`, `£`, `¥`, `₹`, `₩`, `₱`, `₺`, `₴`, `₫`, `₡`, `₽`, `₸`, `₼`, `₾`, `৳`); suffix currencies show the symbol after the number.
- **Percent format** (`rate%:`) — stores as decimal, displays with `%`
- **Angular format** (`angle°:`) — mode-aware: degrees mode displays mod 360 with `°` suffix; radians mode displays mod 2π with no symbol
- **Date/duration formats** (`@d`, `@t`) — locale-aware date display, H:MM:SS duration display
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
| `cmg[a:b]°:` | Angular limits — mod-aware wraparound (e.g. `[327.8:5.5]` = arc through 0°) |
| `x~` | Pre-solve value (value before this solve started) |
| `x~?` | 1 if variable has a pre-solve value, 0 otherwise |

### Equations

An equation is any line with `=` between two expressions. If all variables have values, MathPad checks that both sides balance. If there's an unknown, it solves using Brent's root-finding method.

| Syntax | Behavior |
|--------|----------|
| `a = b` | Standard equation — balance check or solve for unknown |
| `a °= b` | Degree equality — compares mod 360 (or mod 2π in radians mode), so `359.99 °= 0.01` balances |

The `°=` operator also works as a logical comparison in expressions, returning 1 (true) or 0 (false):

```
if(heading °= targetHeading; "on course"; "off course")
```

### Algebraic Substitution

When a system has multiple unknowns, the solver derives algebraic substitutions to reduce equations to a single unknown for Brent's root-finding. Derivation is **symmetric** — both LHS-with-RHS-as-target and RHS-with-LHS-as-target are explored, so `x = z/2` yields both `x → z/2` and `z → 2*x`. The recursive backtracker enumerates subset-sized combinations (size 0, 1, …, N) to prefer smaller combos that leave more variables free for Brent's.

The following forms are recognized (where `B`, `C`, `D` are arbitrary expressions not containing the target variable):

**Direct extraction** — variable is a top-level operand:

| Form | Substitution |
|------|-------------|
| `var + B = D` | `var = D - B` |
| `var * B = D` | `var = D / B` |
| `var / B = D` | `var = D * B` |
| `B / var = D` | `var = B / D` |
| `var ** B = D` | `var = D ** (1/B)` |

**Extraction from sum/difference** — variable is inside a product or quotient within a sum:

| Form | Substitution |
|------|-------------|
| `var * B + C = D` | `var = (D - C) / B` |
| `var / B + C = D` | `var = (D - C) * B` |
| `B / var + C = D` | `var = B / (D - C)` |

Subtraction (`-`), commuted forms (`C + var * B`), and swapped sides (`D = var * B + C`) all work. Substitutions chain across equations in the system.

### Tables, Grids, and Vector Diagrams

Use `table` for columnar output, `grid` for 2D cell grids, and `vectorDraw` for polar vector diagrams:

```
table("Distance vs Time") = {
  distance = speed * time
  speed: 60
  time<- 1..5
  time->
  distance->
}

grid("Multiplication") = {
  z = x * y
  z<-
  x<- 1..5
  y<- 1..5
  x->
  y->
  z->
}
```

**Body declarations:**
- `x<- 0..10` or `x: 0..10..2` — iterator (range with optional step)
- `z<-` or `z:` — unknown for equation solving (bare, no value)
- `v: 10` — definition (expression value)
- `Label z->` — output column with optional label

Tables inherit outer equations when the body has none; body equations override if any are present. Tables also inherit all outer values, however a value may be overridden by a declaration in the table.  Each row/cell is solved independently. Optional font size: `table("Title"; 12) = { ... }`.

**Vector Diagrams:**

```
vectorDraw("Wind Triangle") = {
  "equations..."
  tc °->            "start direction (bearing)"
  start_mag ->      "start magnitude"
  Label end_dir °-> "end direction, labels vector in legend"
  end_mag ->        "end magnitude (relative displacement)"
}
```

Each vector is defined by four outputs: start direction (`°->`) and magnitude (`->`) give the absolute polar position from the origin; end direction (`°->`) and magnitude (`->`) give the relative displacement. Labels on the end pair identify the vector in the legend. Uses bearing convention (north up, clockwise), respects degrees/radians mode, and formats legend values using the record's places, strip zeros, and group digits settings.

When a table, grid, or vector diagram doesn't fully solve, its title shows `(n/m solved)` to indicate partial results.

### Keyboard Shortcuts

- `Ctrl+Enter` — Solve current record
- `Ctrl+Z` — Undo
- `Ctrl+Y` or `Ctrl+Shift+Z` — Redo
- `Tab` / `Shift+Tab` — Cycle through variable inputs
- `Escape` — Revert edited variable value

## Example: Loan Calculator

Here's a walkthrough using the built-in TVM (Time Value of Money) example:

```
"Loan calculator"

--Formulas--
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

1. **Formulas** section defines a reusable payment function `pmt(pv; rate; n; fv)`
2. **Equations** section ties the function to the variables
3. **Variables** section lists inputs and outputs — `$` formats as money, `%` as percent, `@d` as date, `@t` as duration
4. The `<-` marker means input variables (editable in the variables panel)
5. **Comments** in double quotes describe each variable

**Try it:**

1. Click **Solve** — MathPad calculates `pmt: $607.94` (monthly payment)
2. Change `pv` to `$250,000` and click the ⟲ icon next to `pmt` — it clears `pmt` and solves, giving `pmt: $1,519.84`
3. To solve backwards, set `pmt: $2,000` and click ⟲ next to `pv` — MathPad finds `pv: $328,903.63`

Each variable has a ⟲ icon that clears it and solves, making it easy to compute any variable from the others. MathPad automatically detects the unknown and solves using root-finding.

## Technical Details

- Pure client-side JavaScript — no build system, no frameworks, no server
- ~12,300 lines of JS across 13 modules
- Brent's root-finding algorithm with adaptive bracketing, known-scale heuristics, and singularity/pole rejection
- Recursive backtracking solver with deterministic-advance phases (direct-eval, substitution building, sweep subs) and three kinds of branching candidates (direct-eval alternates, sweep-0 natural 1-unknown, sweep-1 subset-enumerated substitution combos)
- Multi-sub symmetric substitution derivation; cycle-safe recursive substitution via visited-set guard
- Token-based parser with AST generation for expression evaluation
- Auto-saves to localStorage with 500ms debounce; Google Drive sync every 15 seconds
- Mobile responsive with touch-friendly controls
- Works offline — Drive sync is optional and degrades gracefully

## License

MIT License. See [LICENSE](LICENSE) for details.
