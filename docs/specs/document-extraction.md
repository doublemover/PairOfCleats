# Document Extraction and Chunking Specification

## Scope
- Applies to `indexing.mode = extracted-prose`.
- Supported source types: `pdf`, `docx`.

## Explicit non-goals
- OCR extraction.
- Scanned-image extraction.
- Encrypted/password-protected documents.
- Macro-enabled document execution.

## Extraction policy defaults
- `maxBytesPerFile = 64MB`
- `maxPages = 5000`
- `extractTimeoutMs = 15000`

## Typed extraction failure reasons
- `unsupported_encrypted`
- `unsupported_scanned`
- `oversize`
- `extract_timeout`
- `missing_dependency`
- `extract_failed`

## Optional dependency load order
- PDF: `pdfjs-dist/legacy/build/pdf.js|pdf.mjs`, then `pdfjs-dist/build/pdf.js`, then `pdfjs-dist`.
- DOCX: `mammoth` primary, `docx` fallback.

## Deterministic chunking defaults
- `maxCharsPerChunk = 2400`
- `minCharsPerChunk = 400`
- `maxTokensPerChunk = 700` (only when token-budget path is enabled)

## Format chunking behavior
- PDF:
  - default one chunk per page.
  - tiny adjacent pages are merged deterministically.
  - oversized merged/page windows are split deterministically by char budget.
  - segment provenance: `{ type:'pdf', pageStart, pageEnd, anchor, windowIndex? }`.
- DOCX:
  - paragraphs are grouped by budget.
  - tiny paragraphs are merged deterministically.
  - heading-style boundaries start new chunks when needed.
  - segment provenance: `{ type:'docx', paragraphStart, paragraphEnd, headingPath?, anchor, boundaryLabel?, windowIndex? }`.

## Anchor algorithm
- `anchor = "<type>:<start>-<end>:<sha256(normalizedTextSlice).slice(0,12)>"`
- `normalizedTextSlice` rules:
  - normalize newlines to `\n`
  - normalize repeated horizontal whitespace to single spaces
  - trim leading/trailing whitespace
- Same normalized input must produce the same anchor across platforms.
