# Phase 9 — Symbol artifacts & pipeline integration (implementation-facing)

> **Source of truth (schemas/contracts):**
> - `docs/specs/symbol-identity-and-symbolref.md`
> - `docs/specs/symbol-artifacts.md`
> - `SPEC_cross-file-symbol-resolution_DRAFT.md` (Phase 9 draft)

This Phase 9 note is about *integration points* in the build pipeline and validator.

---

## What Phase 9 adds (high level)

1) Compute `metaV2.symbol` for definition chunks (collision-safe, deterministic).
2) Emit **three new JSONL artifacts**:
   - `symbols`
   - `symbol_occurrences`
   - `symbol_edges`
3) Ensure strict validation enforces **referential integrity** across:
   - `chunk_meta`
   - `symbols`
   - `symbol_occurrences`
   - `symbol_edges`

---

## Code touchpoints (searchless)

### 1) Where symbol identity is computed
Preferred: compute once during metaV2 assembly.

- `src/index/metadata-v2.js`
  - `buildMetaV2()` is the natural insertion point to attach `metaV2.symbol`.

If implementation needs access to more per-chunk context, compute earlier and pass through:
- `src/index/build/file-processor/assemble.js`
  - `buildChunkPayload()` builds chunk objects before metaV2 is finalized.

### 2) Where artifacts are written
- `src/index/build/artifacts.js`
  - add `enqueueSymbolsArtifacts()`
  - add `enqueueSymbolOccurrencesArtifacts()`
  - add `enqueueSymbolEdgesArtifacts()`

Follow existing sharded JSONL patterns:
- `src/index/build/artifacts/writers/chunk-meta.js` (good reference pattern)

### 3) JSONL required keys + loader helpers
- `src/shared/artifact-io/jsonl.js`
  - extend `JSONL_REQUIRED_KEYS` to include:
    - `symbols`, `symbol_occurrences`, `symbol_edges`

If validator needs loaders:
- `src/shared/artifact-io.js`
  - add `loadSymbols()`, `loadSymbolEdges()`, etc. (optional; validator can stream read as needed)

### 4) Schema registry
- `src/contracts/schemas/artifacts.js`
  - add schema defs + versions for the new artifacts
- `src/shared/artifact-schemas.js`
  - re-export is automatic, but keep it as the stable public import.

### 5) Validator referential integrity checks
- `src/index/validate.js`
  - load/stream the new artifacts when present
  - enforce integrity rules from `docs/specs/symbol-artifacts.md`

Also update:
- `src/index/validate/artifacts.js` optional artifact list (so presence expectations match reality)

---

## Practical implementation rules

### Determinism
- Sort records before writing (see symbol artifacts spec addendum).
- Ensure candidate lists are deterministically ordered.

### Ambiguity preservation
- Do not drop unresolved/ambiguous references.
- Emit SymbolRefs with `state` and `candidates` when applicable.

### Backward compatibility
During migration:
- Keep existing `graph_relations` emission, but ensure it is built from **resolved edges only** (or leave it unchanged and add a v2 variant).

---

## Recommended first-pass validation metrics

Even before deep integrity checks, log:
- counts of `symbols`, `occurrences`, `edges`
- edges by `type` and by `to.state`
- top unresolved `to.name` values
