# `@parcel/watcher`

**Area:** File watching / incremental indexing

## Why this matters for PairOfCleats
Provides a native watcher backend that can outperform chokidar on large trees.

## Implementation notes (practical)
- Map events into the normalized add/change/unlink model used by watchIndex.
- Pair with a write-stability guard because parcel does not mirror awaitWriteFinish.

## Where it typically plugs into PairOfCleats
- Index watch backend selection for `pairofcleats index watch`.

## Deep links (implementation-relevant)
1. README and API surface -- https://github.com/parcel-bundler/watcher#readme

## Suggested extraction checklist
- [ ] Define fallback behavior when native bindings fail to load.
- [ ] Validate event coalescing under rapid file writes.
