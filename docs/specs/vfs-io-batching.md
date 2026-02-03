# Spec: VFS IO batching (draft)

Status: Draft (Milestone A). Optional performance layer.

Goal: reduce disk IO churn when writing VFS-backed documents and avoid excessive parallel writes during tooling runs.

Non-goals:
- Change VFS content or `docHash` semantics.
- Replace artifact IO paths.

---

## 1) Batching model

A VFS IO batcher collects pending writes and flushes them with bounded concurrency.

Each queued entry:

```ts
type VfsIoWriteRequest = {
  path: string;
  text: string;
  docHash: string | null;
  bytes: number;
};
```

Rules:
- Requests are keyed by `path`.
- If multiple writes target the same `path` in one batch, the last write wins.
- Flush when `maxBatchBytes` or `flushIntervalMs` is reached.
- Concurrency is capped by `maxInflight`.

---

## 2) Configuration (draft)

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

`writeMode`:
- `atomic`: write temp file + rename.
- `direct`: write directly to final path.

---

## 3) Determinism

- The final on-disk content MUST match the result of sequential `ensureVfsDiskDocument` calls.
- Coalescing MUST be deterministic (last write in order wins).

---

## 4) Failure handling

- If a batch write fails, retry that entry individually once.
- If retry fails, log a warning and continue (do not corrupt existing disk cache).

---

## 5) Observability

Emit counters:
- `vfs_io_batches`
- `vfs_io_bytes`
- `vfs_io_coalesced`

---

## 6) Related specs

- `docs/specs/vfs-cold-start-cache.md`
- `docs/specs/vfs-hash-routing.md`
