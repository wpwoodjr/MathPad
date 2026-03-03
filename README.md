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
- **User-defined Functions** — create custom functions like `f(x;y) = expr` in a special "Functions" record
- **Global Constants** — define constants in a "Constants" record, available to all other records
- **Google Drive Sync** — sign in with Google to sync records across devices with automatic conflict detection
- **Import/Export** — compatible with original PalmOS MathPad export format

### Editor

- **Syntax-highlighted editor** with line numbers and real-time token coloring
- **Variables panel** — structured view of all variables with editable inputs, equation balance highlighting (green/orange/red), and flash animation on value changes
- **Undo/redo** — full undo history with Ctrl+Z / Ctrl+Y, restores solve results and status
- **Split-pane layout** — resizable variables panel above the formulas editor
- **Multiple tabs** — work on several records simultaneously
- **Dark/light theme** — auto-detects system preference, toggle with one click

### Number Formatting

- Configurable decimal places, trailing zero stripping, comma grouping
- Scientific and engineering notation
- **Money format** (`price$:`) — displays as `$1,234.56`
- **Percent format** (`rate%:`) — stores as decimal, displays with `%`
- **Numeric bases** (`hex#16:`) — bases 2 through 36
- **Inline evaluation** (`\expr\`) — evaluates expression and substitutes result in text

### Variable Types

| Syntax | Behavior |
|--------|----------|
| `var: value` | Persistent variable |
| `var<- value` | Input — cleared by Clear button |
| `var<<- value` | Input — full precision, cleared by Clear |
| `var:: value` | Full precision, persistent |
| `var->` | Output — cleared and recomputed on Solve |
| `var->>` | Output — full precision |
| `var=>` | Persistent output — recomputed on Solve, kept on Clear |
| `var=>>` | Persistent output — full precision |
| `var[lo:hi]:` | Constrain search range for root-finding |
| `x~` | Use pre-solve (stale) value if current unavailable |
| `x?` | 1 if variable has a value, 0 otherwise |

### Algebraic Substitution

When a system has multiple unknowns, the solver derives algebraic substitutions to reduce equations to a single unknown for Brent's root-finding. The following forms are recognized (where `B`, `C`, `D` are arbitrary expressions not containing the target variable):

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
3. **Variables** section lists inputs and outputs — `$` suffix formats as money, `%` as percent
4. The `<-` marker means input variables (editable in the variables panel)
5. **Comments** in double quotes describe each variable

**Try it:**

1. Click **Solve** — MathPad calculates `pmt: $607.94` (monthly payment)
2. Change `pv` to `$250,000` and click the ⟲ icon next to `pmt` — it clears `pmt` and solves, giving `pmt: $1,519.84`
3. To solve backwards, set `pmt: $2,000` and click ⟲ next to `pv` — MathPad finds `pv: $328,903.63`

Each variable has a ⟲ icon that clears it and solves, making it easy to compute any variable from the others. MathPad automatically detects the unknown and solves using root-finding.

## Technical Details

- Pure client-side JavaScript — no build system, no frameworks, no server
- ~11,000 lines of JS across 14 modules
- Brent's root-finding algorithm with adaptive bracketing and known-scale heuristics
- Token-based parser with AST generation for expression evaluation
- Auto-saves to localStorage with 500ms debounce; Google Drive sync every 15 seconds
- Mobile responsive with touch-friendly controls
- Works offline — Drive sync is optional and degrades gracefully

## License

MIT License. See [LICENSE](LICENSE) for details.
