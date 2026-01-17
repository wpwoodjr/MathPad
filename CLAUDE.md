# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MathPad is a legacy algebraic equation solver application for PalmOS PDAs (circa 1997-2000). The repository contains:
- Pre-compiled Palm applications (`.prc` files)
- Desktop utility source code for database import/export (ANSI C)
- Documentation and examples

## Build Commands

The desktop utilities are plain ANSI C with no build system. Compile directly:

```bash
# Linux/Unix
gcc -o mpexport "mathpad 1.5/MpExport.c"
gcc -o mpimport "mathpad 1.5/MpImport.c"

# Windows (MSVC)
cl "mathpad 1.5/MpExport.c"
cl "mathpad 1.5/MpImport.c"
```

## Usage

```bash
# Export database records to text
./mpexport <DbFileName> <TextFileName>

# Import text records into database
./mpimport <OldDbFileName> <TextFileName> [NewDbFileName]
```

## Architecture

### Source Files

- **mpdb.h** - Shared header with Palm database format definitions, data types, and endianness handling
- **MpExport.c** - Reads MathPad `.pdb` files and exports records to ASCII text format
- **MpImport.c** - Imports ASCII records back into MathPad database files

### Key Data Structures

- `DatabaseHdrType` - Palm database header (name, attributes, timestamps, type/creator)
- `AppInfoType` - Category labels and metadata (16 categories max)
- `RecordEntryType` - Record metadata (file offset, attributes, unique ID)
- `MathPadItemType` - MathPad record content (decimal places, strip zeros flag, equation text)

### Database Format

- Creator ID: `MthP`, Type: `Data`
- Big-endian format (Motorola) - requires byte-swapping on Intel systems
- Records contain: precision settings + equation text

### Endianness Configuration

In `mpdb.h`, one of these must be defined:
- `#define LITTLE_ENDIAN` - for Intel/x86 systems (currently enabled)
- `#define BIG_ENDIAN` - for Motorola/PowerPC systems

## Text Export Format

Records are separated by `~~~~~~~~~~~~~~~~~~~~~~~~~~~` and contain:
```
Category = "CategoryName"; Secret = 0
Places = 14; StripZeros = 1
equation text here
~~~~~~~~~~~~~~~~~~~~~~~~~~~
```

## Notes

- Code is public domain
- Author: Rick Huebner
- The `.prc` files are pre-compiled Palm executables (require PalmOS SDK to rebuild)
