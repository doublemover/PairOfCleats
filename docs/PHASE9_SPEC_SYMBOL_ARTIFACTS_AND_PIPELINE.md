# Phase 9 Spec — Symbol Artifacts and Cross-File Linking Pipeline

## Goal
Produce a **validated, queryable** symbol substrate that eliminates name-based collisions and makes cross-file linking reproducible.

This spec defines:
- artifact schemas
- build pipeline integration points
- strict validation gates
- migration behavior

## Artifacts (public surface)

### 1) `symbols.jsonl`
One record per unique `scopedId`.

**Schema (v1)**
```json
{
  "scopedId": "scoped:...",
  "symbolKey": "symk:...",
  "symbolId": "scip:...|lsif:...|heur:...",
  "kind": "function|class|...",
  "languageId": "typescript|javascript|...",
  "file": "src/foo.ts",
  "segmentUid": "segu:..." ,
  "range": { "start": 123, "end": 456, "startLine": 10, "endLine": 20 },
  "name": "foo",
  "qualifiedName": "A.B.foo",
  "signatureKey": "sig:sha1:...",
  "chunkUid": "chunk:...",
  "confidence": 0.0,
  "sources": ["native|tooling|scip|lsif"],
  "evidence": { "doc": "optional short snippet", "callable": true }
}
```

**Notes**
- `range.start/end` are UTF-16 code unit offsets, half-open.
- `confidence` is required; producers should emit low confidence rather than omit.
- `chunkUid` is required so symbol → chunk lookup is always possible.

### 2) `symbol_occurrences.jsonl`
One record per occurrence.

**Schema (v1)**
```json
{
  "occurrenceId": "occ:sha1:...",
  "scopedId": "scoped:...",
  "symbolId": "scip:...|lsif:...|heur:...",
  "file": "src/foo.ts",
  "segmentUid": "segu:...",
  "range": { "start": 111, "end": 114, "startLine": 12, "endLine": 12 },
  "role": "definition|reference|callsite|import",
  "context": { "containerScopedId": "scoped:...", "importSpec": "./bar" },
  "evidence": { "snippet": "optional short snippet" }
}
```

### 3) `symbol_edges.jsonl`
One record per edge.

**Schema (v1)**
```json
{
  "edgeId": "edge:sha1:...",
  "type": "call|usage|import|dataflow",
  "sourceScopedId": "scoped:...",
  "targetScopedId": "scoped:...",
  "status": "resolved|ambiguous|unresolved",
  "candidates": [
    { "targetScopedId": "scoped:...", "confidence": 0.0, "reason": "import-context" }
  ],
  "evidence": {
    "callsite": { "file": "src/a.ts", "range": { "start": 1, "end": 2 } },
    "import": { "specifier": "./x" }
  }
}
```

**Rules**
- If `status !== "resolved"`, the edge must still be emitted (unless explicitly configured off) so metrics and debugging are possible.
- If `status === "unresolved"`, `targetScopedId` may be null, but `candidates` may exist.

## Build pipeline integration (minimal set)
Phase 9 should not create a new “parallel pipeline.” It should consume existing outputs and upgrade joins.

### Inputs
- Chunk records with finalized `metaV2` and stable `chunkUid`.
- Relations outputs (callLinks/usageLinks) and (when available) callsite artifacts from Phase 6.

### Producers
1. **Native symbol extractor**:
   - Uses chunk metadata (name/kind/range) to emit baseline `symbols.jsonl` with `heur:` SymbolIds.
2. **Tool-ingested symbol enhancer** (optional):
   - Consumes SCIP/LSIF ingest artifacts (tools already exist) and fills `symbolId` when resolvable.

### Resolution engine
- Uses import graph + effective language + segment identity to narrow candidates.
- Emits edges with explicit `status`.

## Strict validation gates
Strict validation must verify:
- uniqueness of `scopedId`
- endpoint integrity for edges
- occurrence range bounds
- manifest discoverability for symbol artifacts

## Tests (required)
### Unit tests
- `tests/unit/identity-symbolkey-scopedid.test.js`
  - stable output for stable inputs
  - collision disambiguation is deterministic

### Services tests
- `tests/services/symbol-artifacts-emission.test.js`
  - build fixture index, assert all three artifacts exist and validate
- `tests/services/symbol-edges-ambiguous.test.js`
  - fixture with two same-named symbols; assert `status: ambiguous` and both candidates present
- `tests/validate/symbol-integrity-strict.test.js`
  - tamper symbol edge endpoint; strict validate fails
