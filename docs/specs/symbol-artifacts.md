# Spec -- Symbol Artifacts (v1, refined)

Status: Draft  
Depends on:
- Identity Contract (chunkUid / segmentUid)
- Symbol Identity & SymbolRef (symbolKey / scopedId / symbolId)

Primary goal: ship explicit, validated artifacts that allow downstream features to build graphs and context expansions without `file::name` collisions.

---

## 1. Artifact set overview (normative)

The build MUST emit the following JSONL artifacts (shardable):

1. `symbols.jsonl`  
   One row per **symbol instance** (unique by `scopedId`).

2. `symbol_occurrences.jsonl`  
   One row per **definition/reference occurrence**, including unresolved/ambiguous refs.

3. `symbol_edges.jsonl`  
   One row per **relationship edge** (call/usage/import/etc). Edges MUST preserve uncertainty.

Each artifact MUST have:
- a corresponding artifact meta entry in the manifest
- strict validation (referential integrity)

---

## 2. File naming & manifest keys (normative)

### 2.1 Paths
These artifacts follow the project's existing artifact output conventions:
- located under the build output artifact directory (and sharded if enabled)
- each shard is a `.jsonl` part

### 2.2 Manifest keys (recommended)
- `symbols`
- `symbol_occurrences`
- `symbol_edges`

If the project uses `artifact-schemas.js` names, those MUST match exactly.

---

## 3. `symbols.jsonl` schema (normative)

### 3.1 TypeScript shape
```ts
type SymbolRecordV1 = {
  v: 1;

  // Stable IDs
  symbolKey: string;     // symk1:...
  scopedId: string;      // scid1:...
  symbolId: string;      // scip:... OR heur:scid1:...

  // Display & filtering
  qualifiedName: string;
  kindGroup: string;     // function|method|class|module|type|value|unknown
  languageId: string | null;

  // Definition anchor
  virtualPath: string;   // file or file#seg:...
  file: string;          // repo-relative, posix
  chunkUid: string;      // definition chunk
  chunkId?: string | null;   // legacy/debug only

  // Optional extras
  signatureKey?: string | null;
  containerName?: string | null;
  fallbackSymbolId?: string | null;

  // For debugging
  source?: {
    provider?: "chunker" | "scip" | "lsif" | "heuristic";
    confidence?: number | null;
  } | null;
}
```

### 3.2 Validity rules
- `v` MUST equal 1
- (`symbolKey`, `scopedId`, `symbolId`, `chunkUid`, `file`, `qualifiedName`, `kindGroup`) are REQUIRED
- `scopedId` MUST be unique within the file (global uniqueness across artifact)
- `chunkUid` MUST exist in `chunk_meta` for some chunk

### 3.3 Deterministic ordering
Emit in deterministic order:
1. `file` ascending
2. `chunkUid` ascending
3. `qualifiedName` ascending
4. `kindGroup` ascending

---

## 4. `symbol_occurrences.jsonl` schema (normative)

### 4.1 Purpose
Occurrences record where symbols appear, including:
- definitions (the chunk itself)
- references/usages
- call sites (may be unresolved/ambiguous)

### 4.2 TypeScript shape
```ts
type SymbolOccurrenceV1 = {
  v: 1;

  // Where the occurrence is located
  host: {
    file: string;
    chunkUid: string;
    // Optional location precision (future):
    // range?: { startLine:number; startCol:number; endLine:number; endCol:number } | null;
  };

  // What kind of occurrence
  role: "definition" | "reference" | "call" | "usage";

  // The referenced symbol (may be unresolved/ambiguous)
  ref: import("./spec-symbol-identity-and-symbolref").SymbolRefV1;

  // Optional evidence/metadata
  meta?: {
    callerScopedId?: string | null;   // when role is call
    argMap?: Record<string, string> | null;
  } | null;
}
```

### 4.3 Validity rules
- `host.file` and `host.chunkUid` are REQUIRED
- `ref.v` MUST be 1
- If `role === "definition"`, then:
  - `ref.state` MUST be `"resolved"`
  - `ref.scopedId` MUST be present and match the symbol defined by that chunk
- For unresolved/ambiguous refs, `ref.name` MUST still be populated.

### 4.4 Deterministic ordering
Emit in deterministic order:
1. `host.file`
2. `host.chunkUid`
3. `role`
4. `ref.name`
(then stable JSON stringify ordering, see §7.2)

---

## 5. `symbol_edges.jsonl` schema (normative)

### 5.1 Purpose
Edges represent relationships between symbols (or attempted relationships):
- call edges: A calls B
- usage edges: A references B
- import edges: file/module relationships (optional for Phase 9)

Edges MUST retain uncertainty:
- resolved edges include a resolved SymbolRef
- ambiguous/unresolved edges include candidates/reasons

### 5.2 TypeScript shape
```ts
type SymbolEdgeV1 = {
  v: 1;

  type: "call" | "usage" | "import";

  from: {
    file: string;
    chunkUid: string;
    scopedId?: string | null;  // when source chunk corresponds to a symbol
    symbolKey?: string | null;
  };

  to: import("./spec-symbol-identity-and-symbolref").SymbolRefV1;

  confidence?: number | null;  // defaults to to.confidence
  reason?: string | null;

  // Optional call metadata
  call?: {
    argMap?: Record<string, string> | null;
  } | null;
}
```

### 5.3 Validity rules
- `from.file` and `from.chunkUid` REQUIRED
- `to.v === 1` REQUIRED
- If `to.state === "resolved"`, then `to.chunkUid` and `to.scopedId` MUST be present.

### 5.4 Deterministic ordering
Emit in deterministic order:
1. `from.file`
2. `from.chunkUid`
3. `type`
4. `to.name`
5. `to.scopedId` (if present)

---

## 6. Emission rules (normative)

### 6.1 Symbols
For each chunk that is a "definition chunk" (project policy: any chunk with `metaV2.symbol`):
- emit exactly one `SymbolRecordV1` line

### 6.2 Definition occurrences
For each emitted symbol record, also emit one occurrence:
- `role = "definition"`
- `ref.state = "resolved"`
- `ref.scopedId = symbol.scopedId`
- `ref.chunkUid = symbol.chunkUid`
- `ref.name = symbol.qualifiedName`

### 6.3 Reference/call occurrences and edges
For each chunk's `codeRelations.callLinks[]` and `codeRelations.usageLinks[]`:
- emit a `SymbolOccurrenceV1` (role `call` or `usage`)
- emit a `SymbolEdgeV1` of the matching type

Important:
- Do NOT drop unresolved/ambiguous references. Emit them with `to.state` preserved.
- Downstream consumers should filter for `to.state === "resolved"` when they need correctness.

---

## 7. Determinism & encoding requirements

### 7.1 Stable JSON
JSON lines MUST be serialized deterministically:
- stable key order (use a stable stringify helper)
- avoid emitting `undefined` fields

### 7.2 Sharding
If the build uses artifact sharding:
- sharding MUST preserve determinism
- records MUST be assigned to shards based on deterministic partitioning (e.g., file-hash partition) rather than concurrency timing

---

## 8. Strict validation (normative)

Strict validation MUST enforce referential integrity:

1. For every `SymbolRecordV1.chunkUid`:
   - there exists a chunk in `chunk_meta` with `metaV2.chunkUid` equal to it.

2. For every occurrence with `ref.state === "resolved"`:
   - `ref.scopedId` exists in `symbols.jsonl`
   - `ref.chunkUid` exists in `chunk_meta`

3. For every edge with `to.state === "resolved"`:
   - same checks as #2

Validation should also report:
- counts by role/type/state
- top N unresolved names by frequency

Implementation touchpoints:
- `src/shared/artifact-schemas.js` (add schemas)
- `src/index/validate.js` (add cross-artifact checks)

---

## 9. Relationship to existing `graph_relations`

- `graph_relations` MAY remain for compatibility.
- `graph_relations` MUST be rebuilt from `symbol_edges` **resolved edges only** to avoid incorrect links.
- `graph_relations.version` SHOULD bump if node IDs change to `chunkUid`.

---

## 10. Acceptance criteria

This spec is "done" when:
- artifacts exist in the build output and manifest
- strict validation passes on a non-trivial repo
- a same-name collision fixture no longer causes mis-linked edges (resolved edges are correct; ambiguous edges are preserved, not guessed)
