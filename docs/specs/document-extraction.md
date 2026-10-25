# Document Extraction and Chunking Specification

## Scope

The DOCX ZIP fallback applies `maxBytesPerFile` independently to compressed input
and expanded `word/document.xml` bytes. Declared sizes cannot bypass zlib's actual
output bound; XML parsing only receives bounded output. Expansion overflow is an
`oversize` extraction failure.

The direct DOCX pathname adapter also uses the existing bounded contained-file
descriptor reader before allocation. Source read/close failures retain their
original ownership; a size refusal becomes `oversize` only after closure confirms.

DOCX XML uses fatal UTF-8 decoding with an optional UTF-8 BOM and XML 1.0
declaration. UTF-16/32 and legacy encodings are explicitly unsupported; a declared
encoding conflict, malformed byte sequence or invalid XML character fails
extraction. The existing namespace-aware SAX reader admits supported transitional
and strict WordprocessingML URIs independent of prefix spelling. It validates the
document root, namespace rebinding and well-formed element boundaries; comments
and processing instructions do not provide searchable text. DTDs remain rejected.

XML admission caps depth at 256, elements at 250,000, attributes per element at
128, events at 1,000,000 and physical paragraphs at 100,000. Decoded input is
bounded by the file allowance and a 64 Mi-character parser ceiling. Tokenization
runs in 16 Ki-character pieces with monotonic deadline checks; ZIP expansion and
decoding consume the same structural phase allowance. Structural admission
precedes preferred-provider work. Empty and omitted revision paragraphs retain
their physical positions, while only admitted nonempty paragraphs become chunks.
DOCX structural producer version 3 invalidates prior extraction/bundle products;
persisted normalization identity `v1:docx-xml:3` also distinguishes the changed
source transformation. The installed provider's package version remains exact.

PDF extraction owns both the loading task and loaded document. Success, page
failure and timeout dispose them through bounded cleanup. The timeout signal
initiates cancellation immediately, each awaited page boundary checks it, and a
document arriving after timeout is disposed before use. Cleanup failures retain
the primary extraction error and attach cleanup evidence. This lifecycle
contract requires pdf.js cleanup to actually settle; a timeout race alone is not
proof that a worker terminated.

PDF text coverage records observed document pages independently of retained text
units and chunks. Empty-text pages retain their original page numbers in a
versioned receipt: attempted/completed, text/no-text, failed, in-flight and
not-attempted counts. The receipt includes at most 256 contiguous state ranges;
exact aggregate counts and `page-detail-budget` omission counts remain when that
detail allowance is exhausted. A page completes only after its cleanup settles.
Page-cap, page-error and timeout outcomes retain the actual observed boundary.

A no-text observation does not establish that a page is blank or scanned. No
visual classification or OCR runs. Mixed PDFs retain useful text with
`coverage_gap` fidelity and a concise page-count warning; files with no observed
text use `no_text_observed`. Permissive policy retains unknown coverage, while
quality-sensitive policy marks it as a violation. Both policies report identical
page evidence. A missing legacy page receipt is explicitly unqualified. PDF
producer version 2, normalization `v1:pdf-text:2` and fidelity schema version 2
invalidate prior complete-without-page-evidence interpretations. Extraction-cache
hits preserve the receipt and report identity; incremental bundle persistence is
owned separately by the bundle receipt contract.
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
- `no_text_observed` (no blank/scanned inference)
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

## Extraction report artifact
- Path: `extraction_report.json` in extracted-prose index output.
- `schemaVersion = 2`.
- Includes:
  - counts by status (`ok`, `skipped`) and `byReason`.
  - per-file extraction status and reason.
  - extractor identity (`name`, `version`, `target`).
  - `sourceBytesHash` and `extractionIdentityHash`.

## Extraction identity hash formula
- `extractionIdentityHash = sha256(bytesHash + "|" + extractorVersion + "|" + normalizationPolicy + "|" + chunkerVersion + "|" + extractionConfigDigest)`
- `extractionConfigDigest = sha256(stableStringify(indexing.documentExtraction))`
