# `chardet`

**Area:** Encoding detection

## Why this matters for PairOfCleats
Guess file encodings with confidence scores to choose decoding strategy and reduce garbled text indexing.

## Implementation notes (practical)
- Treat results probabilistically; set a confidence threshold and fall back to UTF-8 with replacement.
- Cache per-file encoding decisions in incremental bundles.

## Where it typically plugs into PairOfCleats
- Ingestion: decide decoding, record confidence, and surface warnings for low-confidence files.

## Deep links (implementation-relevant)
1. README: detect/detectFile APIs + confidence scores — https://github.com/runk/node-chardet#readme

## Suggested extraction checklist
- [ ] Identify the exact API entrypoints you will call and the data structures you will persist.
- [ ] Record configuration knobs that meaningfully change output/performance.
- [ ] Add at least one representative test fixture and a regression benchmark.