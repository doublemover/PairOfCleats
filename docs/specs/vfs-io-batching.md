# Spec: VFS IO batching

Status: Active bounded-provider batching with queued-write coalescing.
Last audited: 2026-05-22
Implementation anchors: `src/integrations/tooling/providers/lsp/vfs-batching.js`.
Contract coverage: `tests/tooling/vfs/io-batch-consistency.test.js`.

Goal: reduce disk IO churn when writing VFS-backed documents and avoid excessive parallel writes during tooling runs.

Non-goals:
- Change VFS content or `docHash` semantics.
- Replace artifact IO paths.

---

## 1) Live batching model

The live implementation batches LSP VFS document materialization/open work with
bounded concurrency and bounded queue length. It preserves document content,
`docHash`, routing identity, and provider-visible ordering while avoiding
unbounded write/open pressure during tooling runs.

Live rules:
- Concurrency is capped by `maxInflight`.
- Queue length is capped by `maxQueueEntries`.
- Pending writes are keyed by final disk path.
- Multiple writes to the same final disk path coalesce before filesystem write;
  the last queued write wins.
- Flushes happen when `maxQueueEntries`, `maxBatchBytes`, or `flushIntervalMs`
  is reached, and always on explicit drain.
- The final on-disk content MUST match the result of sequential document
  materialization for the same input set.

## 1.1) Queued write request

Each queued entry:

```ts
type VfsIoWriteRequest = {
  path: string;
  text: string;
  docHash: string | null;
  bytes: number;
};
```

The final write primitive remains `ensureVfsDiskDocument()`, so doc-hash cache
semantics and safe path resolution stay centralized.

---

## 2) Configuration

```json
{
  "tooling": {
    "vfs": {
      "ioBatching": {
        "enabled": false,
        "maxInflight": 4,
        "maxBatchBytes": 8388608,
        "flushIntervalMs": 25,
        "maxQueueEntries": 5000,
        "writeMode": "atomic"
      }
    }
  }
}
```

`maxInflight`, `maxQueueEntries`, `maxBatchBytes`, and `flushIntervalMs` are
live provider-batching controls.

`writeMode` is normalized as a forward-compatible setting. The active
implementation still writes through `ensureVfsDiskDocument()`.

---

## 3) Determinism

- The final on-disk content MUST match the result of sequential `ensureVfsDiskDocument` calls.
- Coalescing MUST be deterministic (last write in order wins).

### 3.1 Per-language batching expectations (notes)

VFS IO batching is typically paired with per-language tooling batching:

- Work SHOULD be bucketed by `languageId`/`effectiveExt` on the *virtual document* (not container file extension).
- Scheduling MUST preserve deterministic output ordering for any artifacts derived from VFS routing
  (stable `virtualPath` ordering independent of concurrency).

### 3.2 `virtualRange` guardrails (notes)

Tooling targets include a `virtualRange` mapping into virtual document text. Implementations SHOULD:

- Prefer segment-relative offset mapping (`virtual = container - segmentStart`) when segments exist.
- If a caller accidentally supplies already-relative offsets, allow a bounded fallback when it is provably in-range.
- If the mapping is invalid, surface it explicitly (log/telemetry) and avoid silently dropping work.

---

## 4) Failure handling

- If a batch write fails, retry that entry once.
- If retry fails, surface the failure with queued-write warnings attached and do
  not mutate unrelated pending entries or corrupt existing disk cache.

---

## 5) Observability

Queued-write counters to expose in future runtime telemetry:
- `vfs_io_batches`
- `vfs_io_bytes`
- `vfs_io_coalesced`

---

## 5.1) Spill/Merge Integration

When VFS artifacts spill or require merge/compaction, use the shared merge core (`src/shared/merge.js`)
so ordering and cleanup are consistent with other artifact pipelines. This includes merging
`vfs_manifest` spill runs during artifact writes.

Comparator/serializer contract:
- Ordering uses `compareVfsManifestRows` (virtualPath, segment info, hash routing tie-breaks).
- Serialization is JSONL via `stringifyJsonValue` to preserve stable ordering and size checks.

---

## 5.2) Benchmarks + Tests

Benchmarks:
- `tools/bench/merge/merge-core-throughput.js`
- `tools/bench/merge/spill-merge-compare.js`

Tests:
- `tests/indexing/vfs/merge-core-integration.test.js`
- `tests/tooling/vfs/io-batch-consistency.test.js`

---

## 6) Related specs

- `docs/specs/vfs-cold-start-cache.md`
- `docs/specs/vfs-hash-routing.md`
