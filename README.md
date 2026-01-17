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

## Original Desktop Utilities

The `mathpad 1.5/` directory contains the original C source code for import/export utilities:

```bash
# Compile on Linux/Unix
gcc -o mpexport "mathpad 1.5/MpExport.c"
gcc -o mpimport "mathpad 1.5/MpImport.c"

# Usage
./mpexport <DbFileName> <TextFileName>
./mpimport <OldDbFileName> <TextFileName> [NewDbFileName]
```

## License

The original MathPad code by Rick Huebner is public domain. The web reimplementation follows the same licensing.
