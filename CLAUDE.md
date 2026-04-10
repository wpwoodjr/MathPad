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

# Run solver tests (27 tests)
node tests/run-tests.js

# Run syntax highlighting tests (128 tests)
node tests/run-highlighting-tests.js

# Generate expected test output
node tests/gen-expected.js TESTNAME
```

## Application Features

### UI Layout
- **Header**: Hamburger menu, title, action buttons (Solve, Clear, Undo ↶, Redo ↷), Drive controls, theme toggle, help (?), settings (⚙)
- **Sidebar**: Collapsible category groups with record list; special records (Constants ★, Functions ★) at top; Import/Export/Reset and Help/Theme buttons at bottom; resizable width with drag divider (persistent); scrolls to current record on selection; resizable width with drag divider (persistent); scrolls to current record on selection
- **Editor area**: Tab bar for multiple open records; split-pane with variables panel (top, resizable) and formulas editor (bottom) with syntax highlighting
- **Details panel**: Record settings (category, decimal places, format, strip zeros, group digits, degrees mode)
- **Status bar**: Left shows per-record status; right shows Drive sync info (hidden below 768px, flashes on small screens)
- **Mobile responsive**: Hamburger sidebar at 768px, icons move to sidebar at 560px, cloud icon for Sign In at 480px, compact layout at 410px
- **Mobile keyboard**: Currently disabled (early return in VP resize handler) — browser handles keyboard natively. Infrastructure remains for panel-specific focusin guard, two-mode handling (small/tall screens), and `scrollIntoView`-based visual viewport reset. `_keyboardIsShowing` module-level flag guards divider save and window resize.

### Editor
- Syntax-highlighted formulas editor with line numbers
- Undo/redo stack with metadata caching (errors, highlights, status, modifiedAt restored on undo)
- Stack-top-is-current model: `setValue(text, undoable)` pushes or mutates top
- Global Ctrl+Z / Ctrl+Y keybindings routed to active editor
- Tab indent / Shift+Tab outdent / Ctrl+/ comment toggle, all undoable with cursor restoration
- `notifyChange(metadata, undoRedo, userInput, modifiedAt)` — listener receives `(value, metadata, undoRedo, userInput, modifiedAt)`. `userInput=true` only for direct typing/Tab/Ctrl+/ (not setValue).

### Variables Panel
- Displays parsed variable declarations with editable value inputs
- Output values use readonly `<input>` elements (selectable/copyable)
- Row types: declaration (name + input), expression output (label + readonly value), label (plain text), spacer
- `--Variables--` marker: only lines below it appear in the panel
- Variable name labels split into text + marker spans; names truncate with ellipsis on narrow panels while markers (`:`, `->`, etc.) stay visible
- Name widths re-aligned on window resize via `alignNameWidths()`
- Equation variable highlighting: green (balanced), orange (unbalanced), red (error)
- Tab cycles through inputs; Escape reverts; flash animation on value changes
- Column-preserved comment spacing

### Solving
- **Solve button** or Ctrl+Enter triggers `solveRecord()` in solve-engine.js
- Pipeline: discover variables → evaluate definitions → build substitutions → solve equations with Brent's method → format output
- Iterative refinement: multiple passes until convergence
- **Direct evaluation first**: Fully-known substitutions (definition or algebraically derived) are evaluated directly before Brent's — multiple subs per variable tried (alternates)
- **Two-sweep equation solving**: Sweep 0 tries natural 1-unknown equations (no subs), skipping variables in the sweep sub list; sweep 1 applies sweep subs to reduce unknowns
- **Sweep subs**: Variables with no value, no limits — declaring a variable (e.g. `adjTemp->>`) to peek doesn't change solve behavior
- **Break-on-solve**: After Brent's solves one equation, restarts so definitions can evaluate with the new value before a second Brent's step picks an inconsistent root
- **Always re-solve**: First pass skips tables; re-solve runs unconditionally and computes them. Re-solve also gives a second chance when the first solve filled in cleared variables but had balance errors. Same logic in `run-tests.js` and `gen-expected.js`.
- Results inserted back into text preserving comments and formatting
- Error reporting with line numbers shown in status bar

### Variable Limits
- **Auto-swap numeric**: `[50:0]` is treated as `[0:50]` — order doesn't matter. Brent's uses `Math.min/max`; substitution path swaps for non-angular vars.
- **Mod-aware wraparound for `°` variables**: `cmg[327.8:5.5]` is treated as the angular arc through 0°. Brent's shifts search range; substitution path uses mod-aware comparison and normalizes the value into the user's limit range. Modulus is 360 (degrees mode) or 2π (radians mode).
- **Limit deferral**: when a limit expression depends on a not-yet-solved variable, the solve attempt returns `{ solved: false, limitsDeferred: true }` instead of running unconstrained. The iterative loop retries on subsequent passes.
- **End-of-solve validation**: catches undefined references in limit expressions even when the variable has a value (which would otherwise bypass the per-attempt check).

### Tables and Grids
- **`table("Title") = { body }`** — columnar output iterating 1+ variables over a range
- **`grid("Title") = { body }`** — 2D cell grid iterating 2+ variables
- Body declarations: iterators (`x<- 0..10` or `x: 0..10..2`), unknowns (`z<-`), definitions (`v: 10`), outputs (`Label z->`)
- `..` range syntax (`DOT_DOT` token) for iterator bounds with optional step
- Tables/grids inherit outer equations when body has none; body equations override if present
- Each row/cell solved fresh using unified `solveEquations` pipeline
- Pre-solve context reset per row (user declarations only, no equation-computed intermediates)
- Per-cell error suppression (bad cells empty, good cells show values)
- Per-cell balance checking: equations containing unknowns verified after each solve
- Unused variable warnings with actual line numbers
- Grid axes: iterator declaration order (first = rows, second = columns)
- Grid outputs: declaration order (first = row headers, second = col headers, third = cell value)
- Grid header values computed from output variable after solving (enables formatted headers like `hours@t->`)
- Grid hover: row + column + header highlighting
- Collapsible titles; optional font size parameter: `table("Title"; 12) = { ... }`
- Table output text section (`"--- Table Outputs ---"`) appended for copy/export

### Number Formatting
- Decimal places, strip trailing zeros, comma grouping, scientific/engineering notation
- `$` suffix → money format ($1,234.56, always 2 decimals or `currencyPlaces[symbol]`). Configurable currency symbol per-record (`currencySymbol`); suffix currencies (`₽₸₼₾৳`) display the symbol after the number.
- `%` suffix → percent format (×100, follows record's places setting)
- `°` suffix → angular format (**mode-aware**): degrees mode displays mod 360 with `°` suffix; radians mode displays mod 2π without symbol. `formatDegrees(value, places, degreesMode)`.
- `@d` suffix → date format (locale-aware MM/DD/YYYY or DD/MM/YYYY); `@d->>` includes time
- `@t` suffix → duration format (H:MM:SS); `@t->>` includes fractional seconds
- `@d:` and `@t:` parse date/duration text as input values
- Base notation: `#16` for hex, `#2` for binary, etc. (bases 2-36)
- Custom `toFixed()` avoids IEEE 754 midpoint rounding errors

### Date/Time
- Dates stored as epoch seconds (seconds since Jan 1, 1970 UTC)
- Locale-aware formatting: detects date field order (mdy/dmy/ymd) and separator via `Intl.DateTimeFormat`
- Input parsing accepts any separator (`-`, `/`, `.`) regardless of locale
- Built-in functions: `Now`, `Date(y;m;d;h;min;s)`, `Days(d1;d2)`, `Year`, `Month`, `Day`, `Weekday`, `Hour`, `Minute`, `Second`, `Hours`, `TimePart`
- `TimePart(d)` returns seconds since midnight (local time) — use with `@t` to display time-of-day
- Constants: `secsPerHour` (3600), `secsPerDay` (86400)

### Special Records
- **"Constants"** — variables available to all records
- **"Functions"** — user-defined functions: `f(x;y) = expr`
- **"Default Settings"** — template for new record settings

### Import/Export
- PalmOS-compatible text format with `~~~~~~~~~~~~~~~~~~~~~~~~~~~` record separator
- Import: `.txt` export files
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
app.js (entry point, ~200 lines)
  ↓
ui.js (main orchestration, ~1830 lines)
  ├→ storage.js (localStorage, import/export, ~930 lines)
  ├→ drive.js (Google Drive sync, ~990 lines)
  ├→ editor.js (syntax highlighting editor, ~1310 lines)
  ├→ variables-panel.js (structured variable display, ~1010 lines)
  ├→ solve-engine.js (solving + table/grid eval, ~1210 lines)
  │     ├→ solver.js (Brent's algorithm, ~790 lines)
  │     ├→ evaluator.js (expression eval, 50+ builtins, ~870 lines)
  │     └→ variables.js (variable parsing + table detection, ~1280 lines)
  ├→ parser.js (tokenizer & AST, ~1050 lines)
  ├→ line-parser.js (token-based line parsing, ~710 lines)
  └→ theme.js (light/dark toggle, ~110 lines)
```

Script load order in `index.html`: parser → line-parser → evaluator → solver → variables → storage → drive → editor → variables-panel → solve-engine → ui → app

All modules use global scope (no ES modules, no build system). Test files use `require()` for Node.js compatibility.

### Key Modules

| File | Purpose |
|------|---------|
| `ui.js` | UI state, event handling, record management, sidebar/tabs/details rendering |
| `solve-engine.js` | `solveRecord()` main entry, equation solving orchestration, output formatting, table/grid evaluation (`evaluateTable`) |
| `solver.js` | Brent's root-finding algorithm, equation detection, substitution derivation (`deriveSubstitution`, `tryIsolateVariable`) |
| `evaluator.js` | Expression evaluation, 50+ built-in functions, `formatNumber()`, `checkBalance()` |
| `variables.js` | Variable declaration parsing, `parseAllVariables()`, `setVariableValue()`, `buildOutputLine()`, `findTableDefinitions()` |
| `parser.js` | Tokenizer (tokens have `.ws` whitespace, `.raw` error text), AST generation, `VarType`/`ClearBehavior` enums |
| `line-parser.js` | Token-based line parser for declarations and expression outputs, `LineParser`, `tokensToText()` |
| `storage.js` | localStorage persistence, `debouncedSave()`, `cancelPendingSave()`, import/export |
| `drive.js` | Google Drive auth (GIS), file CRUD, sync cycle, conflict detection, `DriveState` |
| `editor.js` | `SimpleEditor` class with syntax highlighting, undo/redo stack, `tokenizeMathPad()` |
| `variables-panel.js` | `VariablesPanel` class, structured variable display, value editing, equation highlights, table/grid rendering |
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
  shadowConstants: boolean,// output markers shadow reference constants
  currencySymbol: string,  // currency symbol for $ format (default '$')
  created: number | null,  // Unix ms; sentinel default for legacy records
  modified: number | null  // Unix ms; null until first textarea edit
}
```

**Created/Modified tracking** (shown in details panel):
- `created` is set on `createRecord` and duplication; backfilled from sentinel `Date.UTC(2026, 3, 1, 3, 14, 15, 926)` (April 1, 2026 03:14:15.926 UTC) for legacy records via `backfillRecordTimestamps()` in `loadData`/`reloadUIWithData`/`handleImport`
- `modified` updates only on **direct user input to the textarea** (typing, Tab, Ctrl+/) — driven by `userInput` arg in `notifyChange`. Solve, clear, vars panel input, and other programmatic changes do NOT update it.
- **Per-undo-state `modifiedAt`**: each undo state stores the modified time at push time. Editor tracks `lastUserEditAt`; programmatic pushes inherit unchanged. Undo/redo restores `record.modified` from the popped state, so undoing across a solve preserves the user's actual last-edit time.
- New records and duplicates start with `modified = null` (displays as "—")
- Persisted to localStorage and Drive via JSON; export/import as `Created = "ISO8601"; Modified = "ISO8601"` line

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
  marker: ':' | '<-' | '<<-' | '->' | '->>' | '::' | ':>' | ':>>',
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

**VarType** (`parser.js`): `INPUT` (`:`, `<-`, `<<-`, `::`), `OUTPUT` (`->`, `->>`, `:>`, `:>>`)

**ClearBehavior** (`parser.js`): `NONE` (`:`, `::`), `ON_CLEAR` (`<-`, `<<-`), `ON_SOLVE` (`->`, `->>`), `ON_SOLVE_ONLY` (`:>`, `:>>`)

**Marker precedence** (`line-parser.js`): `->>`, `:>>`, `<<-` (3) > `->`, `:>`, `<-` (2) > `::` (1) > `:` (0)

## Variable Syntax

| Pattern | Type | Behavior |
|---------|------|----------|
| `var: value` | INPUT | Persistent |
| `var<- value` | INPUT | Cleared on Clear button |
| `var<<- value` | INPUT | Full precision, cleared on Clear |
| `var:: value` | INPUT | Full precision, persistent |
| `var->` | OUTPUT | Cleared before solve |
| `var->>` | OUTPUT | Full precision, cleared before solve |
| `var:>` | OUTPUT | Persistent output (cleared before solve, NOT by Clear) |
| `var:>>` | OUTPUT | Persistent output, full precision |
| `var[lo:hi]:` | With limits | Constrain Brent's search range |
| `price$:` | Money format | `$` before marker = money format |
| `rate%: 7.5%` | Percentage | `%` before marker = percent (stored as 0.075) |
| `angle°: 400°` | Degrees | `°` before marker = degrees format (mod 360 on output); `400°` literal = 400 (no mod) |
| `when@d: 4/1/2026` | Date format | `@d` before marker = date (locale format); `@d->>` includes time |
| `dur@t: 1:30:00` | Duration format | `@t` before marker = duration H:MM:SS; `@t->>` includes fractional seconds |
| `a °= b` | Degree equality | Mod-aware comparison (mod 360 or mod 2π per degreesMode): equation balance check or logical operator (returns 1/0) |
| `expr$->` | Expression output | Format expression result as money |
| `x~` | Pre-solve value | Strictly returns value before this solve started |
| `x~?` | Existence check | 1 if x has a pre-solve value, 0 otherwise |
| `\expr\` | Inline eval (table/grid titles only) | Evaluates expression for display in title |

## Built-in Functions

**Math**: Abs, Sign, Int, Frac, Round, Floor, Ceil, Mod, Sqrt, Cbrt, Root, Exp, Ln, Log, Fact, Pi, Rand

**Trig** (degrees/radians mode): Sin, ASin, SinH, ASinH, Cos, ACos, CosH, ACosH, Tan, ATan, TanH, ATanH, Radians, Degrees

**Date/Time**: Now, Date(y;m;d;h;min;s), Days(d1;d2), Year, Month, Day, Weekday, Hour, Minute, Second, Hours, TimePart

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

**Modifying solving behavior**: Edit `solveRecord()` in `solve-engine.js`. `solveEquations(context, declarations, record, equations, bodyDefinitions)` takes equations and optional body definitions as parameters, enabling reuse by both the main solver and table/grid per-row evaluation. Body definitions (`:` declarations) are evaluated in the iterative loop alongside equations, handling out-of-order deps and equation-dependent definitions.

**Adding a table/grid feature**: Table detection is in `findTableDefinitions()` (variables.js), evaluation in `evaluateTable()` (solve-engine.js), rendering in `setTableData()` / `_renderTable2()` (variables-panel.js), styling in style.css (`.mathpad-table`, `.mathpad-grid`)

**Algebraic substitution** (`deriveSubstitution` in `solver.js`): Derives substitutions to reduce multi-unknown equations to single-unknown for Brent's. Uses recursive `tryIsolateVariable` to peel off binary operations one level at a time via `invertOperation`, handling arbitrary-depth nesting (e.g., `a*b/D = C` → `a = C*D/b`). Subsumes additive patterns (`var*B + C = D`), nested products/quotients, and `**` (power) inversion.

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
