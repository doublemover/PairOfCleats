# `fdir`

**Area:** Filesystem crawling

## Why this matters for PairOfCleats
Fast directory traversal with filtering, depth controls, and symlink policy; useful for repo scanning and incremental discovery.

## Implementation notes (practical)
- Apply filters early to reduce IO and allocations.
- Be explicit about symlink behavior for security and determinism.

## Where it typically plugs into PairOfCleats
- Repo scan: collect candidate files, respecting ignore rules and maxDepth where appropriate.

## Deep links (implementation-relevant)
1. README: API (withSymlinks, filters, maxDepth, globbing) — https://github.com/thecodrr/fdir#readme

## Suggested extraction checklist
- [ ] Identify the exact API entrypoints you will call and the data structures you will persist.
- [ ] Record configuration knobs that meaningfully change output/performance.
- [ ] Add at least one representative test fixture and a regression benchmark.