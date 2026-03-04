# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MathPad is an algebraic equation solver web application, reimplemented from the original PalmOS app (1997-2000) by Rick Huebner. It solves systems of equations using Brent's root-finding method, supports 50+ built-in functions, and syncs to Google Drive.

- **Web Application** (`docs/`) - Full-featured browser-based app, no build system
- **Legacy PalmOS** (`mathpad 1.5/`) - Original C source and utilities
- **Live site**: https://wpwoodjr.github.io/MathPad/

## Running and Testing

```bash
# Open directly in browser (no build step)
open docs/index.html

# Check JavaScript syntax
node --check docs/js/ui.js
node --check docs/js/drive.js
# etc.

# Run solver tests (17 tests)
node tests/run-tests.js

# Run syntax highlighting tests (117 tests)
node tests/run-highlighting-tests.js

# Generate expected test output
node tests/gen-expected.js TESTNAME
```

## Application Features

### UI Layout
- **Header**: Hamburger menu, title, action buttons (Solve, Clear, Undo ↶, Redo ↷), Drive controls, theme toggle, help (?), settings (⚙)
- **Sidebar**: Collapsible category groups with record list; special records (Constants ★, Functions ★) at top; Import/Export/Reset and Help/Theme buttons at bottom
- **Editor area**: Tab bar for multiple open records; split-pane with variables panel (top, resizable) and formulas editor (bottom) with syntax highlighting
- **Details panel**: Record settings (category, decimal places, format, strip zeros, group digits, degrees mode)
- **Status bar**: Left shows per-record status; right shows Drive sync info (hidden below 768px, flashes on small screens)
- **Mobile responsive**: Hamburger sidebar at 768px, icons move to sidebar at 560px, compact layout at 480px

### Editor
- Syntax-highlighted formulas editor with line numbers
- Undo/redo stack with metadata caching (errors, highlights, status restored on undo)
- Stack-top-is-current model: `setValue(text, undoable)` pushes or mutates top
- Global Ctrl+Z / Ctrl+Y keybindings routed to active editor

### Variables Panel
- Displays parsed variable declarations with editable value inputs
- Row types: declaration (name + input), expression output (label + readonly value), label (plain text), spacer
- `--Variables--` marker: only lines below it appear in the panel
- Equation variable highlighting: green (balanced), orange (unbalanced), red (error)
- Tab cycles through inputs; Escape reverts; flash animation on value changes
- Column-preserved comment spacing

### Solving
- **Solve button** or Ctrl+Enter triggers `solveRecord()` in solve-engine.js
- Pipeline: discover variables → evaluate inline expressions (`\expr\`) → evaluate definitions → build substitutions → solve equations with Brent's method → format output
- Iterative refinement: multiple passes until convergence
- **Two-sweep equation solving**: Pass 2 first tries equations with 1 natural unknown (no substitutions), then equations that need substitutions — prevents degenerate equations from related substitutions
- **Break-on-solve**: After Brent's solves one equation, restarts so definitions can evaluate with the new value before a second Brent's step picks an inconsistent root
- Results inserted back into text preserving comments and formatting
- Error reporting with line numbers shown in status bar

### Number Formatting
- Decimal places, strip trailing zeros, comma grouping, scientific/engineering notation
- `$` suffix → money format ($1,234.56, always 2 decimals)
- `%` suffix → percent format (×100, follows record's places setting)
- `°` suffix → degrees format (mod 360, follows record's places setting)
- Base notation: `#16` for hex, `#2` for binary, etc. (bases 2-36)
- Custom `toFixed()` avoids IEEE 754 midpoint rounding errors

### Special Records
- **"Constants"** — variables available to all records
- **"Functions"** — user-defined functions: `f(x;y) = expr`
- **"Default Settings"** — template for new record settings

### Import/Export
- PalmOS-compatible text format with `~~~~~~~~~~~~~~~~~~~~~~~~~~~` record separator
- Import: `.txt` files or `.pdb` PalmOS database files
- Export: all records to text format

### Google Drive Integration
- OAuth via Google Identity Services (GIS); `drive.file` scope
- Files saved in "MathPad" folder on Drive root
- 15-second sync cycle: checks md5Checksum for conflicts, prompts user if Drive has newer data
- Dirty flag tracking with `localOnly` parameter to avoid spurious syncing
- Token persistence across refreshes; 5-second timeout for blocked popups
- Graceful degradation if Google scripts fail to load

## Architecture

### Module Dependency Graph

```
app.js (entry point, ~260 lines)
  ↓
ui.js (main orchestration, ~1700 lines)
  ├→ storage.js (localStorage, import/export, ~900 lines)
  ├→ drive.js (Google Drive sync, ~970 lines)
  ├→ editor.js (syntax highlighting editor, ~1300 lines)
  ├→ variables-panel.js (structured variable display, ~720 lines)
  ├→ solve-engine.js (solving orchestration, ~610 lines)
  │     ├→ solver.js (Brent's algorithm, ~800 lines)
  │     ├→ evaluator.js (expression eval, 50+ builtins, ~770 lines)
  │     └→ variables.js (variable parsing, ~1100 lines)
  ├→ parser.js (tokenizer & AST, ~1030 lines)
  ├→ line-parser.js (token-based line parsing, ~710 lines)
  └→ theme.js (light/dark toggle, ~110 lines)
```

Script load order in `index.html`: parser → line-parser → evaluator → solver → variables → storage → drive → editor → variables-panel → solve-engine → ui → app

All modules use global scope (no ES modules, no build system). Test files use `require()` for Node.js compatibility.

### Key Modules

| File | Purpose |
|------|---------|
| `ui.js` | UI state, event handling, record management, sidebar/tabs/details rendering |
| `solve-engine.js` | `solveRecord()` main entry, equation solving orchestration, output formatting |
| `solver.js` | Brent's root-finding algorithm, equation detection, substitution derivation (`deriveSubstitution`, `tryExtractFromSum`) |
| `evaluator.js` | Expression evaluation, 50+ built-in functions, `formatNumber()`, `checkBalance()` |
| `variables.js` | Variable declaration parsing, `parseAllVariables()`, `setVariableValue()`, `buildOutputLine()` |
| `parser.js` | Tokenizer (tokens have `.ws` whitespace, `.raw` error text), AST generation, `VarType`/`ClearBehavior` enums |
| `line-parser.js` | Token-based line parser for declarations and expression outputs, `LineParser`, `tokensToText()` |
| `storage.js` | localStorage persistence, `debouncedSave()`, `cancelPendingSave()`, import/export |
| `drive.js` | Google Drive auth (GIS), file CRUD, sync cycle, conflict detection, `DriveState` |
| `editor.js` | `SimpleEditor` class with syntax highlighting, undo/redo stack, `tokenizeMathPad()` |
| `variables-panel.js` | `VariablesPanel` class, structured variable display, value editing, equation highlights |
| `theme.js` | Light/dark theme detection, toggle, persistence (IIFE, ES2015-safe) |

### Data Structures

**Record** (stored in localStorage):
```javascript
{
  id: number, title: string, text: string, category: string,
  places: number,          // decimal precision (default 2)
  stripZeros: boolean, groupDigits: boolean,
  format: 'float' | 'sci' | 'eng',
  degreesMode: boolean,    // false = radians
  shadowConstants: boolean // output markers shadow reference constants
}
```

**Variable Declaration** (from `LineParser.parse()`):
```javascript
{
  kind: 'declaration' | 'expression-output',
  name: string, exprTokens: Token[],
  type: VarType,              // INPUT or OUTPUT
  clearBehavior: ClearBehavior, // NONE, ON_CLEAR, ON_SOLVE, ON_SOLVE_ONLY
  valueTokens: Token[], limits: { lowTokens, highTokens },
  base: number, fullPrecision: boolean,
  format: 'money' | 'percent' | null,
  marker: ':' | '<-' | '<<-' | '->' | '->>' | '::' | '=>' | '=>>',
  markerEndCol: number, comment: string | null, commentUnquoted: boolean,
  label: string              // prefix text before variable name
}
```

**DriveState** (in `drive.js`):
```javascript
{
  tokenClient, accessToken, tokenExpiry, silentRenewalFailed,
  userEmail, fileId, fileName, folderId,
  lastModifiedTime, lastModifiedBy, lastChecksum, declinedRemoteTime,
  driveDirty, syncInProgress, syncTimer, statusInterval, ready
}
```

### Key Enums

**VarType** (`parser.js`): `INPUT` (`:`, `<-`, `<<-`, `::`), `OUTPUT` (`->`, `->>`, `=>`, `=>>`)

**ClearBehavior** (`parser.js`): `NONE` (`:`, `::`), `ON_CLEAR` (`<-`, `<<-`), `ON_SOLVE` (`->`, `->>`), `ON_SOLVE_ONLY` (`=>`, `=>>`)

**Marker precedence** (`line-parser.js`): `->>`, `=>>`, `<<-` (3) > `->`, `=>`, `<-` (2) > `::` (1) > `:` (0)

## Variable Syntax

| Pattern | Type | Behavior |
|---------|------|----------|
| `var: value` | INPUT | Persistent |
| `var<- value` | INPUT | Cleared on Clear button |
| `var<<- value` | INPUT | Full precision, cleared on Clear |
| `var:: value` | INPUT | Full precision, persistent |
| `var->` | OUTPUT | Cleared before solve |
| `var->>` | OUTPUT | Full precision, cleared before solve |
| `var=>` | OUTPUT | Persistent output (cleared before solve, NOT by Clear) |
| `var=>>` | OUTPUT | Persistent output, full precision |
| `var[lo:hi]:` | With limits | Constrain Brent's search range |
| `price$:` | Money format | `$` before marker = money format |
| `rate%: 7.5%` | Percentage | `%` before marker = percent (stored as 0.075) |
| `angle°: 400°` | Degrees | `°` before marker = degrees format (mod 360, `400°` literal → 40) |
| `expr$->` | Expression output | Format expression result as money |
| `x~` | Stale access | Use pre-solve value if current unavailable |
| `x?` | Existence check | 1 if x has value, 0 otherwise |
| `\expr\` | Inline eval | Evaluates and replaces with result during solve |

## Built-in Functions

**Math**: Abs, Sign, Int, Frac, Round, Floor, Ceil, Mod, Sqrt, Cbrt, Root, Exp, Ln, Log, Fact, Pi, Rand

**Trig** (degrees/radians mode): Sin, ASin, SinH, ASinH, Cos, ACos, CosH, ACosH, Tan, ATan, TanH, ATanH, Radians, Degrees

**Date/Time**: Now, Days, JDays, Date, JDate, Year, Month, Day, Weekday, Hour, Minute, Second, Hours, HMS

**Control**: If(cond;then;else), Choose(n;v1;v2;...), Min, Max, Avg, Sum

**Other**: Pmt (financial), isClose (balance tolerance check)

## CSS Theming

- CSS custom properties for all colors, defined on `:root` (dark default) and `[data-theme="light"]`
- Syntax highlighting: `.tok-NUMBER`, `.tok-IDENTIFIER`, `.tok-STRING`, `.tok-KEYWORD`, `.tok-FUNCTION`, `.tok-BUILTIN`, `.tok-VARIABLE`, `.tok-VARIABLE_DEF`
- Variable states: `.has-solved` (green), `.has-unsolved` (orange), `.has-error` (red)
- Key sizing vars: `--header-height: 48px`, `--sidebar-width: 220px`, `--tab-height: 35px`
- Responsive breakpoints: 768px (sidebar collapses, Drive status hidden), 560px (help/theme to sidebar), 480px (compact)

## Google Drive Integration

### Sync Architecture
```
User types → debouncedSave(500ms) → localStorage + markDriveDirty()
                                          ↓
                             15-second timer checks flag
                                          ↓
                             if dirty → Drive REST API save → clear flag

App loads → localStorage (instant) → check Drive metadata
              ↓                           ↓
         render UI immediately      if Drive is newer → prompt user → swap data
```

### Key Patterns
- `DriveState` + `DRIVE_KEYS` for localStorage persistence across refreshes
- `fileId`/`fileName`/`folderId` use protective write pattern (never removed by `saveDriveState`, only by `driveSignOut`)
- `ensureToken()` is a pure auth helper with no UI side effects
- `driveSaveFile` uses bounded retry loop (max 2 attempts) for 401/404
- `applyDriveData(data)` is the consolidated load-from-Drive helper
- `cancelPendingSave()` clears debounce timer before `reloadUIWithData`

### Error Handling
- 401: clear token, `ensureToken()` retry, re-attempt once (save/load/metadata)
- 404 on save: file deleted → clear fileId, retry creates new file
- `flushDriveSync`: skips if `syncInProgress` (prevents concurrent saves)
- `driveSignOut`: async, awaits flush before revoking token

## Common Development Patterns

**Adding a built-in function**: Add to `builtins` object in `evaluator.js`

**Adding a variable type**:
1. Add to `VarType` enum in `parser.js`
2. Add marker token type and metadata in `parser.js` tokenizer
3. Handle in `line-parser.js` `LineParser` and `getMarkerString()`
4. Handle in `solveRecord()` if special behavior needed

**Modifying solving behavior**: Edit `solveRecord()` in `solve-engine.js`

**Algebraic substitution** (`deriveSubstitution` in `solver.js`): Derives substitutions to reduce multi-unknown equations to single-unknown for Brent's. Three cases:
- Cases 1/2: Variable is a direct top-level operand (`var OP expr = D`)
- Case 3 (`tryExtractFromSum`): Variable is inside a product/quotient within a sum/difference (`var * B + C = D`, `var / B + C = D`, `B / var + C = D`). Handles subtraction, commuted, and RHS-swapped forms.

**Debugging equations**: The solver logs substitutions and solving steps to console

## Legacy PalmOS Utilities

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
