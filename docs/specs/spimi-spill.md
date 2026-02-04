# PairOfCleats: SPIMI Spill-to-Disk Token Postings Builder (Defensive + High-Throughput Spec)

**Status:** implementation-ready specification  
**Scope:** index build pipeline (not query-time), focused on eliminating V8 OOM caused by unbounded growth of `state.tokenPostings` during indexing.  
**Primary objective:** keep JS heap bounded while maintaining deterministic doc/chunk IDs and preserving the existing output artifact format.

---

## 0. Context (what is failing today)

During indexing, `src/index/build/state.js::appendChunk()` appends into:

- `state.tokenPostings: Map<string, Array<[docId, tf]>>`

This grows monotonically for the entire repository. Later, `src/index/build/postings.js::buildPostings()` materializes **sorted** `tokenEntries`, `tokenVocab`, and `tokenPostingsList`, temporarily creating a second copy of the same information (peak live set). On large repos (e.g., Swift), V8 cannot reclaim enough because most objects are still reachable, causing OOM near heap limit.

SPIMI (“Single-Pass In-Memory Indexing”) fixes this by flushing sorted postings blocks to disk and merging them later, bounding in-memory growth.

---

## 1. Requirements

### 1.1 Functional requirements
1. **Deterministic doc/chunk IDs**: identical to current behavior for a fixed file ordering, regardless of concurrency/sharding.
2. **Artifact compatibility**: output `token_postings.meta.json` and shard files remain schema-compatible with current readers.
3. **Correctness**: merged postings must represent the same token→postings mapping as current in-memory build.
4. **Robustness**: handle extreme inputs (huge files, minified JS, logs, Unicode tokens) without crashing or unbounded memory growth.

### 1.2 Non-functional requirements
1. **Bounded heap**: token postings memory growth is bounded by configurable thresholds.
2. **Throughput**: minimize time overhead; avoid blocking indexing on disk IO whenever possible.
3. **Failure hygiene**: partial segment writes never corrupt final artifacts; cleanup is reliable.

---

## 2. Design overview

### 2.1 What we spill (v1)
- **Token postings only** (`state.tokenPostings`) — highest memory driver.
- Phrase/chargram postings already have guardrails; can be extended later.

### 2.2 SPIMI block lifecycle
1. Indexing appends postings into an in-memory map (`state.tokenPostings`) as today.
2. When block exceeds thresholds, rotate the map:
   - `oldMap = state.tokenPostings; state.tokenPostings = new Map()`
3. Write `oldMap` to a **sorted segment file** on disk (async, limited concurrency).
4. Repeat.
5. At end: flush final block + multi-way merge all segment files into the existing token postings shard artifacts.

### 2.3 Key performance refinement: rotate + async write
To preserve throughput, flushing must **not** synchronously serialize all indexing on disk IO.

- Rotation is immediate and cheap.
- Segment writing occurs in the background with **strict limits**:
  - `maxInFlightWrites = 1` (default)
  - `maxBufferedRotatedBlocks = 1` (default)
- If writers fall behind, indexing will apply backpressure by awaiting the queue.

This bounds memory to “current block + (at most) 2 rotated blocks”.

---

## 3. Configuration

### 3.1 New user-facing config
Place under `indexing.postings.spill`:

```jsonc
{
  "indexing": {
    "postings": {
      "spill": {
        "enabled": "auto",              // "auto" | true | false
        "types": ["token"],             // v1: only "token" implemented
        "blockTargetMb": 200,           // soft target for token block
        "maxHeapFraction": 0.60,        // hard cap relative to v8 heap limit
        "checkEveryChunks": 64,         // sample frequency for memory checks
        "minChunksPerBlock": 256,       // avoid tiny segments unless hard cap hit
        "maxSegmentsOpen": 64,          // merge FD limit; triggers hierarchical merge
        "maxInFlightWrites": 1,         // writer concurrency
        "maxBufferedBlocks": 1,         // rotated-but-not-yet-written maps allowed
        "segmentFormat": "binary",      // "binary" | "ndjson" (debug only)
        "keepSegments": false,          // debug only: do not delete .spimi dir
        "tempDir": null                 // null => buildRoot/.spimi/<mode>
      }
    }
  }
}
```

### 3.2 “auto” enabling rule (deterministic + safe)
`enabled: "auto"` resolves to `true` when any of these are true:
- `entries.length >= 5000` (large file count heuristic), OR
- `process.platform === "win32"` **and** `entries.length >= 2000` (Windows tends to hit heap earlier), OR
- `runtime.argv?.forceSpill === true` (internal flag)

Otherwise resolves to `false`.

> Rationale: keep small repos fast; enable spill where OOM risk is high without requiring user tuning.
> Even when enabled, actual flushing only occurs when thresholds are reached (no preemptive small-block flushes).

---

## 4. On-disk segment format (v1)

### 4.1 Directory layout
Segments live under a build-scoped directory:

- `buildRoot/.spimi/<mode>/<buildId>/token/`
- segment file names: `token.seg-000001.spmi` (binary v1)
- if `segmentFormat: "ndjson"` (debug), use `token.seg-000001.ndjson`

### 4.2 Atomicity
Write to `*.tmp` then `rename()` to final name to avoid partial segments being read.

### 4.3 Binary segment format (v1)
Segments are binary by default (`segmentFormat: "binary"`).

**Header (fixed + varint fields):**
- 4 bytes magic: `SPMI`
- u8 version = `1`
- u8 flags:
  - bit0: postings are flat pairs (`[docId, tf, ...]`) — always `1` in v1
  - bit1: CRC32 footer present — default `1`
- varint `tokenCount` (0 if unknown at write time)
- varint `chunkIdStart` (inclusive)
- varint `chunkIdEnd` (exclusive)

**Records (repeat until EOF):**
- varint `tokenByteLen`
- `tokenByteLen` bytes (UTF‑8 token)
- varint `pairCount`
- `pairCount` pairs of:
  - varint `docIdDelta` (delta‑encoded, first delta is absolute docId)
  - varint `tf`

**Footer (optional, if flag bit1 set):**
- u32 `crc32` of the record payload (not including header)

**Ordering:**
- Records are sorted lexicographically by token using the same comparator as in `postings.js` (`a<b ? -1 : a>b ? 1 : 0`).
- Postings are emitted in docId order per segment (guaranteed by contiguous docId ranges).

### 4.4 Streaming writer requirements
- Use a buffered byte writer (256KB–1MB chunks) to avoid small writes.
- Never build full arrays/strings for a record; encode and stream as you iterate postings.
- Ensure tokens are emitted with proper UTF‑8 encoding; invalid sequences must be rejected or sanitized deterministically.

---

## 5. Merge strategy

### 5.1 Core invariant enabling fast merge
Each SPIMI block corresponds to a contiguous range of docIds (chunkIds) because chunks are appended sequentially.

Therefore, for a fixed token:
- postings from segment 0 have docIds in `[0..A)`
- postings from segment 1 have docIds in `[A..B)`
- etc.

So merged postings for token can be produced by **concatenating** the per-segment postings arrays in segment order (no sort required).
Segment headers must record `chunkIdStart/chunkIdEnd`, and merge must assert these ranges are strictly increasing when `validateDocOrder` is enabled.

### 5.2 Multi-way merge over tokens
Segments are token-sorted. We must produce global token order:
- Use a k-way merge (min-heap) keyed by current token per segment.
- When tokens match across multiple segments:
  - concatenate postings arrays (fast path)
  - optionally validate monotonicity in test mode
- Decode only the current record per segment (streaming); do not pre-read entire segments.

### 5.3 Too many segments / FD limits
If `segments.length > maxSegmentsOpen`:
- perform **hierarchical merge**:
  1. Use the shared merge planner to merge segments in batches of `maxSegmentsOpen` into intermediate segments (same segment format).
  2. Repeat until remaining segments ≤ `maxSegmentsOpen`.
  3. Final merge streams to artifact writer.

This prevents “too many open files” errors on Windows and some CI environments.

---

## 6. Integration points (exact codebase changes)

> All paths below are relative to repo root.

### 6.1 New modules to add
Create folder: `src/index/build/spimi/`

**Files:**
1. `config.js`
   - `normalizeSpillConfig(raw, { entriesCount, platform, argv })`
2. `spimi-manager.js`
   - `createSpimiManager({ buildRoot, mode, config, log })`
3. `segment-writer.js`
   - `writeTokenSegment({ path, tokenPostingsMap, sortFn, segmentFormat })`
4. `segment-reader.js`
   - `openTokenSegmentIterator(path, { segmentFormat })` → async iterator of `{ token, postingsFlat:number[] }`
5. `segment-merge.js`
   - `mergeTokenSegments(paths, { compareTokens, validateDocOrder })` → async iterator of `{ token, postingsFlat }`
7. `binary-codec.js`
   - `encodeVarint`, `decodeVarint`, `encodeTokenRecord`, `decodeTokenRecord`

Shared helpers (reusable elsewhere; all live under `src/shared/`):
- `src/shared/binary/byte-writer.js` (buffered writer)
- `src/shared/binary/varint.js`
- `src/shared/binary/delta.js` (delta encode/decode for docIds)
- `src/shared/binary/crc32.js` (CRC32C implementation with optional native acceleration via `@aws-crypto/crc32c`)
- `src/shared/merge/merge-planner.js` (hierarchical merge planning for any sharded artifact)
- `src/shared/json-stream/shard-writer.js` (iterable-based JSON shard writer for large arrays)

### 6.2 State extension
In `src/index/build/state.js::createIndexState()`, add:

```js
spimi: null
```

(Do not import SPIMI modules here; attach later in pipeline.)

### 6.3 Attach SPIMI manager at pipeline start
In `src/index/build/indexer/pipeline.js` (or wherever `createIndexState()` is called per mode):

- After state creation and runtime config is resolved:
  - `state.spimi = createSpimiManager(...)` if spill enabled.

### 6.4 Make ordered appender support async file-result handling
In `src/index/build/indexer/steps/process-files/ordered.js`:

Change:

```js
handleFileResult(entry.result, state, entry.shardMeta);
```

To:

```js
await handleFileResult(entry.result, state, entry.shardMeta);
```

And ensure `flush()` remains `async` and awaits handle completion.

### 6.5 Make `appendChunkWithRetention` async and SPIMI-aware
In `src/index/build/indexer/steps/postings.js`:

- Change `appendChunkWithRetention` to `async`.
- Capture chunk stats (see 6.6) and inform SPIMI.
- Periodically call `await stateRef.spimi.maybeFlush(stateRef, delta)`.

### 6.6 Have `appendChunk` return a delta (no extra work)
In `src/index/build/state.js::appendChunk(...)`, after `freq` is computed:

Add:

```js
const delta = {
  chunkId,
  uniqueTokens: freq.size,
  tokenPairsAdded: freq.size,        // 1 posting per unique token
  tokenCount: tokens.length
};
...
return delta;
```

And update callers accordingly.

> This avoids expensive heap polling and makes flush decisions deterministic and testable.

### 6.7 SPIMI manager behavior (precise semantics)

#### 6.7.1 Interface
`SpimiManager` exposes:

- `enabledFor(type) -> boolean`
- `noteDelta(delta)` (updates counters)
- `maybeFlush(state, deltaOrNull, { force=false, reason })`
- `finalize(state)` (forces last flush; waits for writes)
- `createMergedTokenStream()` (returns async iterator `{ token, postings }` suitable for artifact writer)
- `cleanup()` (rm -rf segment dir unless keepSegments)

#### 6.7.2 Flush trigger
Flush is triggered when:
- **Hard cap**: `heapUsed >= heapLimitBytes * maxHeapFraction`, OR
- **Soft cap**: `estimatedBlockBytes >= blockTargetMb * MB` AND `chunksSinceFlush >= minChunksPerBlock`

Where:
- `estimatedBlockBytes = tokenPairsSinceFlush * BYTES_PER_PAIR_EST + uniqueTokensSinceFlush * BYTES_PER_TERM_EST`
- defaults:
  - `BYTES_PER_PAIR_EST = 24` (docId/tf array entry overhead estimate)
  - `BYTES_PER_TERM_EST = 80` (string + map entry overhead estimate)

> Estimators are intentionally conservative; correctness does not depend on precision.
> Heap checks are sampled every `checkEveryChunks` to avoid per-chunk `process.memoryUsage()` overhead.
> Soft cap should not flush tiny blocks; only override `minChunksPerBlock` when hard cap is reached.

#### 6.7.3 Rotation + write queue
On flush:
1. Rotate immediately:
   - `rotated = state.tokenPostings`
   - `state.tokenPostings = new Map()`
2. Enqueue `rotated` for writing.
3. If queued blocks exceed `maxBufferedBlocks`, `await` the oldest write before continuing.
4. Segment writing runs with concurrency `maxInFlightWrites`.

This keeps indexing mostly CPU-bound until disk becomes bottleneck.

---

## 6.8 Documentation + JSDoc requirements

### Docs/specs to add or update
- `docs/specs/spimi-spill.md` (new): end-to-end spill design, config, invariants, and binary format summary.
- `docs/contracts/indexing.md` (update): add SPIMI spill stage and streaming token postings path.
- `docs/contracts/artifact-contract.md` (update): token postings shard/meta expectations remain unchanged; note streaming writer.
- `docs/contracts/artifact-schemas.md` (update): confirm `token_postings_meta` schema compatibility for streamed shards.
- `docs/specs/index-refs-and-snapshots.md` (update): note `.spimi/` temp dir is build-only and not part of index snapshots.
- `docs/config/schema.json` + `docs/config/contract.md` + `docs/config/inventory.*` (update): add `indexing.postings.spill.*` keys, defaults, and examples.
- `docs/guides/commands.md` (update): document spill config and debug `segmentFormat` usage.
- `docs/testing/truth-table.md` (update): note spill behavior and perf-lane expectations.
- `docs/testing/test-decomposition-regrouping.md` (update): add streaming shard writer expectations for token postings.
- `docs/dependency_references/` (optional): mention `@aws-crypto/crc32c` as an optional acceleration dependency.

### JSDoc guidance (required for new/shared modules)
All new modules in `src/shared/` and `src/index/build/spimi/` must include JSDoc that covers:
- Purpose and high-level behavior.
- Performance characteristics (streaming vs buffering, expected complexity).
- Input/return types and constraints (e.g., token ordering, flat postings format).
- Error behavior (what throws vs returns errors).
- Side effects (files written, temp dirs, cleanup behavior).
- Determinism constraints (ordering, stable output guarantees).

At minimum, each exported function should include:
- `@param` and `@returns` with concrete shapes.
- Explicit invariants (e.g., “postingsFlat is `[docId, tf, ...]`”).
- Noted edge cases (empty segments, CRC mismatch, malformed tokens).

---

## 7. Artifact writing (streaming mode)

### 7.1 New “streaming token postings” path
Modify `src/index/build/artifacts/token-postings.js::enqueueTokenPostingsArtifacts()` to support:

- `postings.tokenPostingsStream` (async iterator of `{ token, postingsFlat }`), OR
- `postings.tokenVocab` + `postings.tokenPostingsList` (current behavior)

**Streaming mode rules:**
- Force sharded output (`token_postings.shards`) always.
- Build shards incrementally:
  - use the shared iterable-based shard writer so `vocab` and `postings` arrays are streamed without building large arrays
  - convert `postingsFlat` → nested `[[docId, tf], ...]` only for the current shard
  - write shard file via the shared shard writer (compression supported)
- Track `vocabCount` during streaming, and write meta at end.
- `postings.tokenVocabCount` must be set for metrics/logging compatibility.

### 7.2 Changes to resolve plan
In `resolveTokenPostingsPlan(...)`:
- If `postings.tokenPostingsStream` exists:
  - set `tokenPostingsUseShards = true`
  - skip size estimation (unknown up front)
  - require `postings.tokenVocabCount` to be provided by the stream consumer

### 7.3 Logging and metrics compatibility
Update any references to `postings.tokenVocab.length` (e.g., `artifacts.js`, `metrics.js`) to use:

- `postings.tokenVocabCount` if present
- else `postings.tokenVocab.length`

---

## 8. Defensive edge cases (and required behavior)

### 8.1 Token pathologies
- **Unicode** (emoji, RTL, combining marks): must roundtrip via JSON properly.
- **Control chars**: JSON escaping must prevent invalid NDJSON.
- **Extremely long tokens** (e.g., base64 blobs): segment writer must not build enormous strings beyond the token itself.
  - Optional guard: `indexing.tokenizer.maxTokenLength` (if not already enforced) or a spill-local max.

### 8.2 Huge chunks / enormous unique token count
A single chunk can produce a huge `freq` map (e.g., minified JS, log lines with unique IDs).

Defensive measures (v1):
- Add optional caps (default off to preserve semantics):
  - `indexing.postings.spill.maxUniqueTokensPerChunk` (e.g., 200_000)
  - `indexing.postings.spill.maxTokensPerChunk` (e.g., 2_000_000)
- If exceeded:
  - truncate by sampling (stable sampling: keep first N unique tokens in encounter order)
  - record warning + metrics

### 8.3 Disk failures / low space
- Any write failure must abort indexing with a clear error.
- Segment writes must be atomic; incomplete temp files must be removed on error.

### 8.4 Too many segments
- Hierarchical merge must kick in automatically when segments exceed `maxSegmentsOpen`.

### 8.5 Abort / cancellation
If `abortSignal` is triggered:
- stop scheduling new flushes
- attempt to drain/close streams
- cleanup segment directory (best effort)

### 8.6 Crash recovery
If a build is interrupted:
- segments are under `buildRoot/.spimi/<mode>/<buildId>` and won’t contaminate future builds
- cleanup runs on next build start by removing prior `.spimi/<mode>` unless `keepSegments`

---

## 9. Performance/throughput techniques (beyond baseline)

### 9.1 Immediate wins (implement alongside v1)
1. **Rotate + async write queue** (already required): overlaps IO with CPU.
2. **Binary segments by default**: eliminate JSON parse/stringify overhead in merge.
3. **Buffered byte writer**: large chunked writes reduce syscalls and GC churn.
4. **k-way merge streaming into shard writer**: never materialize global vocab list.
5. **DocId-range fast concat**: avoid per-token sorting in merge.
6. **Streaming JSON shard emission**: use iterables in `writeJsonObjectFile` to avoid large arrays.
7. **Optional background compaction**: begin hierarchical merges while indexing continues if segment count grows rapidly.
8. **CRC32C acceleration (optional)**: use hardware-accelerated CRC32C when available for segment integrity checks.

### 9.2 Expert-level enhancements (optional, v1.1+)

#### 9.2.1 Token dictionary + ID postings
Objective: reduce string/map overhead by replacing token strings with integer IDs per segment.
Touchpoints:
- `src/index/build/spimi/segment-writer.js`
- `src/index/build/spimi/segment-reader.js`
- `src/index/build/spimi/segment-merge.js`
- New: `src/shared/binary/token-dict.js`
Tasks:
- Build a per-segment token dictionary `{ token -> id }` in sorted token order.
- Write dictionary as a separate segment section or companion file.
- Store postings as `(tokenId, postings)` pairs.
- Merge by tokenId and map back to token strings during shard writing.
Tests:
- `tests/unit/spimi/token-dict-roundtrip.unit.test.js`
- `tests/unit/spimi/token-dict-merge-order.unit.test.js`
- `tests/unit/spimi/token-dict-compat.unit.test.js` (dictionary + postings yields identical artifacts)

#### 9.2.2 Front-coded token compression
Objective: reduce token storage size and IO using prefix compression.
Touchpoints:
- `src/index/build/spimi/segment-writer.js`
- `src/index/build/spimi/segment-reader.js`
- New: `src/shared/binary/frontcode.js`
Tasks:
- Encode tokens in blocks with restart points (e.g., every 16 tokens).
- Store prefix length + suffix bytes per token.
- Decode lazily during merge to avoid full token materialization.
Tests:
- `tests/unit/spimi/frontcode-roundtrip.unit.test.js`
- `tests/unit/spimi/frontcode-ordering.unit.test.js` (ordering preserved)

#### 9.2.3 Flat postings buffers
Objective: avoid per-posting array allocation by using flat typed arrays with offsets.
Touchpoints:
- `src/index/build/state.js`
- `src/index/build/postings.js`
- `src/index/build/spimi/segment-writer.js`
- New: `src/shared/binary/postings-buffer.js`
Tasks:
- Store postings in a flat buffer `[docId, tf, ...]` with per-token offsets.
- Update `normalizeTfPostingList` to accept flat buffer format.
- Ensure segment writer consumes the flat format without conversion.
Tests:
- `tests/unit/spimi/flat-postings-buffer.unit.test.js`
- `tests/unit/spimi/flat-postings-to-json-shard.unit.test.js`

#### 9.2.4 Worker-thread merge + write
Objective: reduce GC pauses in the main indexer by offloading merge + shard writing.
Touchpoints:
- `src/index/build/spimi/spimi-manager.js`
- `src/shared/worker/worker-pool.js` or new worker helper
- New: `src/index/build/spimi/merge-worker.js`
Tasks:
- Serialize merge plan + segment paths to a worker.
- Worker produces shard files and meta, then returns summary.
- Main thread waits only for final completion or errors.
Tests:
- `tests/unit/spimi/merge-worker-smoke.unit.test.js`
- `tests/unit/spimi/merge-worker-error-propagation.unit.test.js`

#### 9.2.5 Adaptive flush sizing
Objective: dynamically tune block size to maximize throughput without hitting heap limits.
Touchpoints:
- `src/index/build/spimi/spimi-manager.js`
Tasks:
- Track heap headroom and recent GC pressure.
- Increase `blockTargetMb` when headroom is high; reduce when pressure increases.
- Clamp to configured min/max.
Tests:
- `tests/unit/spimi/adaptive-flush-sizing.unit.test.js`

#### 9.2.6 Background compaction during indexing
Objective: reduce end-of-build merge tail by compacting segments as they accumulate.
Touchpoints:
- `src/index/build/spimi/spimi-manager.js`
- `src/shared/merge/merge-planner.js`
Tasks:
- Trigger compaction when segment count crosses a threshold.
- Run compaction at low priority to avoid starving indexing.
- Ensure compaction is cancelable on abort.
Tests:
- `tests/unit/spimi/background-compaction.unit.test.js`

#### 9.2.7 Large, reusable IO buffers
Objective: reduce syscall overhead and allocation churn for segment IO.
Touchpoints:
- `src/shared/binary/byte-writer.js`
- `src/index/build/spimi/segment-reader.js`
Tasks:
- Use reusable 256KB–1MB buffers for write and read.
- Expose buffer size tuning in config for benchmarking.
Tests:
- `tests/unit/spimi/buffer-reuse.unit.test.js`

#### 9.2.8 Uncompressed segments by default
Objective: maximize throughput by avoiding compression unless disk is the bottleneck.
Touchpoints:
- `src/index/build/spimi/config.js`
- `src/index/build/spimi/segment-writer.js`
- `src/index/build/spimi/segment-reader.js`
Tasks:
- Default to uncompressed binary segments.
- Add an opt-in compression flag for experimentation.
Tests:
- `tests/unit/spimi/segment-compression-flag.unit.test.js`

### 9.3 NDJSON debug fallback (optional)
Binary is the default v1 format. NDJSON remains as a debug-only fallback:
- use `spill.segmentFormat: "ndjson"` for troubleshooting
- NDJSON is slower and larger; do not use in production by default

### 9.4 Optional “flat postings in memory”
Today: `postings.push([docId, tf])` allocates a tiny array per posting.
Optional improvement:
- store `postings` as flat array: `[docId, tf, docId, tf, ...]`
- requires changes in `buildPostings.normalizeTfPostingList()` and artifact writing conversion.

This is a separate performance task, but SPIMI already benefits from writing flat arrays to disk.

### 9.5 Optional pruning for extreme df tokens (semantic change)
For some use-cases, dropping very high document-frequency tokens (like stopwords) can improve both performance and quality.
If enabled:
- `spill.dropIfDfAboveFraction` (e.g., 0.8) applied at merge time
- must be **off by default** because it changes results

---

## 10. Testing plan (defensive, implementation-oriented)

All tests should run in CI deterministically; memory-sensitive tests go into perf lane.

### 10.1 Unit tests (fast, deterministic)

#### A) Segment writer/reader roundtrip
File: `tests/unit/spimi/segment-roundtrip.unit.test.js`

- Write a binary segment from a synthetic `Map<string, [[docId,tf],...]>`.
- Read it back via iterator.
- Assert:
  - tokens sorted
  - postings identical
  - handles tokens with quotes, backslashes, unicode, and control chars

#### B) Merge correctness (token-level)
File: `tests/unit/spimi/merge-two-segments.unit.test.js`

- Build two segments with overlapping terms.
- Merge and assert:
  - global token order
  - postings concatenation preserves docId order
  - postings content matches expected

#### C) Hierarchical merge planner
File: `tests/unit/spimi/hierarchical-merge-plan.unit.test.js`

- Given N segment paths > maxOpen:
  - assert merge plan produces intermediate merges
  - final stage ≤ maxOpen

#### D) Flush policy determinism
File: `tests/unit/spimi/flush-policy.unit.test.js`

- Configure `blockTargetMb` extremely small and `checkEveryChunks=1`.
- Append synthetic deltas; ensure flush triggers exactly when expected.

#### E) Config normalization (spill)
File: `tests/unit/spimi/spill-config.unit.test.js`

- Verify `enabled: "auto"` resolves correctly for small and large repos.
- Ensure `segmentFormat` defaults to `binary`.

#### F) Binary codec (varint + delta)
File: `tests/unit/spimi/binary-codec.unit.test.js`

- Roundtrip varints and delta-encoded docId streams.
- Assert error on malformed encodings.

#### G) CRC32C correctness
File: `tests/unit/spimi/crc32c.unit.test.js`

- Validate CRC32C against known test vectors.
- Ensure fallback and native paths match results.

#### H) Streaming shard writer
File: `tests/unit/spimi/shard-writer-streaming.unit.test.js`

- Emit shards from iterables without building large arrays.
- Validate shard JSON schema and part boundaries.

#### I) Segment header range validation
File: `tests/unit/spimi/segment-header-range.unit.test.js`

- Ensure merge rejects out-of-order `chunkIdStart/chunkIdEnd` when validation is enabled.

#### J) Byte writer buffering
File: `tests/unit/spimi/byte-writer-buffering.unit.test.js`

- Verify buffered writer flushes in chunk-sized writes and preserves data integrity.

#### K) Backpressure queue enforcement
File: `tests/unit/spimi/flush-backpressure.unit.test.js`

- Ensure `maxBufferedBlocks` and `maxInFlightWrites` are enforced deterministically.

#### L) Segment write failure cleanup
File: `tests/unit/spimi/segment-write-failure.unit.test.js`

- Simulate a write error and verify temp files are cleaned and error surfaces.

#### M) Abort handling cleanup
File: `tests/unit/spimi/abort-cleanup.unit.test.js`

- Trigger abort during flush and confirm segment dir cleanup and no orphaned writers.

#### N) Metrics emission
File: `tests/unit/spimi/metrics-emission.unit.test.js`

- Ensure `spimi.*` metrics are recorded when spill is enabled.

#### O) Logging format
File: `tests/unit/spimi/logging-format.unit.test.js`

- Validate flush and merge log lines include reason, ranges, and throughput fields.

#### P) Streaming postings artifact path
File: `tests/unit/spimi/streaming-artifacts.unit.test.js`

- Build shards from `tokenPostingsStream` and verify `token_postings.meta.json` and shard parts are schema-valid.

### 10.2 Integration tests (end-to-end equivalence)

#### E) Baseline vs SPIMI equivalence (golden)
File: `tests/unit/spimi/e2e-equivalence.unit.test.js`

- Generate synthetic “chunks” with controlled token distributions.
- Path 1: current in-memory postings build (`buildPostings`) + artifact write.
- Path 2: SPIMI spill + streaming artifact write.
- Read both `token_postings.meta.json` + shards; reconstruct full vocab/postings and deep-compare.

This test is the primary correctness guarantee.

### 10.3 Fuzz/property tests (weird edge cases)
File: `tests/unit/spimi/fuzz-tokens.unit.test.js`

Generate random tokens including:
- empty strings, whitespace-only, very long strings (bounded), unicode surrogates, separators `\u0001`, newline `\n`, `\r`
Generate random chunk postings with random flush boundaries. Assert:
- roundtrip/merge invariants
- no crashes
- output stable across runs (seeded RNG)

### 10.4 Regression tests for chunk pathologies
File: `tests/unit/spimi/huge-chunk.unit.test.js`

- One chunk with extremely high unique token count (bounded for CI).
- Ensure:
  - flush still works
  - segment writer does not allocate catastrophically
  - optional per-chunk caps behave as configured (if enabled)

### 10.5 Perf lane tests (non-deterministic, optional)
File: `tests/perf/spimi-memory-bounded.perf.test.js`

- Spawn a child Node process with `--max-old-space-size=256`.
- Generate many chunks to exceed baseline memory.
- Assert spill-enabled completes successfully and writes artifacts.

---

## 11. Observability and diagnostics (must-have)

### 11.1 Logging
On each flush:
- reason (`soft-target`, `hard-heap`, `finalize`)
- chunkId range in block
- `tokenPairsSinceFlush`, `uniqueTokensInBlock`
- heapUsed/heapLimit at time of flush
- segment file size + write duration

On merge:
- segment count
- whether hierarchical merge used
- throughput: tokens/sec and bytes/sec

### 11.2 Metrics
Extend `src/index/build/artifacts/metrics.js` to record:
- `spimi.segmentsWritten`
- `spimi.totalSegmentBytes`
- `spimi.mergeMs`
- `spimi.flushMsTotal`
- `spimi.maxInFlightBlocksObserved`

---

## 12. Acceptance criteria (implementation checklist)

1. Indexing Swift repo completes under default heap limits on Windows without `--max-old-space-size` tuning.
2. Output `token_postings` artifacts are byte-for-byte stable (or structurally identical) compared to baseline for small repos.
3. All unit + integration tests pass.
4. No unbounded buffering:
   - ordered appender backpressure remains correct with async handler
   - flush queue caps are enforced
5. Hierarchical merge prevents “too many open files” on Windows.
6. Binary segments are the default; NDJSON is debug-only.
7. All required docs/specs and JSDoc updates are complete and reviewed.

---

## 13. Implementation order (recommended)

1. Add SPIMI modules + config normalization.
2. Make ordered appender async-safe.
3. Add `appendChunk` delta return + plumb through `appendChunkWithRetention`.
4. Implement rotate + async segment writes (binary).
5. Implement merge iterator + hierarchical merge.
6. Implement streaming shard writer in `token-postings.js`.
7. Add equivalence integration test.
8. Add fuzz + edge tests.
9. Instrumentation/logging.

---

## Appendix A: Pseudocode skeletons

### A.1 SpimiManager.flush()
```js
async flush(state, reason) {
  if (state.tokenPostings.size === 0) return;

  const rotated = state.tokenPostings;
  state.tokenPostings = new Map();
  const segPath = nextSegmentPath();

  const writeJob = async () => {
    await writeTokenSegment({ path: segPath, tokenPostingsMap: rotated });
  };

  enqueueWrite(writeJob); // concurrency-limited queue

  // Hard memory bound: prevent accumulating many rotated blocks.
  while (queuedBlocksCount > config.maxBufferedBlocks) {
    await waitForOldestWriteToFinish();
  }

  recordSegmentMeta(segPath, reason, ...);
}
```

### A.2 Streaming shard writer
```js
for await (const { token, postingsFlat } of postings.tokenPostingsStream) {
  vocab.push(token);
  postings.push(flatToNested(postingsFlat));
  if (vocab.length === shardSize) await writeShard(vocab, postings);
}
if (vocab.length) await writeShard(vocab, postings);
await writeMeta({ vocabCount, parts, docLengths, avgDocLen, ... });
```

---

**End of specification.**
