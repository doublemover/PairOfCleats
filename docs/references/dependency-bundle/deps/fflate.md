# `fflate`

**Area:** Compression / zip artifacts

## Why this matters for PairOfCleats
Compress cache bundles and index artifacts, including streaming zip/unzip for large repositories.

## Implementation notes (practical)
- Use async/streaming APIs to avoid buffering entire archives in memory.
- Prefer incremental unzip when restoring CI artifacts.

## Where it typically plugs into PairOfCleats
- CI: restore artifact archives into cache root with controlled memory usage.
- Local: rotate and compact caches.

## Deep links (implementation-relevant)
1. Docs index (async streaming APIs; zip/unzip primitives) — https://github.com/101arrowz/fflate/blob/master/docs/README.md
2. AsyncUnzipInflate class docs (incremental unzip example) — https://github.com/101arrowz/fflate/blob/master/docs/classes/AsyncUnzipInflate.md

## Suggested extraction checklist
- [ ] Identify the exact API entrypoints you will call and the data structures you will persist.
- [ ] Record configuration knobs that meaningfully change output/performance.
- [ ] Add at least one representative test fixture and a regression benchmark.