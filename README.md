# MathPad

An algebraic equation solver with automatic unknown detection and root-finding.

## About

MathPad was originally created by **Rick Huebner** for PalmOS PDAs (circa 1997-2000). The original code is public domain.

This repository contains:
- The original MathPad 1.5 PalmOS application and desktop utilities
- A modern web-based reimplementation with the same functionality

## Web Application

**Try it online: https://wpwoodjr.github.io/MathPad/**

Or open `docs/index.html` locally in a browser.

### Features

- **Equation Solving**: Automatically detects unknown variables and solves using Brent's root-finding method
- **Variable Types**:
  - `var:` - Standard variable
  - `var<-` - Input variable (cleared on load)
  - `var->` - Output variable (cleared on solve)
  - `var::` or `var->>` - Full precision output
  - `var[low:high]:` - Variable with search limits
- **Built-in Functions**: Math, trig, date/time, and control flow functions
- **User-defined Functions**: Create custom functions in a special "Functions" record
- **Constants**: Define constants in a special "Constants" record available to all records
- **Import/Export**: Compatible with original MathPad export format
- **localStorage**: Auto-saves all changes

### Keyboard Shortcuts

- `Ctrl+Enter` - Solve current record

## Example: Mortgage Calculator

Here's a walkthrough using the built-in TVM (Time Value of Money) example:

```
"Monthly interest rate from annual"
mint = yint / 100 / 12

"Payment calculation"
pmt = pv * mint / (1 - (1 + mint)**-n)

"Variables"
pmt->                   "monthly payment (output)"
pv: 100000              "loan amount"
yint: 7.5               "annual interest rate %"
n: 360                  "number of payments (30 years)"
mint->>                 "monthly interest rate (full precision)"
```

**How it works:**

1. **Equations** define relationships between variables (`mint = yint / 100 / 12`)
2. **Input variables** have values you provide (`pv: 100000`)
3. **Output variables** (`pmt->`) are cleared and recalculated when you click Solve
4. **Full precision outputs** (`mint->>`) show all decimal places

**Try it:**

1. Click **Solve** — MathPad calculates `pmt-> 699.21` (monthly payment)
2. Change `pv: 250000` and click **Solve** — now `pmt-> 1748.04`
3. Clear `pv:` and set `pmt: 2000` — MathPad solves backwards to find `pv-> 285770.56`

MathPad automatically detects which variable is unknown and solves for it using root-finding

## License

The original MathPad code by Rick Huebner is public domain. The web reimplementation follows the same licensing.
