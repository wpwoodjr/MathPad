# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MathPad is an algebraic equation solver with two components:
- **Modern Web Application** (`docs/`) - Browser-based reimplementation with full feature parity
- **Legacy PalmOS** (`mathpad 1.5/`) - Original 1997-2000 application by Rick Huebner

Live site: https://wpwoodjr.github.io/MathPad/

## Running the Web Application

No build system required. Open directly in a browser:

```bash
open docs/index.html
# or
firefox docs/index.html
```

To check JavaScript syntax:
```bash
node --check docs/js/ui.js
node --check docs/js/solver.js
# etc.
```

## Architecture

### Module Dependency Graph

```
app.js (entry point)
  ↓
ui.js (main orchestration, ~1300 lines)
  ├→ storage.js (localStorage persistence)
  ├→ editor.js (syntax highlighting)
  ├→ variables-panel.js (variable display)
  ├→ parser.js (tokenizer & AST)
  ├→ line-parser.js (token-based line parsing)
  └→ solver.js (equation solving)
        ├→ evaluator.js (expression evaluation)
        ├→ variables.js (variable parsing)
        ├→ line-parser.js
        └→ parser.js
```

Scripts load in order in `index.html`: parser → line-parser → evaluator → solver → variables → storage → editor → variables-panel → ui → app

### Key Modules

| File | Purpose |
|------|---------|
| `ui.js` | UI state, event handling, `solveRecord()` main solving loop |
| `solver.js` | Brent's root-finding algorithm, equation detection, substitution derivation |
| `evaluator.js` | Expression evaluation, 50+ built-in functions, `formatNumber()` |
| `variables.js` | Variable declaration parsing, `parseVariableLine()`, `setVariableValue()` |
| `parser.js` | Tokenizer (with `.ws` whitespace and `.raw` error text on tokens), AST generation |
| `line-parser.js` | Token-based line parser for variable declarations and expression outputs |
| `storage.js` | localStorage persistence, import/export to text format |
| `editor.js` | SimpleEditor class with syntax highlighting |

### Data Structures

**Record** (stored in localStorage):
```javascript
{
  id: number,
  title: string,
  text: string,           // MathPad source code
  category: string,
  places: number,         // decimal precision (default 2)
  stripZeros: boolean,
  groupDigits: boolean,
  format: 'float' | 'sci' | 'eng'
}
```

**Variable Declaration** (from `parseVariableLine` → `LineParser.parse()`):
```javascript
{
  kind: 'declaration' | 'expression-output',
  name: string,           // e.g., "pmt", "rate" (declarations only)
  exprTokens: Token[],    // expression tokens (expression outputs only)
  type: VarType,          // STANDARD, INPUT, OUTPUT
  clearBehavior: ClearBehavior, // NONE, ON_CLEAR, ON_SOLVE, ON_SOLVE_ONLY
  valueTokens: Token[],   // value tokens after marker
  limits: { lowTokens, highTokens }, // search limit tokens if specified
  base: number,           // numeric base (default 10)
  fullPrecision: boolean, // ->> or :: marker
  format: 'money' | 'percent' | null,
  marker: ':' | '<-' | '->' | '->>' | '::' | '=>' | '=>>',
  markerEndCol: number,   // 1-based column after marker (for value insertion)
  comment: string | null, // trailing quoted or unquoted comment
  commentUnquoted: boolean
}
```

### Solving Pipeline

```
User clicks Solve
  ↓
solveRecord() in ui.js
  ↓
parseAllVariables() → extract declarations
  ↓
Iterative loop:
  1. Evaluate inline expressions (\expr\)
  2. Evaluate definition equations (x = expr)
  3. Build substitution map for algebraic solving
  4. Apply substitutions to simplify equations
  5. Use Brent's method to solve remaining unknowns
  ↓
setVariableValue() → update text with results
  ↓
Save to localStorage
```

### Key Functions

**Solving** (`ui.js`):
- `solveRecord()` - Main solving loop with iterative refinement
- `getInlineEvalFormat()` - Determine number formatting for inline evals

**Equation Detection** (`solver.js`):
- `isDefinitionEquation(eq)` - Check if equation is `var = expr` form
- `deriveSubstitution(eq)` - Extract substitution from definition equation
- `detectUnknown(eq, context)` - Find unknown variable in equation
- `solveEquation()` - Brent's root-finding wrapper

**Variables** (`variables.js`):
- `parseVariableLine(line)` - Parse single variable declaration
- `parseAllVariables(text)` - Find all declarations in record
- `setVariableValue(text, name, value)` - Update variable value in text

**Evaluation** (`evaluator.js`):
- `EvalContext.evaluate(ast)` - Evaluate expression AST
- `formatNumber(value, options, varName)` - Format with $ or % suffix

## Variable Syntax

| Pattern | Type | Behavior |
|---------|------|----------|
| `var: value` | STANDARD | Persistent |
| `var<- value` | INPUT | Cleared on load |
| `var->` | OUTPUT | Cleared on solve |
| `var->>` | FULL_PRECISION | All decimals shown |
| `var:: value` | FULL_PRECISION | Full precision input |
| `var[low:high]:` | With limits | Constrain search range |
| `price$:` | Money format | `$`/`%` before marker = format specifier |
| `rate%: 7.5%` | Percentage | Stores as decimal (0.075) |
| `expr$->` | Expression output | Format result as money |
| `expr%->` | Expression output | Format result as percent |
| `var[lo:hi]%:` | Limits + format | Limits before format specifier |

## Special Records

- **"Constants"** - Variables available to all records
- **"Functions"** - User-defined functions: `f(x;y) = expr`

## Legacy PalmOS Utilities

Build the C utilities for import/export:

```bash
gcc -o mpexport "mathpad 1.5/MpExport.c"
gcc -o mpimport "mathpad 1.5/MpImport.c"
```

Text export format (compatible with web app import):
```
Category = "Finance"; Secret = 0
Places = 2; StripZeros = 1
equation text
~~~~~~~~~~~~~~~~~~~~~~~~~~~
```

## Common Development Patterns

**Adding a built-in function**: Add to `builtins` object in `evaluator.js`

**Adding a variable type**:
1. Add to `VarType` enum in `parser.js`
2. Add marker token type and metadata in `parser.js` tokenizer
3. Handle in `line-parser.js` `LineParser` and `getMarkerString()`
4. Handle in `solveRecord()` if special behavior needed

**Modifying solving behavior**: Edit `solveRecord()` in `ui.js` (iterative loop around line 700-1100)

**Debugging equations**: The solver logs substitutions and solving steps to console
