---
name: office-documents
description: Document conversion and Office automation - convert between formats (PDF, CSV, PNG, HTML), work with Excel/Word/PowerPoint programmatically, and export documents across Windows, macOS, and Linux.
version: "1.0.0"
type: mixed
tools:
  - convert_document
---

# Office Document Workflows

Load this skill when the user needs to convert documents, export to PDF, create formatted spreadsheets, or work with Office files.

## Available Tools (auto-registered when skill is enabled)

- `convert_document(input_path, output_format, output_path, sheet_name)` - Convert a document to another format. Automatically detects the best method available on the system (Office COM, LibreOffice, or Python libraries). Supports PDF, CSV, PNG, JPG, HTML output.

## When to Use

- User asks to **export to PDF** - use `convert_document`
- User asks to **convert a file** to another format - use `convert_document`
- User asks to **read/write Excel data** programmatically - use the built-in `read_excel` / `write_excel` tools (always available, no skill needed)
- User asks to **open a file for viewing** - use `open_file` (always available)
- User asks to **create a formatted document from scratch** - use `write_excel` for spreadsheets, then `convert_document` for export

## write_excel Tips

When using `write_excel` with `add_sheet`:

- After `add_sheet`, subsequent operations **automatically target the new sheet**. No need to pass `"sheet"` on every operation.
- To write to a **different** existing sheet, pass `"sheet": "SheetName"` explicitly.
- Verify with `read_excel(file_path, sheet="SheetName")` after writing.

## Missing Packages

If `convert_document` reports a missing Python package, install it:
```
execute_cli("pip install fpdf2")    # for PDF generation
execute_cli("pip install openpyxl")  # for Excel handling
```

Standard packages can be pip-installed on demand. Do not give up or try workarounds when a simple `pip install` solves the problem.

## Conversion Methods (auto-detected)

| Priority | Method | Platforms | Formats | Notes |
|----------|--------|-----------|---------|-------|
| 1 | Microsoft Office COM | Windows | PDF | Best quality for Office files |
| 2 | LibreOffice headless | All | PDF, CSV, PNG, JPG, HTML | Install LibreOffice for broadest support |
| 3 | Python (openpyxl + fpdf2) | All | PDF, CSV | Fallback, basic formatting |
