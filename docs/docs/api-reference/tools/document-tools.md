---
sidebar_position: 4
---

# Document Tools

Tools for reading and writing document formats (PDF, images, Excel).

## `read_pdf`

Extract text content from a PDF file.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Path to PDF file |
| `pages` | `string` | Page range (e.g., `"1-5"`, `"3"`, optional) |

**Classification:** Host

**Return shape:**
```json
{
  "status": "success",
  "stdout": "extracted text from PDF pages",
  "exit_code": 0,
  "duration_ms": 200
}
```

## `read_image`

Read an image file and return its contents for analysis.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Path to image file |

**Classification:** Host

**Supported formats:** PNG, JPEG, BMP, GIF, TIFF, WebP

**Return shape:**
```json
{
  "status": "success",
  "stdout": "image description or base64 data",
  "image_b64": "base64 encoded image",
  "exit_code": 0,
  "duration_ms": 50
}
```

## `read_excel`

Read data from an Excel spreadsheet.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Path to Excel file |
| `sheet` | `string` | Sheet name (optional, defaults to first sheet) |
| `range` | `string` | Cell range (e.g., `"A1:D10"`, optional) |

**Classification:** Host

**Supported formats:** `.xlsx`, `.xls`, `.csv`

**Return shape:**
```json
{
  "status": "success",
  "stdout": "tabular data as formatted text",
  "exit_code": 0,
  "duration_ms": 100
}
```

## `write_excel`

Write data to an Excel spreadsheet.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Output file path |
| `data` | `array` | Array of row arrays |
| `sheet` | `string` | Sheet name (optional) |

**Classification:** Host (path-checked)

**Return shape:**
```json
{
  "status": "success",
  "stdout": "Excel file written successfully",
  "exit_code": 0,
  "duration_ms": 150
}
```

---

**Related:** [Core Tools](/api-reference/tools/core-tools) · [File Tools](/api-reference/tools/file-tools)
