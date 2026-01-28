# Draft Spec: Document Provenance Fields in `metaV2` + Anchor Computation

This spec defines how PairOfCleats records **document provenance** for non-code sources (PDF/DOCX, extracted prose, etc.) inside `metaV2`, and how stable **anchors** are computed.

Primary goals:
- enable stable “where did this text come from?” provenance,
- enable stable linking in UI/exports (`file#anchor`),
- and prevent silent drift in anchor semantics.

---

## 1) Scope

This spec applies to any chunk whose content originates from:

- source code files (baseline)
- PDF documents
- DOCX documents
- extracted prose (e.g., text extracted from PDFs/DOCX)
- records-based sources (optional extension)

It defines:
- required `metaV2` fields for provenance,
- standard range coordinate systems,
- and stable anchor string computation rules.

---

## 2) Existing baseline (current schema)

`metaV2` already captures (per current repo implementation):

- `file` (repo-relative path)
- `startLine` / `endLine`
- `segment` object (type, name, signature, start/end offsets, line bounds, etc.)

This spec extends `metaV2` with a new sub-object:

- `metaV2.provenance`

---

## 3) New field: `metaV2.provenance`

### 3.1 Top-level shape

```jsonc
{
  "metaV2": {
    "...": "existing fields",
    "provenance": {
      "schemaVersion": 1,
      "sourceKind": "code|pdf|docx|text|record",
      "container": {
        "path": "relative/path.ext",
        "mime": "text/plain|application/pdf|application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "digest": { "sha256": "optional" }
      },
      "location": {
        // One (or more) of these depending on sourceKind:
        "lineRange": { "startLine": 10, "endLine": 42 },
        "byteRange": { "start": 123, "end": 456 },
        "charRange": { "start": 123, "end": 456 },
        "pdfPageRange": { "startPage": 3, "endPage": 4 },
        "docxParagraphRange": { "start": 12, "end": 15 }
      },
      "anchors": {
        "primary": "relative/path.ext#...",
        "aliases": ["optional alternates…"]
      }
    }
  }
}
```

### 3.2 Required fields
- `schemaVersion` (int)
- `sourceKind`
- `container.path`
- `anchors.primary`

### 3.3 Optional but recommended fields
- `container.mime`
- `container.digest.sha256` (helps stable linking across renames/moves)
- `location.*` (depends on source kind; see below)

---

## 4) Location coordinate systems (normative)

### 4.1 Line ranges
- `startLine` and `endLine` are **1-based line numbers**.
- `endLine` is inclusive.
- For code, line ranges should match `metaV2.startLine/endLine`.

### 4.2 Byte and char ranges
- `byteRange.start/end` are **0-based offsets** into the UTF-8 byte stream of the container.
- `charRange.start/end` are **0-based code unit offsets** into the Unicode string (UTF-16 in JS terms).
- If both are present, they must refer to the *same substring*.

> Recommendation: prefer `byteRange` for on-disk determinism; use `charRange` only when byte offsets are not readily available.

### 4.3 PDF page ranges
- `pdfPageRange.startPage/endPage` are **1-based inclusive** page numbers.
- A chunk that comes from exactly one page uses `startPage=endPage`.

### 4.4 DOCX paragraph ranges
- `docxParagraphRange.start/end` are **1-based inclusive** paragraph indices in the DOCX document order.
- Paragraph indices refer to the paragraph sequence as presented by the extractor (e.g., mammoth).

---

## 5) Anchor computation (normative)

Anchors are stable strings used in:
- UI deep links,
- exports,
- snapshot/diff event references,
- “show me where this came from” tooling.

### 5.1 General form
`anchors.primary` MUST be:

```
<container.path>#<anchor-fragment>
```

Where:
- `<container.path>` is repo-relative with POSIX separators.
- `<anchor-fragment>` depends on `sourceKind` as below.

### 5.2 Code anchors
If `sourceKind=code` and a line range is available:

- Primary anchor fragment:
  - `L<startLine>-L<endLine>`

Examples:
- `src/foo.ts#L10-L42`

If line range is not available but a byte range is:
- `B<start>-B<end>`

### 5.3 PDF anchors
If `sourceKind=pdf` and a page range is available:

- Primary anchor fragment:
  - `p<startPage>-p<endPage>`

Examples:
- `docs/spec.pdf#p3-p3`
- `docs/spec.pdf#p12-p14`

Optional refinement (if char/byte offsets are available within extracted text):
- append `@c<start>-<end>` (char offsets)
- or `@b<start>-<end>` (byte offsets)

Example:
- `docs/spec.pdf#p3-p3@c120-420`

### 5.4 DOCX anchors
If `sourceKind=docx` and paragraph range is available:

- Primary anchor fragment:
  - `para<start>-para<end>`

Examples:
- `docs/design.docx#para12-para15`

Optional refinement (if run offsets exist):
- `@r<start>-<end>`

### 5.5 Text/extracted prose anchors
If `sourceKind=text` and char/byte range exists:
- `c<start>-c<end>` or `b<start>-b<end>`

Examples:
- `docs/notes.txt#c0-c800`

### 5.6 Record anchors (optional extension)
If `sourceKind=record`, anchor fragment should be:
- `record:<recordId>#field:<fieldName>@c<start>-<end>` (example)

This is intentionally outside v1 unless records ingestion becomes first-class in the chunk schema.

---

## 6) Alias anchors (recommended)

`anchors.aliases[]` may include:
- legacy anchor scheme (if migrating)
- a segment UID-based anchor (if one exists and is stable)
- extractor-native anchors (e.g., PDF internal destination)

Rules:
- aliases are optional
- aliases must be unique and stable
- do not use aliases for ordering or canonical identity; only `primary` is canonical

---

## 7) Practical extraction guidance (non-normative)

### PDF extraction
- Prefer emitting chunks that align with page boundaries at minimum.
- When extracting text blocks, record:
  - page range
  - and optionally per-block char offsets in the extracted stream.

### DOCX extraction
- Prefer chunking by paragraph groups (e.g., 1–N paragraphs per chunk).
- Record paragraph indices used.

---

## 8) Validation rules

A chunk validator MUST reject:
- missing `metaV2.provenance.schemaVersion`
- missing `anchors.primary`
- invalid page/paragraph numbers (<=0)
- invalid ranges where start > end

---

## 9) Tests (recommended)

- `tests/metaV2/provenance-anchor-code.test.js`
- `tests/metaV2/provenance-anchor-pdf.test.js`
- `tests/metaV2/provenance-anchor-docx.test.js`

Each test should:
- build a synthetic `metaV2` object
- assert the computed `anchors.primary` equals the expected string
- assert serialization round-trips without losing required fields

---

## 10) Open questions

1. Do we want `container.digest.sha256` required for PDF/DOCX, or optional?
2. Should anchors use URL-escaping for paths with spaces, or remain raw repo-relative strings?
3. For PDF, do we want block-level anchors (page + block index) instead of char offsets?
4. How should anchors behave under file renames? (digest-based alias could help)

