# Spec: VFS hash routing (draft)

Status: Draft (Milestone A). Optional extension to VFS routing.

Goal: deterministically shard VFS disk paths and token URIs to avoid huge directories, reduce path length pressure, and provide stable routing for tooling providers.

Non-goals:
- Change `vfs_manifest` schema or `virtualPath` format.
- Change `docHash` definition (still xxh64 of segment text).
- Replace provider routing rules.

---

## 1) Concepts

- `virtualPath`: canonical `.poc-vfs/...` path (see `docs/specs/vfs-manifest-artifact.md`).
- `docHash`: `xxh64:<hex16>` for the virtual document text.
- `routingKey`: string used to derive routing token.
- `routingToken`: `xxh64(routingKey)` in lowercase hex (no prefix).
- `routingPrefix`: fanout path derived from `routingToken`.

---

## 2) Configuration (current)

```json
{
  "tooling": {
    "vfs": {
      "hashRouting": false
    }
  }
}
```

When `hashRouting` is `true`, tooling virtual documents MAY use a content-addressed path:

```
.poc-vfs/by-hash/<docHash><effectiveExt>
```

Notes:
- `hashRouting` does **not** change `vfs_manifest.virtualPath`. The manifest remains the canonical, human-readable path (see `vfs-manifest-artifact.md`).
- Producers MUST fall back to the legacy `.poc-vfs/<containerPath>#seg:<segmentUid>` path if `docHash` is missing.
- When hash routing is enabled, producers SHOULD emit `vfs_path_map` to link legacy `virtualPath` to the hash path.

---

## 3) Hash path derivation (normative)

```
hashVirtualPath = ".poc-vfs/by-hash/" + docHash + effectiveExt
```

`docHash` MUST be `xxh64:<hex16>` and MUST be the exact VFS doc hash.

---

## 4) Optional future expansion (non-normative)

Future versions MAY add a routing token and prefix fanout (e.g., `xxh64(routingKey)` with prefix bytes) to reduce directory fanout.

---

## 5) Invariants

- Same inputs MUST yield the same `routingToken` and `routingPrefix`.
- `routingToken` MUST be lowercase hex, 16 characters for xxh64.
- Hash routing MUST NOT change `virtualPath` stored in `vfs_manifest` or `vfs_index`.

---

## 6) Observability

Emit counters:
- `vfs_hash_routing_mode`
- `vfs_hash_routing_prefix_bytes`
- `vfs_hash_routing_fallbacks`

---

## 7) Related specs

- `docs/specs/vfs-token-uris.md`
- `docs/specs/vfs-cold-start-cache.md`
- `docs/specs/vfs-io-batching.md`
