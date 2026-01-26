# `pdfjs-dist`

**Area:** Document extraction (PDF)

## Why this matters for PairOfCleats
Enables indexing of PDF content for prose search.

## Implementation notes (practical)
- Guard memory usage when parsing large or malformed PDFs.
- Normalize extracted text for consistent chunking.

## Where it typically plugs into PairOfCleats
- Optional document extraction pipeline for prose indexing.

## Deep links (implementation-relevant)
1. README -- https://github.com/mozilla/pdfjs-dist#readme

## Suggested extraction checklist
- [ ] Validate extraction on multi-page PDFs with images.
- [ ] Ensure PDF parsing failures do not stop indexing.
