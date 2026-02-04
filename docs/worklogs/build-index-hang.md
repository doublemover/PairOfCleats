# Build Index Hang Investigation

- 2026-02-04T01:21:20Z
  - Repro: `PAIROFCLEATS_DEBUG_ORDERED=1 node build_index.js --mode code --stage stage2 --progress off --verbose`.
  - Observed: `ordered` appender stalled at `nextIndex=0` with pending indices `{641, 657}` while processing the first files.
  - Conclusion: ordered appender blocked on canonical ordering; first processed files were far ahead of `nextIndex`.
  - Attempt: reset `canonicalOrderIndex`/`orderIndex` per-mode after sorting in discovery (did not change stall).
- 2026-02-04T01:26:00Z
  - Observed: still stalled at `nextIndex=0` with pending `{641, 657}`; indicates reordering (tree-sitter batching) is processing files out of canonical order and blocking queue completion.
  - Next: disable tree-sitter reorder to avoid deadlock with ordered appender backpressure.
- 2026-02-04T01:32:00Z
  - Change: disabled tree-sitter reordering in `process-files` to keep processing in canonical order.
  - Repro: reran stage2 build with debug ordering; ordered appender advanced normally (no stall).
