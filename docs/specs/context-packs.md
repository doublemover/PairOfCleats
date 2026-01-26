# Spec -- Graph-Backed Context Packs (Refined, Implementation-Ready)

**Status:** Draft / implementation-ready  
**Phase:** GigaRoadmap Phase 11 -- Graph-powered product features  
**Primary goal:** Deterministic, evidence-rich, bounded "context bundles" assembled using graph neighborhoods (calls/usages/imports/dataflow) and exposed consistently across CLI, MCP, and any API/server surfaces.

---

## 0. Non-negotiable properties

1. **Deterministic outputs**
   - Given identical inputs (repo, index build root, query options), a context pack must be **bit-for-bit stable** after canonical JSON normalization.
2. **Bounded computation**
   - All expansion steps are capped by explicit budgets (tokens/bytes, hops, edges, records).
3. **Explainability**
   - Every included item has a structured explanation: why it was included, what edge/path caused inclusion, and what evidence supports it.
4. **Contract-stable identifiers**
   - Pack contents are keyed by **SymbolId** where available; **chunkUid** is required as the universal fallback identity. Never key by `file::name`.
5. **Artifact-backed (cacheable)**
   - Packs are materializable as artifacts for reproducibility, caching, and offline analysis.
6. **Provider neutrality**
   - Packs must be buildable and consumable regardless of backend (JSONL artifacts, SQLite, LMDB), as long as they can load the canonical Graph Layer and Chunk Records.

---

## 1. Definitions

### 1.1 Inputs

- **IndexRoot**: A build output directory containing:
  - `chunk_meta` (JSON/JSONL/sharded) and manifests
  - Graph artifacts (calls/usages/imports/dataflow/exports)
  - Optional: callsite evidence artifacts, risk flows, contracts, etc.

- **Seed Set**: The initial set of candidates produced by retrieval (lexical/postings/FTS/vector/hybrid).
  - Seeds are always represented as canonical `ChunkRecord` objects plus a score vector.

- **Graph Layer**: A normalized, versioned set of node/edge tables keyed by stable IDs.
  - Nodes are either Symbol nodes or Chunk nodes.
  - Edges include types: `call`, `usage`, `import`, `export`, `dataflow`.

### 1.2 Output: ContextPack

A ContextPack is a deterministic bundle of context items organized into sections, with explicit budgets and explain data.

**Top-level shape (JSON):**
```json
{
  "formatVersion": 1,
  "schema": "ContextPack",
  "schemaVersion": "1.0.0",
  "indexSignature": "<string>",
  "packId": "<stable id>",
  "createdAt": "<iso>",
  "request": { "...": "PackRequest" },
  "budgets": { "...": "BudgetsResolved" },
  "seeds": [ "...SeedEntry" ],
  "sections": [ "...ContextSection" ],
  "explain": { "...": "ExplainEnvelope" },
  "stats": { "...": "ContextPackStats" }
}
```

### 1.3 Stable IDs

- **symbolId**: canonical graph identity (preferred)
- **chunkUid**: universal stable-ish chunk identity (required for all items)
- **docId**: build-local integer; NEVER used for cross-surface identity in packs

---

## 2. PackRequest contract

A pack is computed using an explicit request object.

```ts
type PackRequest = {
  /** required; for cache keys + explain */
  repoId: string;
  indexRoot: string;        // resolved root, not exposed to remote clients
  indexSignature: string;   // stable signature for this index snapshot

  /** seeds */
  query: string;
  seedMode: "code" | "prose" | "mixed";
  seedProvider: "sparse" | "fts" | "ann" | "hybrid";

  /** context intent */
  intent: "answer" | "summarize" | "refactor" | "debug" | "impact" | "contract";
  focus: {
    /** one of */
    symbolId?: string;
    chunkUid?: string;
    fileRelPath?: string;
  };

  /** expansion controls */
  expansion: {
    maxHops: number;             // default 2; hard max 4
    edgeTypes: Array<"call"|"usage"|"import"|"export"|"dataflow">;
    direction: "out"|"in"|"both"; // call edges: out=callee, in=caller
    includeSameFileNeighbors: boolean;
    includeImports: boolean;
    includeExports: boolean;
    includeDataflow: boolean;

    /** evidence requirements */
    requireEvidence: boolean;    // if true, drop edges without evidence in strict mode
    evidenceKinds: Array<"callsite"|"identifier"|"importStmt"|"span"|"tooling">;
  };

  /** budgets */
  budgets: {
    maxTotalChars: number;       // output shaping boundary
    maxTotalTokens: number;      // token budget for LLM contexts
    maxItems: number;            // global cap across all sections
    maxItemsPerSection: number;  // per-section cap
    maxBytesPerItem: number;     // cap for the text excerpt per item
  };

  /** sorting + determinism */
  ordering: {
    primary: "seedScore"|"graphDistance"|"graphEvidence"|"hybridScore";
    stableTieBreakers: Array<"symbolId"|"chunkUid"|"fileRelPath"|"startLine">;
  };

  /** flags */
  strictness: "strict"|"warn"|"loose";
  includeExplain: boolean; // if true include explain envelope
};
```

### Default values
- `maxHops = 2`, `edgeTypes = ["call","usage","import"]`, `direction = "both"`
- Budgets: `maxItems = 80`, `maxItemsPerSection = 25`, `maxBytesPerItem = 4096`, `maxTotalChars = 200_000`
- `strictness = "warn"`, `includeExplain = true`

**Hard caps (must be enforced regardless of config):**
- `maxHops <= 4`
- `maxItems <= 250`
- `maxItemsPerSection <= 80`
- `maxBytesPerItem <= 64_000`
- `maxTotalChars <= 2_000_000`

---

## 3. Section model

A pack contains ordered sections; each section has its own cap and inclusion rules.

### 3.1 Section types (fixed set)

1. `seeds` -- the seed hits (top-N) with minimal excerpts
2. `callers` -- upstream call graph neighbors
3. `callees` -- downstream call graph neighbors
4. `imports` -- modules imported by seeds (resolved to in-repo where possible)
5. `exports` -- exports of seed modules and their consumers
6. `usages` -- symbol usages (references)
7. `dataflow` -- dataflow neighbors where available (optional)
8. `tests` -- related test files/symbols (heuristic + graph)
9. `docs` -- related prose docs (prose mode or mixed)
10. `related` -- fallback neighborhood expansion when graph sparse

### 3.2 ContextItem contract

```json
{
  "kind": "chunk" | "symbol",
  "symbolId": "scip:..." ,
  "chunkUid": "xxh64:...",
  "fileRelPath": "src/...",
  "range": { "start": 123, "end": 456 },                // UTF-16 code unit half-open
  "lines": { "start": 10, "end": 25 },                  // optional convenience
  "languageId": "typescript",
  "title": "function foo(...)",
  "excerpt": {
    "text": "....",
    "truncated": true,
    "truncation": { "maxBytes": 4096, "reason": "maxBytesPerItem" }
  },
  "scores": {
    "seedScore": 0.73,
    "graphDistance": 1,
    "evidenceScore": 0.55,
    "hybridScore": 0.69
  },
  "why": {
    "rule": "call-neighbor",
    "path": [ { "edgeType":"call", "from":"...", "to":"...", "evidenceId":"..." } ],
    "evidence": [ { "kind":"callsite", "evidenceId":"...", "confidence":0.8 } ]
  }
}
```

**Key invariants**
- `chunkUid` is mandatory.
- `range` offsets are UTF-16 code unit offsets and are half-open `[start,end)`.
- If `symbolId` is absent, `kind="chunk"` and `chunkUid` is the primary ID.
- `excerpt.text` MUST be derived from canonical chunk text (not from reading the file again unless chunk text isn't stored).

---

## 4. Algorithms

### 4.1 High-level flow

1. Load **Seeds**
2. Resolve each seed to canonical identifiers `{symbolId?, chunkUid, fileRelPath, range}`
3. Build initial section `seeds` (bounded)
4. Expand via graph walks (bounded)
5. Score candidates + stable ordering
6. Allocate into sections with per-section budgets
7. Produce `ContextPack` + `ExplainEnvelope` and stats

### 4.2 Candidate generation

For each seed item:
- Run graph expansion up to `maxHops` using allowed edge types and direction.
- Collect candidate nodes with:
  - shortest path length
  - evidence references per edge (if present)
  - optional additional signals:
    - "exportedness"
    - risk relevance tags
    - file proximity

**Strictness rules**
- `strict`: drop candidates whose path has missing required evidence (when `requireEvidence=true`)
- `warn`: keep candidates but mark evidence gaps in explain
- `loose`: keep candidates and do not compute evidence gap details

### 4.3 Scoring

Compute:

- `seedScore`: from retrieval
- `graphDistance`: min hops from any seed
- `evidenceScore`: derived from evidence confidence along best path
- `hybridScore`: bounded merge of signals

**Recommended formula**
- `hybridScore = clamp01( 0.70*seedScore + 0.20*distanceScore + 0.10*evidenceScore )`
- `distanceScore = 1 / (1 + graphDistance)` (so hop 1 > hop 2)

Hard rule: do not allow graph-only candidates to outrank strong seeds unless `intent` explicitly requests graph-first behavior (e.g., `impact`).

### 4.4 Stable ordering and tie-breaking

Stable sort keys:
1. primary ordering chosen by request
2. `hybridScore` descending
3. `graphDistance` ascending
4. `fileRelPath` lexicographic
5. `lines.start` ascending (or `range.start`)
6. `chunkUid` lexicographic
7. `symbolId` lexicographic (if present)

---

## 5. Artifact plan

### 5.1 Artifact types

- `context_packs.jsonl` (record-per-pack)
- `context_packs.meta.json` (sharded sidecar if sharded)
- `context_packs.manifest.json` (optional top-level manifest pointer; preferred to reuse main `pieces/manifest.json` entry)

### 5.2 Storage rules

- Packs MUST be keyed by stable `packId` and include the input `PackRequest` in the record for auditability.
- Cache key for pack generation is `sha256(indexSignature + normalized(PackRequest))`.

### 5.3 Sharding policy

- If `context_packs.jsonl` exceeds `maxShardBytes` (default 16-32MB), write sharded JSONL.

---

## 6. Integration surfaces

### 6.1 CLI

Add command:

- `pairofcleats context-pack --repo <path> --query <q> [--intent <...>] [--json] [--explain] [--pack-id <id>]`

Modes:
- `--json`: emit a single `ContextPack` object
- `--write`: write artifact record and print `packId`
- `--read --pack-id`: load existing record

### 6.2 MCP

Tool:
- `context_pack.create`
- `context_pack.get`

Must return stable error codes:
- `POC_E_INDEX_MISSING`
- `POC_E_CONTRACT_VERSION`
- `POC_E_BUDGET_EXCEEDED`
- `POC_E_NOT_SUPPORTED`

---

## 7. Observability

Stats fields:
- counts per section
- dropped candidate counts by reason (`budget`, `noEvidence`, `duplicate`, `unsupported`)
- max hop encountered
- graph traversal timings

---

## 8. Tests (must be implemented)

### 8.1 Unit tests

- Deterministic ordering test: same inputs → identical JSON (canonical stringify)
- Budget enforcement test: ensure caps are enforced exactly at boundaries
- Evidence gap test: strict/warn/loose behavior

### 8.2 Integration tests

- Fixture repo with 3-5 files + known call graph
- Build index once; compute pack twice; assert identical output
- Mutate repo; rebuild; assert `indexSignature` change invalidates cache and new pack differs

### 8.3 Golden snapshot tests

- Store one `ContextPack` JSON snapshot (canonicalized) under `tests/golden/context_pack_v1.json`
- If any change occurs, test should force explicit update with rationale.

---

## 9. Implementation checklist (code touchpoints)

Minimum expected modules (names can vary; do not add drift):
- `src/retrieval/context-packs/` (new): core builder
- `src/shared/explain/` (new or reused): shared explain schema utils
- `src/shared/artifact-io.js`: load/write pack artifacts
- `src/retrieval/pipeline.js`: option plumbing (optional)
- `src/retrieval/cli/*`: CLI wiring
- `tools/mcp/*` or `src/integrations/mcp/*`: MCP tool wiring

---

## 10. Explicit non-goals (v1)

- No attempt at "LLM prompt formatting" beyond stable excerpts. Packs are raw evidence containers.
- No unbounded graph expansions.
- No PageRank/centrality in v1 (can be added later as optional ranking signals).
