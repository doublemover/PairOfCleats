# Phase 9 — Migration & backward compatibility (implementation-facing)

This document focuses on **how Phase 9 ships without breaking existing consumers**, while still allowing strict mode to enforce collision-safe identity.

---

## 1) New artifacts are additive (initially)

Phase 9 introduces:
- `symbols`
- `symbol_occurrences`
- `symbol_edges`

These SHOULD be treated as **optional artifacts** at first:
- present in manifest when built
- validated when present
- not required for older indexes to validate in non-strict mode

Touchpoint:
- `src/index/validate/artifacts.js` (optional list)

---

## 2) Graph relations: v1 vs v2

### v1 today
`graph_relations` currently exists and may include edges derived from legacy `file::name` joins.

### v2 goal (Phase 9)
- Nodes and edges MUST prefer `chunkUid` and SymbolRef-derived identity.
- No silent `file::name` fallback in **strict** mode.

**Recommended approach:**
- Keep existing `graph_relations` as-is for compatibility.
- Add a **new graph artifact** or version bump (e.g., `graph_relations` with `version: 2`) built from:
  - `callLinks` / `usageLinks` that carry SymbolRefs
  - only resolved edges (or include ambiguous edges explicitly)

Touchpoints:
- `src/index/build/graphs.js`
- `src/shared/artifact-io/jsonl.js` (required keys for JSONL artifacts)

---

## 3) Map build compatibility

Map build currently derives member IDs from:
- `repo_map` entries, and
- `chunk_meta` (using `file::name` + optional `chunkId` aliasing)

Phase 9 should migrate map IDs to prefer:
1. `metaV2.symbol.symbolId` (or `scopedId`) if present
2. else `metaV2.chunkUid` (stable node identity)
3. else legacy fallback

Touchpoints:
- `src/map/build-map.js`
- `src/map/build-map/symbols.js`

---

## 4) Index validation modes

### Strict mode
Strict mode should:
- enforce `metaV2.chunkUid` correctness (already exists)
- **fail closed** on symbol joins that fall back to `file::name`
- enforce referential integrity for symbol artifacts when they exist

### Non-strict mode
Non-strict should:
- allow older indexes that only have legacy artifacts
- emit warnings when Phase 9 artifacts are missing

Touchpoints:
- `src/index/validate.js`
- `src/index/validate/checks.js`

---

## 5) Deprecation plan (recommended)

Once Phase 9 artifacts are stable:
1) Mark legacy join paths as deprecated:
   - `file::name` edges
   - reliance on `chunkId` for linking
2) After one release cycle:
   - remove legacy joins in strict mode entirely
   - keep read-path compatibility for old indexes if feasible

---

## 6) Operational checklist

- Document the artifact surface change in the manifest.
- Ensure a rollback is safe (older consumers ignore unknown artifacts).
- Add fixtures with same-name collisions to prove “no wrong links”.
