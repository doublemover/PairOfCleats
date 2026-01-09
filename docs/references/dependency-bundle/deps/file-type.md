# `file-type`

**Area:** Binary detection (magic numbers)

## Why this matters for PairOfCleats
Detect file types by signature to avoid treating binary assets as text and to route specialized parsers when appropriate.

## Implementation notes (practical)
- Prefer buffer/stream detection for speed; do not read entire files unnecessarily.
- Treat detection as advisory; combine with extension and size thresholds.

## Where it typically plugs into PairOfCleats
- Ingestion: skip or down-rank binary blobs; optionally index a minimal metadata record (mime, size).

## Deep links (implementation-relevant)
1. README: fileTypeFromBuffer/fromFile/fromStream (magic-number detection) — https://github.com/sindresorhus/file-type#readme

## Suggested extraction checklist
- [ ] Identify the exact API entrypoints you will call and the data structures you will persist.
- [ ] Record configuration knobs that meaningfully change output/performance.
- [ ] Add at least one representative test fixture and a regression benchmark.