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
1. README: API (withSymlinks, filters, maxDepth, globbing)  https://github.com/thecodrr/fdir#readme

## Suggested extraction checklist
- [x] Identify the exact API entrypoints you will call and the data structures you will persist. (Use `new fdir().withFullPaths().crawl(root).withPromise()` to enumerate repo files (src/index/build/discover.js, tools/config-inventory.js).)
- [x] Record configuration knobs that meaningfully change output/performance. (withFullPaths() and crawl(root) shape path outputs and traversal scope.)
- [x] Add at least one representative test fixture and a regression benchmark. (Fixture: tests/indexing/discovery/discover.test.js (discovery pipeline). Benchmark: tools/bench-language-repos.js.)