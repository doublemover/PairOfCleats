# Spec -- Graph Impact Analysis (Active Contract)

**Status:** Active implemented contract v1.0
**Last audited:** 2026-05-21
**Roadmap area:** Graph-powered product features; current status is tracked in `docs/roadmap.md`.
**Implementation anchors:** `src/graph/impact.js`, `src/graph/neighborhood.js`,
`src/integrations/tooling/impact.js`, `src/retrieval/output/graph-impact.js`, and
`tools/analysis/impact.js`.
**Authoritative schema:** `GRAPH_IMPACT_SCHEMA` in `src/contracts/schemas/analysis/graph.js`.
**Primary goal:** Provide deterministic, bounded impact analysis ("blast radius") using stable graph node identities and witness paths when available.

---

## 0. Non-negotiable properties

1. **Witness-path output**: Every impacted result attempts to include a stable witness path; if the path is unavailable, the result is marked `partial`.
2. **Deterministic**: Stable ordering and stable path selection given identical inputs.
3. **Bounded**: Explicit caps on graph traversal, number of paths, and output size.
4. **Evidence-rich**: Paths must reference callsite/import/usage evidence where available.
5. **Confidence-scored**: Impacted nodes carry confidence when the graph layer can provide it.
6. **Fail-closed on contract mismatch** through schema validation in the CLI.

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
- Current CLI/runtime support is `upstream` or `downstream`. A combined `both`
  mode would be a future extension and is not part of the active contract.

The implementation maps `downstream` to outbound graph traversal and `upstream`
to inbound graph traversal after graph artifacts have been normalized.

---

## 2. Output Contract

### 2.1 GraphImpact

```json
{
  "version": "1.0.0",
  "seed": { "type": "file", "path": "src/index.js" },
  "direction": "downstream",
  "depth": 2,
  "impacted": [ { "...": "ImpactedNode" } ],
  "truncation": [ { "...": "TruncationRecord" } ],
  "warnings": [ { "...": "WarningRecord" } ],
  "provenance": { "...": "Provenance" },
  "stats": { "...": "ImpactStats" }
}
```

### 2.2 ImpactedNode

Each impacted node is a graph node with distance and optional witness-path evidence.

```json
{
  "ref": { "type": "chunk", "chunkUid": "xxh64:..." },
  "distance": 1,
  "confidence": 0.85,
  "witnessPath": { "...": "WitnessPath" },
  "partial": false
}
```

**Invariants**
- `ref` uses the shared node-reference schema: chunk, symbol, or file.
- `distance` is required and stable for identical graph inputs.
- `witnessPath` follows `witnessPathSchema` when available.
- `partial=true` means the node was impacted but no complete witness path survived caps or artifact availability.

---

## 3. Request Contract

```ts
type ImpactRequest = {
  repo?: string;
  seed?: string;
  changed?: string | string[];
  changedFile?: string;
  direction: "downstream" | "upstream";
  depth: number;
  edgeTypes?: string;
  maxDepth?: number;
  maxFanoutPerNode?: number;
  maxNodes?: number;
  maxEdges?: number;
  maxPaths?: number;
  maxCandidates?: number;
  maxWorkUnits?: number;
  maxWallClockMs?: number;
  json?: boolean;
};
```

---

## 4. Graph model requirements

Impact analysis requires a normalized graph layer:
- Graph artifacts should be loaded via `GraphStore` when available, and may use `graph_relations_csr` for traversal acceleration.
  CSR must be validated (ordering/offsets/bounds) and fall back to `graph_relations` on invalid payloads to preserve correctness.
- When a prebuilt `graphIndex` is supplied, callers should omit raw `graphRelations` to preserve cache reuse (some graphIndex variants
  store a trimmed graphRelations representation when CSR is enabled).

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

## 5. Algorithm

### 5.1 Seed resolution

- `--seed` is parsed with `parseSeedRef()` and takes precedence.
- `--changed` / `--changed-file` are normalized to a deterministic changed-set
  seed envelope when no explicit seed is provided.
- Empty changed sets fail with `ERR_EMPTY_CHANGED_SET`.

### 5.2 Graph traversal

- `buildGraphNeighborhood()` performs bounded traversal over the selected graph
  artifacts.
- `direction=upstream` traverses inbound edges; `direction=downstream` traverses
  outbound edges.
- `includePaths=true` requests witness paths for impacted nodes.

### 5.3 Output selection

- Nodes at distance `0` are seeds and are excluded from `impacted`.
- Impacted nodes are sorted by the shared graph-node comparator.
- The best stable witness path for each impacted node is selected with
  `compareWitnessPaths()`.

---

## 6. CLI

`pairofcleats impact --repo <path> --seed <symbolId|chunkUid|file> --direction downstream --depth <n> --json`

Flags:
- `--seed <symbolId|chunkUid|file>`
- `--changed <path>` / `--changed-file <path>`
- `--edge-types call,usage,import`
- `--max-paths N`
- graph cap flags from `buildGraphCliOptions()`, including max depth, nodes,
  edges, candidates, work units, and wall-clock milliseconds.

There is no dedicated MCP graph-impact tool in the current MCP catalog.

---

## 7. Observability

Record in `stats`:
- visited nodes
- explored edges
- dropped edges by reason (`ambiguous`, `unresolved`, `budget`)
- path counts
- time per stage
- traversal cap trigger counts (fanout/nodes/edges/paths/work-budget) and import graph lookup miss counts
- traversal cache markers when results are reused for identical `(seed/filter/caps/indexSignature)` requests

---

## 8. Contract Coverage

- `tests/retrieval/graph/impact-analysis-contract-matrix.test.js`
- `tests/retrieval/graph/impact-analysis-empty-changed-set-error.test.js`
- `tests/retrieval/graph/impact-analysis-changed-set-iterable.test.js`
- `tests/tooling/impact/seed-and-changed-behavior.test.js`
- `tests/shared/contracts/analysis-schemas-validate.test.js`

---

## 9. Implementation Touchpoints

- `src/graph/impact.js`: seed resolution, traversal orchestration, GraphImpact payload construction.
- `src/graph/neighborhood.js`: bounded graph traversal and witness-path collection.
- `src/integrations/tooling/impact.js`: CLI argument handling and schema validation.
- `src/retrieval/output/graph-impact.js`: human output rendering.
- `tools/analysis/impact.js`: CLI wrapper.

Non-goals (v1):
- No full semantic diffing (that's Phase 14 snapshot diffing)
- No "rename detection" beyond SCM and symbol identity (Phase 12/13+)
