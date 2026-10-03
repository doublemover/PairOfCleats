# Shared-Module Scan: #417

- Issue: `#417`
- Title: `Scan indexing, retrieval, graph, storage, and context-pack surfaces for missed shared-module adoption`
- Scan date: `2026-03-26`

## Summary

This surface already uses shared modules heavily. The best cleanup here is selective:

- keep strong shared adoption where it already exists
- tighten a few real missed-adoption seams
- avoid forcing domain-specific traversal, ranking, storage, or rendering logic into generic helpers

The strongest shared anchors already in use are:

- [artifact-io.js](../../../src/shared/artifact-io.js)
- [truncation.js](../../../src/shared/truncation.js)
- [limits.js](../../../src/shared/limits.js)
- [sort.js](../../../src/shared/sort.js)
- [provenance.js](../../../src/shared/provenance.js)
- [file-paths.js](../../../src/shared/file-paths.js)
- [path-normalize.js](../../../src/shared/path-normalize.js)
- [runtime-envelope/resolve.js](../../../src/shared/runtime-envelope/resolve.js)

The main missed-adoption work is:

- context-pack truncation handling
- repeated local path-normalization wrappers
- a cross-layer cluster of product code still depending on [dict-utils.js](../../../tools/shared/dict-utils.js), which should not spread further

## Adoption Matrix

### 1. Context-pack truncation handling

Shared modules to prefer:
- [truncation.js](../../../src/shared/truncation.js)
- [risk-filters.js](../../../src/shared/risk-filters.js)
- [risk-explain-model.js](../../../src/shared/risk-explain-model.js)

Representative local implementations:
- [budgets.js](../../../src/context-pack/assemble/budgets.js)
- [finalize.js](../../../src/context-pack/assemble/finalize.js)
- [guidance.js](../../../src/context-pack/assemble/guidance.js)
- [risk-slice.js](../../../src/context-pack/assemble/risk-slice.js)

Best action:
- Use the shared truncation recorder as the internal collection mechanism and keep raw array shaping only at the final API/schema boundary if needed.

Why this is best:
- Graph and retrieval surfaces already use the recorder. Reusing it here reduces evidence drift without inventing a second truncation contract.

Current adoption:
- 2026-05-21 follow-through: composite context-pack risk truncation now uses `createTruncationRecorder()` for pack-level and risk-level truncation records. The risk budget selector owns one recorder-backed sink for direct helper callers and assembled packs, the risk slice shares that sink across full-flow, partial-flow, and call-site-excerpt caps, and the final pack still exposes the same `truncation[] | null` API shape. Partial-flow truncation records now use the partial cap names that already existed in `risk.caps.hits`. Evidence: `temp/validation/context-pack-truncation-recorder-focused-20260521.log` and `temp/validation/context-pack-truncation-recorder-contracts-20260521.log`.

### 2. Path-normalization wrappers

Shared modules to prefer:
- [file-paths.js](../../../src/shared/file-paths.js)
- [path-normalize.js](../../../src/shared/path-normalize.js)

Representative local implementations:
- [utils.js](../../../src/map/utils.js)
- [executor.js](../../../src/index/build/tree-sitter-scheduler/executor.js)
- [cohorts.js](../../../src/index/build/indexer/steps/process-files/extracted-prose/cohorts.js)
- [normalize.js](../../../src/index/build/runtime/normalize.js)
- [path-utils.js](../../../src/index/build/import-resolution/path-utils.js)
- [utils.js](../../../src/storage/sqlite/utils.js)

Best action:
- Remove trivial wrappers and keep only the ones that add real domain semantics or validation.

Why this is best:
- Most of these wrappers are convenience aliases over the same canonical normalization behavior.

### 3. Product code depending on tool-side dict-utils

Representative consumers:
- [validate.js](../../../src/index/validate.js)
- [attempts.js](../../../src/index/build/watch/attempts.js)
- [dictionaries.js](../../../src/index/build/runtime/dictionaries.js)
- [embeddings.js](../../../src/index/build/runtime/embeddings.js)
- [runtime.js](../../../src/index/build/runtime/runtime.js)
- [index-state.js](../../../src/storage/sqlite/build/index-state.js)
- [cli-dictionary.js](../../../src/retrieval/cli-dictionary.js)

Best action:
- Do not deepen this dependency.
- Use this scan result as an extraction signal for later H32 work instead.

Why this is best:
- H30 already showed this is the wrong ownership seam. Expanding it now would make the later cleanup harder.

## Strong No-Adopt Zones

These surfaces already use the right shared primitives and should mostly stay local:

- [neighborhood.js](../../../src/graph/neighborhood.js)
- [impact.js](../../../src/graph/impact.js)
- [architecture.js](../../../src/graph/architecture.js)
- [pipeline](../../../src/retrieval/pipeline.js) and related retrieval pipeline modules
- [build](../../../src/storage/sqlite/build/runner.js) and related SQLite build modules
- [client](../../../src/map/isometric/client/viewer.js) and related isometric client modules

Rationale:
- shared primitives are already in place
- the remaining logic is domain-specific traversal, ranking, storage, or rendering behavior

## Recommended Follow-On Issues

- `#418`: tooling/setup/bench parallels to these path/env/helper seams
- `#423`: extract a proper src-shared repo/workspace/cache-root/generation family instead of spreading tool-side dict-utils
- `#425`: if context-pack/risk/search normalization still feels fragmented after H31
- `#426`: if low-level path/serialization duplication remains after the selective adoptions above
