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
- Pipeline: discover variables → evaluate definitions → partition equations into independent components → solve each component (recursive backtracking) → merge → per-OUTPUT-with-limits re-solve → format output
- **Recursive backtracking solver** (`solveRecursive` in solve-engine.js): each depth runs `deterministicAdvance` ([1]-[4]: body defs, sub map, direct-eval, sweep subs), then `enumerateAlternatives` yields Kind 1/2/3 candidates. Backtracker snapshots state, applies a candidate, recurses. First balanced branch wins; otherwise `saveCandidate` keeps the most-progressed snapshot (compare-by-`context.variables.size` before snapshotting, so eager limit-rejection saves get replaced when subsequent branches bind more vars). `maxIterations = 50`.
- **Partitioning** (`solveEquationsByComponent`): splits equations into connected components by shared vars (transitively, including limit-expression refs and body-def RHS refs), runs `solveEquations` once per component with the shared `context`. Avoids the cartesian-product blow-up the backtracker would otherwise incur for independent contradictory sub-systems. Per-component calls pass `skipLimitValidation=true`; wrapper runs `validateLimits` once on the merged final context. Single-component records short-circuit to a direct call (no overhead).
- **OUTPUTs filtered from solver**: `buildVariablesMap` skips OUTPUT declarations — OUTPUT limits are display-only, handled by `resolveWithLimits` after the main solve.
- **Direct evaluation first**: fully-known substitutions (algebraic or definition) are evaluated directly in [3] before any Brent's; multiple alternates per variable trigger Kind 1 branching when ambiguous, NaN fallback when all alternates are NaN
- **Multi-sub derivation**: `deriveSubstitutions` (generator) yields every algebraically isolable variable per equation, both LHS and RHS directions. Cycles in the sub map are allowed; `substituteInAST`'s visited-set cycle guard ensures runtime termination
- **Subset-enumerated Kind 3**: `subCombinations` yields subsets in increasing size (0, 1, …, N), each with cartesian of per-key alternates. Smaller subsets tried first so cyclically-related sub pairs don't cancel via cycle-guard round-trips
- **Break-on-solve**: after a Kind 2/3 candidate applies, recursion re-runs `deterministicAdvance`, so definitions and direct-evals pick up the new value before further Brent's attempts
- **Always re-solve**: first pass skips tables; re-solve runs unconditionally and computes them. Re-solve also gives a second chance when the first solve filled in cleared variables but had balance errors. Same logic in `run-tests.js` and `gen-expected.js`.
- **OUTPUT-with-limits re-solve** (`resolveWithLimits`): each OUTPUT declaration with limits runs its own re-solve after main solve. Fast path if main-solve value already in limits; slow path builds modifiedDecls (prepend INPUT+limits for target) and calls full `solveEquations`. Slow-path errors surface to the user; results stored under `__resolvevar_${lineIndex}` keys. When the slow-path's solve produces balance errors (e.g. Brent's finds a value via one equation that another equation rejects), the wrapper reframes them as `"Could not find a value for X in range [lo:hi] consistent with all equations"` — blames the limit constraint rather than the user's equations, since the main solve's success proves the equations are consistent without the limit.
- Results inserted back into text preserving comments and formatting
- Error reporting with line numbers shown in status bar (dedup by string)

### Variable Limits
- **Limits are always linear**: `[50:0]` is auto-swapped to `[0:50]` — order doesn't matter. `°` on a declaration is display-only and does NOT affect search-range semantics. For wrap-through-0° search, write a linear range extending past M (e.g. `[327.8:365.5]`) — trig is periodic so Brent's evaluating 365° == evaluating 5°. Mod-aware solving semantics live entirely in `°=` equations.
- **Limit deferral**: when a limit expression depends on a not-yet-solved variable, the solve attempt returns `{ solved: false, limitsDeferred: true }` instead of running unconstrained. The iterative loop retries on subsequent passes.
- **End-of-solve validation**: catches undefined references in limit expressions even when the variable has a value (which would otherwise bypass the per-attempt check).

### Tables, Grids, and vectorDraw
- **`table("Title") = { body }`** — columnar output iterating 1+ variables over a range. Multiple iterators produce rows over the cartesian product (first declared = outermost loop, last declared = innermost). Iterator bounds are evaluated once up-front, so inner iterators can't depend on outer iterator values.
- **`tableGraph("Title") = { body }`** — like `table` but rendered as an SVG line graph. Column 0 is the X-axis; remaining columns are Y series. Multi-iterator grouping is opt-in: an inner iterator becomes a line-grouping variable only if it has a `iter->` output column. The column's label (e.g. `Y` in `Y y->`) is used in the legend (`Y = 1.0`). Without `y->`, the iterator just sweeps silently. Text output uses only the declared output columns.
- **`grid("Title") = { body }`** — 2D cell grid iterating 2+ variables
- **`vectorDraw("Title"; type[; fontSize]) = { body }`** — vector diagram with start/end pairs. `type` is required: `navigation` (0° = up, +° clockwise — bearings), `polar` (0° = right, +° counter-clockwise — math), or `cartesian` (raw x/y, no angle handling). For navigation/polar each pair is (direction, magnitude); for cartesian each pair is (x, y). The end pair is **relative displacement** for navigation/polar (added to the start) but **absolute destination** for cartesian (where the natural reading of `(x, y)` is a point, not a delta). Optional `fontSize` is the third argument.
- Body declarations: iterators (`x<- 0..10` or `x: 0..10..2`), unknowns (`z<-`), definitions (`v: 10`), outputs (`Label z->`)
- `..` range syntax (`DOT_DOT` token) for iterator bounds with optional step
- Tables/grids inherit outer equations when body has none; body equations override if present
- Each row/cell solved fresh using unified `solveEquations` pipeline
- Pre-solve context reset per row (user declarations only, no equation-computed intermediates)
- Per-cell error suppression (bad cells empty, good cells show values)
- Per-cell balance checking: equations containing unknowns verified after each solve (tables, grids, and vectorDraw)
- Unused variable warnings with actual line numbers
- Grid axes: iterator declaration order (first = rows, second = columns)
- Grid outputs: declaration order (first = row headers, second = col headers, third = cell value)
- Grid header values computed from output variable after solving (enables formatted headers like `hours@t->`)
- Grid hover: row + column + header highlighting
- Collapsible titles; optional font size parameter: `table("Title"; 12) = { ... }`
- **Solve status indicator**: when table/grid/vectorDraw doesn't fully solve, shows "(n/m solved)" after title (85% font size, 70% opacity); hidden when everything solves. Tracks per-row (table), per-cell (grid), or per-unknown (vectorDraw) success.
- Table output text section (`"--- Table Outputs ---"`) appended for copy/export; includes vectorDraw blocks with per-vector header+value pairs
- All table result objects include `keyword` field for text output type prefix (e.g., `table "Title"`, `grid "Title"`, `vectordraw "Title"`)

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
| `solver.js` | Brent's root-finding algorithm, equation detection, substitution derivation (`deriveSubstitutions` generator, `tryIsolateVariables` generator, single-result wrappers for back-compat) |
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
  shadowConstants: boolean,// parsed-and-ignored: documented intent was "output markers shadow reference constants when true", but no code currently reads this flag
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

**Modifying solving behavior**: Edit `solveRecord()` in `solve-engine.js`. `solveEquations(context, declarations, record, equations, bodyDefinitions)` takes equations and optional body definitions as parameters, enabling reuse by both the main solver and table/grid per-row evaluation. The recursive `solveRecursive` + `deterministicAdvance` + `enumerateAlternatives` structure handles body defs, substitutions, direct-eval, and Kind 1/2/3 branching within each level. Body definitions (`:` declarations) are evaluated in phase [1] of each Advance pass, handling out-of-order deps and equation-dependent definitions.

**Adding a table/grid/vectorDraw feature**: Table detection is in `findTableDefinitions()` (variables.js), evaluation in `evaluateTable()` (solve-engine.js), rendering in `setTableData()` / `_renderTable2()` (variables-panel.js), styling in style.css (`.mathpad-table`, `.mathpad-grid`)

**Algebraic substitution** (`deriveSubstitutions` in `solver.js`): Generator yielding every algebraically isolable unknown per equation, symmetric (both LHS-with-RHS-as-target and RHS-with-LHS-as-target). Uses `tryIsolateVariables` (generator) to peel off binary operations one level at a time via `invertOperation`, handling arbitrary-depth nesting (e.g., `a*b/D = C` → `a = C*D/b` AND `b = C*D/a`). Subsumes additive patterns (`var*B + C = D`), nested products/quotients, and `**` (power) inversion. `substituteInAST` recursively applies subs with a visited-set cycle guard so cyclically-related subs (e.g., `x → z/2` and `z → 2*x`) terminate safely at runtime.

**Kind 3 combo enumeration** (`subCombinations` in `solve-engine.js`): yields (subset × cartesian-of-alternates) combos in increasing subset size (0, 1, …, N). The backtracker's DFS tries smaller subsets first, so cyclically-related sub pairs don't cancel via the cycle guard's round-trip (width/height-style records still reduce to 1-unknown on size-1 combos). Full cartesian is last resort.

**Component partitioning** (`partitionEquationsByComponent` + `solveEquationsByComponent` in `solve-engine.js`): union-find over variable names; vars are unioned if they share an equation, a limit-expression reference, or a body-def RHS reference. Equations group by union representative. Wrapper runs `solveEquations` per component with the shared `context` and full declarations/body-defs (cross-component vars are inert). Per-component calls pass `skipLimitValidation=true`; `validateLimits` runs once at the wrapper after merging. Avoids backtracker cartesian-product blow-up on independent contradictory sub-systems.

**bestCandidate progress-wins** (`saveCandidate` in `solve-engine.js`): when the recursive backtracker can't find a balanced branch, it falls back to the most-progressed snapshot. The save check `if (bestCandidate && bestCandidate.variables.size >= context.variables.size) return;` ensures eager saves (from limit-rejection) get replaced when subsequent branches bind more vars. Without this, an early shallow save would lock in a partial state and end-of-solve validation could spuriously report "Variable X has no value" for limits referencing vars that deeper branches set.

**OUTPUT-with-limits re-solve** (`resolveWithLimits` in `solve-engine.js`): each OUTPUT declaration with limits runs its own re-solve after the main solve. Fast path uses the main-solve value if already in limits; slow path builds modifiedDecls (prepend INPUT+limits entry for the target), calls full `solveEquations`, and surfaces any balance/root errors to the user. Stored under `__resolvevar_${lineIndex}` keys; `formatOutput` reads them per-declaration.

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
