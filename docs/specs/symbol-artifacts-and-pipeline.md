# Phase 9 Spec -- Symbol Artifacts and Cross-File Linking Pipeline

## Goal
Produce a **validated, queryable** symbol substrate that eliminates name-based collisions and makes cross-file linking reproducible.

This spec defines:
- artifact schemas
- build pipeline integration points
- strict validation gates
- migration behavior

## Artifacts (public surface)

### 1) `symbols.jsonl`
One record per unique symbol identity.

**Schema (v1)**
```json
{
  "v": 1,
  "symbolId": "sym1:heur:...",
  "scopedId": "sid:v1:...",
  "symbolKey": "sk:v1:...",
  "qualifiedName": "A.B.foo",
  "kindGroup": "function|class|...",
  "file": "src/foo.ts",
  "virtualPath": "src/foo.ts",
  "chunkUid": "ck64:...",
  "scheme": "heur|scip|lsif",
  "signatureKey": "sig:sha1:...",
  "segmentUid": "seg:...",
  "lang": "typescript|javascript|...",
  "kind": "Function|Class|...",
  "name": "foo",
  "signature": "function foo(...)",
  "extensions": { "any": "extra fields" }
}
```

**Notes**
- `v`, `symbolId`, `scopedId`, `symbolKey`, `qualifiedName`, `kindGroup`, `file`,
  `virtualPath`, and `chunkUid` are required.
- Additional fields are optional and may be trimmed when oversized rows are emitted.

### 2) `symbol_occurrences.jsonl`
One record per occurrence.

**Schema (v1)**
```json
{
  "v": 1,
  "host": { "file": "src/foo.ts", "chunkUid": "ck64:..." },
  "role": "definition|reference|call|import|usage",
  "ref": {
    "v": 1,
    "targetName": "Foo.bar",
    "kindHint": "function",
    "importHint": { "moduleSpecifier": "./bar", "resolvedFile": "src/bar.ts" },
    "status": "resolved|ambiguous|unresolved",
    "resolved": { "symbolId": "sym1:heur:...", "chunkUid": "ck64:..." },
    "candidates": [
      { "symbolId": "sym1:heur:...", "chunkUid": "ck64:...", "symbolKey": "sk:v1:...", "kindGroup": "function", "signatureKey": "sig:..." }
    ]
  },
  "range": { "start": 111, "end": 114 }
}
```

**SymbolRef notes**
- `targetName`, `status`, `resolved`, and `candidates` are required.
- Each candidate must include `symbolId`, `chunkUid`, `symbolKey`, and `kindGroup`.

### 3) `symbol_edges.jsonl`
One record per edge.

**Schema (v1)**
```json
{
  "v": 1,
  "type": "call|usage|import|dataflow|symbol",
  "from": { "file": "src/a.ts", "chunkUid": "ck64:..." },
  "to": { "...": "SymbolRef (see above)" },
  "confidence": 0.0,
  "reason": "import-context"
}
```

**Rules**
- Symbol edges always carry a `SymbolRef` in `to` (including ambiguous/unresolved refs).
- `confidence` and `reason` are optional but should be provided when available.

## Build pipeline integration (minimal set)
Phase 9 should not create a new "parallel pipeline." It should consume existing outputs and upgrade joins.

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
- `tests/indexing/identity/identity-symbolkey-scopedid.test.js`
- `tests/indexing/identity/symbol-identity.test.js`

### Services tests
- `tests/indexing/artifacts/symbols/symbol-artifacts-emission.test.js`
- `tests/indexing/artifacts/symbols/symbol-edges-ambiguous.test.js`
- `tests/indexing/artifacts/symbols/symbol-links-by-chunkuid.test.js`
- `tests/indexing/validate/symbol-integrity-strict.test.js`
- `tests/indexing/determinism/symbol-artifact-order.test.js`
- `tests/indexing/determinism/symbol-artifact-determinism.test.js`
