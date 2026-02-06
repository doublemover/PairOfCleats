# VFS-Driven Global Tree-sitter Scheduler (One True Way)

## Summary
Replace all per-file and per-thread tree-sitter usage during indexing with a VFS-driven global scheduler that:
- Enumerates all tree-sitter work (including multi-language segments) up front.
- Batches execution by grammar WASM key (load grammar once, do all jobs, unload, then next).
- Produces deterministic, index-consumable outputs (chunking + token buckets now; seam for more consumers later).
- Removes legacy code paths entirely (no fallback, no "old way").

Constraints and decisions:
- No fallback to legacy behavior is allowed. Missing scheduler outputs is a hard error.
- Execution now: single in-process executor, with a seam to add per-language worker pool later.
- Extracted prose participates only if it produces embedded code segments that resolve to a tree-sitter language.

## Goals / Success Criteria
- During `build-index`, grammars are processed in batches by wasmKey:
  - `load -> process all jobs -> unload -> next`.
- No tree-sitter parsing happens inside per-file Stage1 workers.
- Determinism: chunk ids, ordering ledgers, and artifact hashes are identical across runs given the same repo/config.
- Strictness: invalid/missing scheduler artifacts fail the build (no warning-only behavior).
- Caps are global, not per-thread (single executor enforces the cap; later parallelism must share budget tokens).

## Non-Goals
- Implementing the per-language worker pool now (we only design the seam).
- Rewriting non-tree-sitter chunkers/tokenizers (they can remain per-file).

## Architecture

### A. Tree-sitter Jobs (Input)
A job is one VFS virtual document segment that must be parsed with a specific grammar wasmKey.

Job JSONL row fields:
- `containerPath`: real path
- `containerRel`: repo-relative path (stable sorting + ids)
- `segmentUid`: stable segment identifier
- `virtualPath`: `.poc-vfs/...#seg:<segmentUid>.<ext>`
- `virtualRange`: `{ start, end }` (byte offsets in container, validated)
- `effectiveLanguageId`: resolved tree-sitter language id
- `wasmKey`: canonical key derived from resolved wasm path
- `contentHash`: stable hash of segment text (optional but recommended)

Deterministic execution ordering within a wasmKey batch:
1. `containerRel` (bytewise)
2. `virtualRange.start` (numeric)
3. `virtualRange.end` (numeric)
4. `segmentUid` (bytewise)

This is only execution order. Output determinism must not depend on it.

### B. Tree-sitter Results (Outputs)
Results are keyed by `virtualPath`, so Stage1 can deterministically look them up regardless of execution order.

Artifacts under each mode index directory (`index-*/`):
- `tree-sitter/plan.json`
  - wasmKeys in execution order
  - counts and config snapshot
- `tree-sitter/jobs/<wasmKey>.jsonl`
- `tree-sitter/results/<wasmKey>.jsonl`
  - one row per job:
    - `virtualPath`, `segmentUid`, `containerRel`, `virtualRange`
    - `chunks`: chunk descriptors (container-relative offsets; stable uid inputs)
    - `tokenBuckets`: per-chunk token class buckets (compact ranges)
    - `stats`: per-job optional metrics
- `tree-sitter/results/<wasmKey>.vfsidx` (or equivalent sparse offset index)
  - `virtualPath -> fileOffset`

Token bucket representation:
- For each chunk: a compact list of `{ start, end, kind }` in chunk-local byte offsets.
- Deterministic ordering: sort ranges by `(start, end, kind)`.

### C. Executor
Single executor:
- Loads exactly one wasmKey at a time.
- For each job:
  - Reads segment text (containerPath + virtualRange).
  - Parses it.
  - Runs configured consumers:
    - Chunking (tree-sitter chunking logic)
    - Token bucket classification (tree-sitter-based bucketing)
  - Writes one results row.
  - Discards parse trees and segment text before the next job.

Seam for later parallelism:
- Interface: `executeWasmBatch({ wasmKey, jobs, consumers, budget }) -> results`.

## Stage1 Integration

### 1) Planning Prepass
After discovery and segmentation:
- Enumerate VFS segments for all files.
- Resolve effective tree-sitter language and wasmKey for each segment.
- Create jobs only for segments routed to enabled tree-sitter languages.
- Validate `virtualRange` and fail on invalid data (no skip).
- Write plan + per-wasmKey job lists.

### 2) Execute Batches
Before per-file processing begins:
- For each wasmKey:
  - preload grammar (wasmKey-first)
  - process all jobs
  - prune/reset other grammars to avoid memory accumulation
- Write results + indices.

### 3) Consume Results
Per-file processing:
- Chunking uses precomputed chunks for tree-sitter segments.
- Tokenization uses precomputed tokenBuckets for those chunks.
- Any attempt to parse with tree-sitter outside the executor is an error in indexing mode.

### 4) Remove Legacy Code Paths
Delete or make unreachable:
- Per-file `preloadTreeSitterLanguages` calls in Stage1 paths.
- Direct `getTreeSitterParser` during indexing outside the executor.
- Any fallback to legacy chunking/token bucket generation if scheduler artifacts are missing.

## Runtime Changes (WASM Key First)
Add runtime helpers:
- `resolveTreeSitterWasmKey(languageId) -> wasmKey`
- `preloadTreeSitterWasmKey(wasmKey, options)`
- `pruneTreeSitterExcept({ keepWasmKeys:[wasmKey] })` or equivalent

## Budgeting / Caps (Global)
Single executor enforces:
- max segment bytes read
- max parse bytes

Later worker pool must use a shared `BudgetPool` so caps remain overall.

## Determinism
- `plan.json` includes `planHash` computed from sorted jobs.
- Each results row includes a stable hash of `(virtualPath, virtualRange, chunks, tokenBuckets)`.
- Enforce stable ordering inside chunks/buckets.

## Invalid virtualRange Policy
Indexing-time behavior:
- Invalid virtual ranges are hard errors with actionable details.
- No "skip target" behavior during indexing.

## Tests (New)
Tests are runnable directly via `node ...`.
- `tests/indexing/tree-sitter/vfs-scheduler-batches-by-wasmkey.test.js`
- `tests/indexing/tree-sitter/vfs-scheduler-multilang-segments.test.js`
- `tests/indexing/tree-sitter/vfs-scheduler-determinism.test.js`
- `tests/indexing/tree-sitter/vfs-scheduler-no-legacy-paths.test.js`
- Update: `tests/tooling/vfs/vfs-invalid-virtual-range-regression.test.js` to expect hard error in indexing mode.

## Docs
- Add: `docs/specs/vfs-tree-sitter-scheduler.md`
- Update:
  - `docs/specs/tooling-vfs-and-segment-routing.md`
  - `docs/perf/indexing-stage-audit.md`

## Implementation Order
1. Runtime: wasmKey-first preload/prune APIs.
2. Planner: VFS segments -> jobs (strict validation).
3. Artifact IO: jsonl writers + vfsidx lookup.
4. Executor: single-thread wasmKey batch loop; chunking + token buckets consumers.
5. Stage1 wiring: scheduler runs before per-file; per-file uses lookups.
6. Remove legacy per-file parsing entrypoints for indexing.
7. Tests + determinism harness.
8. Docs updates.

