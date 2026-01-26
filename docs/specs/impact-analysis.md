# Spec -- Impact Analysis Paths (Refined, Implementation-Ready)

**Status:** Draft / implementation-ready  
**Phase:** GigaRoadmap Phase 11 -- Graph-powered product features  
**Primary goal:** Provide deterministic, explainable impact analysis ("blast radius") using SymbolId-keyed graphs and evidence-rich paths.

---

## 0. Non-negotiable properties

1. **Path-first output**: Every "impacted" result must include at least one path from seed → impacted.
2. **Deterministic**: Stable ordering and stable path selection given identical inputs.
3. **Bounded**: Explicit caps on graph traversal, number of paths, and output size.
4. **Evidence-rich**: Paths must reference callsite/import/usage evidence where available.
5. **Confidence-scored**: Each path has a confidence score derived from evidence completeness and link strength.
6. **Fail-closed on contract mismatch** in strict mode.

---

## 1. Definitions

### 1.1 ChangeSeed

Represents "what changed":
- a symbol (preferred) or a chunk or a file/module.

```ts
type ChangeSeed =
  | { kind: "symbol", symbolId: string }
  | { kind: "chunk", chunkUid: string }
  | { kind: "file", fileRelPath: string };
```

### 1.2 ImpactDirection

- `downstream`: callers/users depend on the seed (who breaks if seed changes)
- `upstream`: dependencies of the seed (what seed relies on)
- `both`

Note: For call edges, "downstream" means "callers of seed", i.e., reverse traversal. This is a common confusion; lock it explicitly.

---

## 2. Output contract

### 2.1 ImpactReport

```json
{
  "formatVersion": 1,
  "schema": "ImpactReport",
  "schemaVersion": "1.0.0",
  "indexSignature": "...",
  "createdAt": "...",
  "request": { "...": "ImpactRequest" },
  "seed": { "...": "ChangeSeedResolved" },
  "paths": [ { "...": "ImpactPath" } ],
  "summary": { "...": "ImpactSummary" },
  "stats": { "...": "ImpactStats" }
}
```

### 2.2 ImpactPath

Each path is a sequence of nodes connected by edges.

```json
{
  "pathId": "sha256:....",
  "direction": "downstream",
  "score": 0.77,
  "scoreBreakdown": {
    "evidence": 0.6,
    "distance": 0.2,
    "edgeWeights": 0.2
  },
  "hops": [
    {
      "from": { "symbolId": "...", "chunkUid": "...", "fileRelPath": "...", "lines": {"start":10,"end":12} },
      "edge": { "type": "call", "evidenceId": "callsite:...", "confidence": 0.85 },
      "to":   { "symbolId": "...", "chunkUid": "...", "fileRelPath": "...", "lines": {"start":30,"end":55} }
    }
  ],
  "impacted": {
    "kind": "symbol",
    "symbolId": "...",
    "chunkUid": "...",
    "fileRelPath": "..."
  },
  "why": {
    "impactReason": "call-chain",
    "explainRefs": [ "evidence:...", "graph:..." ]
  }
}
```

**Invariants**
- `pathId` must be stable: computed from normalized hop list.
- Each hop must include either an evidenceId or a `evidenceMissing:true` marker with a reason.

---

## 3. ImpactRequest contract

```ts
type ImpactRequest = {
  repoId: string;
  indexRoot: string;
  indexSignature: string;

  seed: ChangeSeed;

  direction: "downstream" | "upstream" | "both";
  edgeTypes: Array<"call"|"usage"|"import"|"export"|"dataflow">;

  maxDepth: number;              // default 4; hard max 8
  maxPaths: number;              // default 200; hard max 5000
  maxPathsPerImpacted: number;   // default 3; hard max 20
  maxImpacted: number;           // default 100; hard max 2000

  strictness: "strict" | "warn" | "loose";
  includeExplain: boolean;

  /** path selection policy */
  policy: {
    preferEvidenceRich: boolean;       // default true
    preferShorterPaths: boolean;       // default true
    allowAmbiguousEdges: boolean;      // default false in strict/warn, true in loose
    includeUnresolvedCandidates: boolean; // default false
  };

  /** output shaping */
  output: {
    includeSnippets: boolean;        // default true
    snippetMaxBytes: number;         // default 2048; hard max 16384
    groupBy: "file"|"symbol"|"none"; // default "symbol"
  };
};
```

---

## 4. Graph model requirements

Impact analysis requires a normalized graph layer:

### 4.1 Node identity
- Prefer `symbolId`
- Fallback `chunkUid`
- File nodes may exist for import/export graphs (`fileRelPath`)

### 4.2 Edge contract

```ts
type Edge = {
  type: "call"|"usage"|"import"|"export"|"dataflow";
  fromId: string;     // symbolId or chunkUid
  toId: string;
  evidenceId?: string;
  confidence?: number;
  // For ambiguous resolution:
  resolution?: { status: "resolved"|"ambiguous"|"unresolved", candidates?: string[] };
};
```

**Critical rule:** If `resolution.status !== "resolved"` and `allowAmbiguousEdges=false`, the traversal must ignore the edge (but record a dropped-edge stat).

---

## 5. Algorithms

### 5.1 Graph traversal

Use bounded BFS/beam search depending on `preferEvidenceRich`:

- Default: BFS with a priority queue where priority favors:
  1) higher evidence confidence
  2) shorter distance
  3) stable tie-break

### 5.2 Path generation

- Generate candidate paths up to `maxDepth`.
- De-duplicate by `impactedId` and by `pathId`.
- Keep top `maxPathsPerImpacted` paths per impacted target by score.

### 5.3 Scoring

Recommended scoring components:

- `distanceScore = 1 / (1 + hops)`
- `evidenceScore = geometricMean(edge.confidence || fallback)` across hops
  - fallback confidence:
    - resolved edge w/o evidence: 0.55
    - ambiguous edge: 0.30
    - unresolved edge: 0.0 (must be excluded unless loose)
- `edgeWeightScore`: configurable weights per edge type:
  - call: 1.0, usage: 0.8, import: 0.6, export: 0.6, dataflow: 1.0

Final:
`score = clamp01( 0.45*evidenceScore + 0.35*distanceScore + 0.20*edgeWeightScore )`

### 5.4 Output selection

- Select impacted results as:
  - top impacted nodes by best path score
  - stable tie-breakers:
    - bestPath.score desc
    - bestPath.hops asc
    - impacted.fileRelPath
    - impacted.symbolId/chunkUid

---

## 6. CLI + MCP

### 6.1 CLI

`pairofcleats impact --repo <path> --seed <symbolId|chunkUid|file> --direction downstream --json --explain`

Flags:
- `--seed-symbol <symbolId>`
- `--seed-chunk <chunkUid>`
- `--seed-file <relPath>`
- `--edge-types call,usage,import`
- `--max-depth N`
- `--max-impacted N`
- `--max-paths N`
- `--strict|--warn|--loose`

### 6.2 MCP

Tool: `impact.analyze`
- Inputs: `ImpactRequest` (minus local-only `indexRoot`)
- Output: `ImpactReport`

---

## 7. Observability

Record in `stats`:
- visited nodes
- explored edges
- dropped edges by reason (`ambiguous`, `unresolved`, `budget`)
- path counts
- time per stage

---

## 8. Tests (must be implemented)

### 8.1 Unit tests
- stable `pathId` computation
- scoring determinism
- ambiguity gating behavior

### 8.2 Integration tests
Fixture repo:
- A calls B calls C
- D imports A
- E references B (usage)
Cases:
- downstream from B includes A and D via call/import edges
- upstream from B includes C via call edges
- ambiguous edge case (two candidates) is excluded in strict and included in loose

Golden snapshot:
- canonicalize report JSON and compare.

---

## 9. Implementation checklist

Minimum modules:
- `src/retrieval/impact/` (new): graph traversal, scoring, output shaping
- `src/shared/explain/` (shared with context packs)
- `src/shared/artifact-io.js` for optional artifact write/read
- CLI wiring under `src/retrieval/cli/*`
- MCP tool wiring

Non-goals (v1):
- No full semantic diffing (that's Phase 14 snapshot diffing)
- No "rename detection" beyond SCM and symbol identity (Phase 12/13+)
