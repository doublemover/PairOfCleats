# `mammoth`

**Area:** Document extraction (DOCX)

## Why this matters for PairOfCleats
Extracts text from Word documents for search indexing.

## Implementation notes (practical)
- Normalize output to avoid noisy formatting artifacts.
- Handle embedded images or unsupported constructs gracefully.

## Where it typically plugs into PairOfCleats
- Optional document extraction pipeline for prose indexing.

## Deep links (implementation-relevant)
1. README -- https://github.com/mwilliamson/mammoth.js#readme

## Suggested extraction checklist
- [ ] Ensure paragraph boundaries map to chunking rules.
- [ ] Validate fallback when DOCX parsing fails.
