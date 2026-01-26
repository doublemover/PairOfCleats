# Phase 8 — Canonical Identity + Symbol Reference Contracts (Refined)

> **Status:** Draft spec (implementation-oriented)  
> **Scope:** PairOfCleats Phase 8 workstreams that need collision-safe joining and deterministic tooling outputs.  
> **Primary audience:** Codex / implementation agents and reviewers.

---

## 1. Problem statement

Several subsystems currently perform cross-file (and cross-provider) joins using keys like:

- `file::name` (collision-prone; same name in different scopes, overloads, methods)
- “chunkId” used inconsistently to mean:
  - **build-local** numeric document index (`chunk.id` / `chunk_meta.id`)
  - **range-hash** string identifier (`metaV2.chunkId`)

This creates silent correctness failures (wrong joins) and makes caching / graph features unstable across rebuilds.

This spec defines a **tiered identity system** that is:

- **Deterministic:** same input → same IDs
- **Collision-safe:** collisions are detected and represented explicitly
- **Stable-ish across rebuilds:** “line-shift only” edits should not churn IDs (for stable UI/graph/caches)
- **Audit-friendly:** every join key can be traced back to a chunk/file/range

---

## 2. Glossary

- **Container file**: the physical repo file on disk (e.g., `docs/guide.md`, `src/app.vue`).
- **Segment**: an embedded-language region discovered within a container file (e.g., fenced code block in Markdown; `<script>` in Vue).
- **Virtual document**: the synthetic, tooling-facing file representing a segment (or a whole file) used by providers (TS/LSP).
- **Chunk**: a unit of indexing (span) derived from a container file or segment.

---

## 3. Identity primitives

### 3.1 `docId` (build-local integer)

**Definition:**  
`docId: number` is the build-local index used for postings arrays and `chunk_meta.id`.

**Properties**
- Unique **within a single build output** and mode.
- Not stable across rebuilds (ordering can change if files/chunks added/removed).

**Source of truth**
- In-memory: `chunk.id`
- Artifacts: `chunk_meta[].id` (and any postings maps keyed by docId)

**Allowed usage**
- Internal arrays/maps within the same build.
- Storage backends (SQLite / shards) where docId is the primary row key.

**Disallowed usage**
- Cross-build caches.
- Graph node IDs exposed to users.
- Cross-provider joins unless combined with stable identity fields.

---

### 3.2 `chunkId` (range-specific deterministic string)

**Definition:**  
`chunkId: string` is a deterministic identifier for a specific **file+segment+span**. It is *range-specific*: changes to offsets or other hashed inputs will change the value.

**Canonical form**
- Current codebase: `chunk_<sha1(...)>` computed by `buildChunkId(...)`.

**Inputs (current implementation)**
- `file` (repo-relative, POSIX)
- `segmentId` (or `''`)
- `start`, `end` (byte offsets within container file)
- `kind`
- `name` (note: name churn will churn chunkId if included)

**Properties**
- Deterministic within a given content state.
- Can churn on “line-shift only” edits (because start/end change).
- Useful as a **span anchor** and debugging handle.

**Allowed usage**
- Debugging references (logs, diagnostics).
- Intra-build joins when `chunkUid` is unavailable (should be rare).
- Mapping from tool results that are range-addressed.

**Disallowed usage**
- Primary key for cross-build caches/graphs.
- De-duplication keys across different builds.

---

### 3.3 `chunkUid` (stable-ish identifier for graphs/UI/caches)

**Definition:**  
`chunkUid: string` is the canonical stable-ish identity for a chunk used in:

- graph nodes
- tooling cache keys
- multi-provider merging
- retrieval outputs that must remain stable across rebuilds

It is designed to remain unchanged when the **chunk span text is unchanged**, even if offsets move.

#### 3.3.1 Algorithm (v1)

All hashes are **xxHash64** (hex, 16 chars) using the existing backend selection (`native` preferred, `wasm` fallback).

Let:

- `containerRelPath`: repo-relative path with `/` separators.
- `segmentId`: `''` if none.
- `chunkText`: the exact chunk text as indexed (same bytes used for tokenization / embedding).
- `start`, `end`: container offsets (used only to pick context windows, not stored in the final string).

Compute:

1. `spanHash = xxh64(chunkText)`
2. `preContext = text.slice(max(0, start-64), start)`
3. `postContext = text.slice(end, min(text.length, end+64))`
4. `preHash  = xxh64(preContext)`
5. `postHash = xxh64(postContext)`
6. `raw = containerRelPath + '\0' + segmentId + '\0' + spanHash + '\0' + preHash + '\0' + postHash`
7. `uidHash = xxh64(raw)`

**Canonical string form**
- `chunkUid = "cu:v1:xxh64:" + uidHash`

#### 3.3.2 Collision handling

Collisions are extremely unlikely but must be handled deterministically.

**Collision scope**
- Detect collisions **within the same `{containerRelPath, segmentId}` scope**.

**Required behavior**
- If two chunks produce the same `chunkUid`:
  - Choose a deterministic stable order by `(start, end, kind, name, docId)` and assign:
    - winner keeps `chunkUid`
    - others become `chunkUid + ":c" + <index>` (e.g., `...:c1`, `...:c2`)
  - Record in metadata:
    - `collisionOf: <baseChunkUid>` for non-winners.

**Fail-closed**
- After normalization/adapters, **`chunkUid` MUST be non-empty** for every chunk record.
- Index builds and SQLite ingestion MUST reject rows missing `chunkUid`.

---

## 4. Persisted fields and artifacts

### 4.1 `metaV2` required fields (additive)

For every chunk record, `metaV2` MUST include:

- `chunkId: string` (range-specific)
- `chunkUid: string` (stable-ish)
- `chunkUidAlgoVersion: "v1"`
- `spanHash: "xxh64:<hex16>"` (or store as `{ algo, value }`; choose one and standardize)
- `preHash: "xxh64:<hex16>"`
- `postHash: "xxh64:<hex16>"`
- `collisionOf?: string` (present only when this chunkUid is a disambiguated collision)

**Note:** If you choose the `"cu:v1:xxh64:<hex>"` format for `chunkUid`, you may store `spanHash/preHash/postHash` as raw `hex16` strings (without prefixes) to reduce size. The schema must be explicit either way.

### 4.2 Mapping artifacts (recommended)

To support consumers that only have docId or only have chunkUid, emit a JSONL mapping artifact:

`chunk_uid_map.jsonl` (or sharded)

Each line:

```json
{
  "docId": 123,
  "chunkUid": "cu:v1:xxh64:8dd7c1f0c6e3a1b2",
  "chunkId": "chunk_0a12...sha1",
  "file": "src/foo.ts",
  "segmentId": "md:fence:3",
  "start": 1200,
  "end": 1520
}
```

**Rules**
- Exactly one row per docId.
- Deterministic output order: sort by `docId` ascending (or by `file, segmentId, start` if docId not stable across backends—choose one and test-lock it).

---

## 5. Symbol identity

### 5.1 Overview

Chunks are spans; symbols are semantic entities (functions, classes, methods, types). A chunk may:

- define a symbol
- reference a symbol
- contain multiple symbols (rare, but possible)

To support graph construction and cross-file linking without collisions, we introduce:

- `symbolKey`: stable grouping key (signature-free by default)
- `signatureKey`: optional signature disambiguator
- `scopedId`: unique identity (derived)
- `symbolId` (“SymbolId”): tool-derived global identity when available

### 5.2 `symbolKey` (stable grouping key)

**Definition:**  
A stable, signature-free key that represents a symbol-like entity across rebuilds. It may represent an overload set.

**Canonical form**
- `symbolKey = "sk:v1:" + sha1(namespaceKey + "|" + virtualPath + "|" + kind + "|" + qualifiedName)`

Where:
- `namespaceKey`: optional namespacing string; if not available, use `repoId` or `""` (but keep the field).
- `virtualPath`: the tooling virtual document path (segment-aware).
- `kind`: e.g., `function`, `method`, `class`, `interface`, `type`, `enum`, `variable`.
- `qualifiedName`: a scope chain string (e.g., `Foo.bar.baz`).

**Important: what NOT to include**
- Do not include offsets/ranges.
- Do not include raw signatures by default.

### 5.3 `signatureKey` (optional disambiguator)

**Definition:**  
A stable hash of a normalized signature string when available.

**Canonical form**
- `signatureKey = "sig:v1:sha1:" + sha1(normalizedSignature)`

**Normalization (baseline)**
- Trim.
- Collapse whitespace to single spaces.
- Remove inline comments.
- For TS/JS: normalize `function foo(a: string): number` into a canonical one-line signature (provider-specific optional improvements allowed, but must be test-locked).

### 5.4 `scopedId` (unique disambiguated identity)

**Definition:**  
A unique identity for a specific symbol instance, built from `symbolKey` plus disambiguators.

**Canonical form**
- `scopedId = "sid:v1:sha1:" + sha1(symbolKey + "|" + (signatureKey||"") + "|" + (containerKey||""))`

`containerKey` is optional and only used when required to disambiguate repeated same-name constructs in the same scope.

### 5.5 `symbolId` (preferred semantic identifier)

**Definition:**  
A globally meaningful semantic identity when available from tooling ecosystems.

**Allowed prefixes**
- `scip:` — SCIP semantic IDs
- `lsif:` — LSIF IDs
- `lsp:` — LSP server supplied IDs (only when stable and documented)
- `heur:` — heuristic fallback (must include version tag)

**Fallback policy**
1. If tool-provided semantic ID exists → use it (`scip:`/`lsif:`/`lsp:`).
2. Else use `heur:` + `scopedId` (unique).
3. Else last resort use `heur:chunkUid:<chunkUid>` (unique, chunk-backed).

---

## 6. Canonical reference envelope

Any subsystem that references a symbol MUST use a structured envelope rather than raw strings.

### 6.1 `ChunkRef`

```ts
export type ChunkRef = {
  docId: number;              // build-local
  chunkUid: string;           // stable-ish
  chunkId: string;            // range-specific
  file: string;               // container relpath (POSIX)
  segmentId?: string | null;  // null/undefined if none
  range?: { start: number; end: number }; // container offsets (optional but recommended)
};
```

### 6.2 `SymbolRef`

```ts
export type SymbolRef = {
  symbolId?: string | null;     // preferred semantic ID (scip/lsif/lsp) or heur fallback
  scopedId?: string | null;     // unique derived id (heuristic)
  symbolKey: string;            // stable grouping key
  signatureKey?: string | null; // optional
  kind?: string | null;
  qualifiedName?: string | null;
  languageId?: string | null;

  // Anchor evidence (for debugging and optional disambiguation)
  definingChunk?: ChunkRef | null;
  evidence?: {
    scheme: 'scip'|'lsif'|'lsp'|'heuristic-v1'|'chunkUid';
    confidence: 'high'|'medium'|'low';
    notes?: string;
  };
};
```

### 6.3 Unresolved/ambiguous references

If resolution is not unique, do **not** guess.

Represent the target as:

```json
{
  "resolution": {
    "status": "ambiguous",
    "candidates": [
      { "symbolKey": "...", "scopedId": "...", "symbolId": null },
      { "symbolKey": "...", "scopedId": "...", "symbolId": null }
    ],
    "reason": "multiple same-name candidates in file"
  }
}
```

---

## 7. Join precedence rules (mandatory)

When joining symbol-like entities across subsystems:

1. If both sides have `symbolId` with a known semantic prefix → join on `symbolId`.
2. Else if both sides have `scopedId` → join on `scopedId`.
3. Else join on `symbolKey` **only if**:
   - the consumer explicitly accepts overload-set grouping, and
   - ambiguity is surfaced (multiple targets allowed).

When joining chunk-like entities:

1. Join on `chunkUid` whenever available.
2. Else join on `{file, segmentId, chunkId}` (range-specific).
3. `docId` MUST NOT be used alone for cross-system joins unless the systems share the same build context.

---

## 8. Implementation notes (grounded in current code)

### 8.1 Current locations to integrate

- `src/index/build/file-processor.js`
  - Has `ctext` (chunkText) and access to full file `text` and `c.start/c.end`. This is the optimal place to compute `spanHash/preHash/postHash` and `chunkUid`.
- `src/shared/hash.js`
  - Has `checksumString()` using xxhash64 backend selection.
- `src/index/metadata-v2.js`
  - Must persist `chunkUid` + supporting hash fields into `metaV2`.
- `src/index/validate.js`
  - Extend strict validation to fail when chunkUid missing/empty and to report collisions.

### 8.2 Compatibility adapters

Until all consumers are migrated:
- Accept legacy maps keyed by `file::name` or `chunkId`, but normalize to `chunkUid` using:
  - in-memory `ChunkRef` maps built during a run, or
  - `chunk_uid_map.jsonl` when loading artifacts.

---

## 9. Acceptance tests (exact, implementation-ready)

Create tests (names are suggestions; align with repo conventions):

1. `tests/identity/chunkuid-stability-lineshift.test.js`
   - Build fixture, record all `chunkUid`.
   - Insert text above chunks without changing chunk spans.
   - Rebuild and assert `chunkUid` unchanged for unchanged spans.

2. `tests/identity/chunkuid-collision-disambiguation.test.js`
   - Create fixture with two identical spans in same file+segment and identical context windows.
   - Assert collision detected and `collisionOf` recorded; chunkUid disambiguated deterministically.

3. `tests/identity/symbolref-envelope-required.test.js`
   - Ensure any emitted symbol edges/occurrences use `SymbolRef` object, not raw strings.

4. `tests/identity/join-precedence.test.js`
   - Construct fake symbol refs with symbolId/scopedId/symbolKey and assert join policy.

---

## 10. Non-goals (for Phase 8)

- Full semantic symbol IDs (SCIP/LSIF) for every language.
- Perfect scope resolution for all nested constructs.
- Cross-repo federated namespaces (can be added later via `namespaceKey`).

Phase 8 must still:
- eliminate silent `file::name` collisions,
- preserve ambiguity explicitly,
- provide stable-ish chunk identities for graphs/caches.

