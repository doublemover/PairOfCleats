# Phase 11 Spec — Graph-powered product surfaces (v1)

## Status
**Normative** for Phase 11 implementation work.

This spec uses RFC 2119 keywords (**MUST**, **SHOULD**, **MAY**) to define requirements.

## Scope
This spec defines:

- Shared Phase 11 contract types (NodeRef, truncation, warnings, ordering).
- Input/output contracts for:
- Graph neighborhood packs (“graph context packs”)
- Impact analysis
- Composite context packs (primary excerpt + graph + types + risk)
- Hardened context expansion (post-ranking; optional)
- Graph-aware ranking hooks (opt-in) and explain output additions
- API contracts report (+ optional artifact)
- Architecture boundary checks (rules + report)
- Suggest-tests output

It also defines determinism and cap semantics that apply across all Phase 11 features.

---

## 1) Terminology

- **Seed**: the starting identity for a graph expansion (chunk, symbol, file).
- **Node**: an entity in a graph. In Phase 11, nodes are typed (`chunk`, `symbol`, `file`).
- **Edge**: a directed relationship between nodes (call/import/usage/etc).
- **Witness path**: a single representative path demonstrating reachability between seed and a target node.
- **Caps**: hard limits to bound traversal and output sizes.
- **Work units**: deterministic counters used to bound traversal independent of wall-clock.

---

## 2) Shared identity contracts

### 2.1 NodeRef (canonical identity)
A `NodeRef` MUST be used for all resolved identities in Phase 11 outputs.

```ts
type NodeRef =
  | { type: "chunk"; chunkUid: string }
  | { type: "symbol"; symbolId: string }
  | { type: "file"; path: string };
```

**Requirements**
- `chunkUid` MUST be the canonical chunk UID (stable identity).
- `symbolId` MUST be the canonical symbol ID when available.
- `path` MUST be a normalized repo-relative path using `/` separators (POSIX). It MUST NOT contain `..`.

### 2.2 SeedRef (seed identity envelope)
Phase 11 outputs MUST represent the seed as a `SeedRef`, which is a union:

```ts
type SeedRef = NodeRef | ReferenceEnvelope;
```

Where `ReferenceEnvelope` is used only when:
- the seed input required resolution (e.g., name → candidates), or
- the seed could not be resolved but the tool still returns a bounded best-effort result.

### 2.3 ReferenceEnvelope (resolved/ambiguous/unresolved)
A reference envelope is required any time an endpoint cannot be resolved deterministically.

Phase 11 SHOULD reuse the existing “symbol reference” envelope shape where possible (see `symbolRefSchema` in `src/contracts/schemas/artifacts.js`), and MAY extend it with `reason` and `confidence` fields.

Minimum generic envelope:

```ts
type ReferenceEnvelope = {
  v: 1;

  // Required status marker
  status: "resolved" | "ambiguous" | "unresolved";

  // Optional inputs / hints (symbol-oriented; MAY be null for non-symbol use)
  targetName?: string;     // normalized name/label the user provided
  kindHint?: string | null;
  importHint?: { moduleSpecifier?: string | null; resolvedFile?: string | null } | null;

  // Bounded candidate set
  candidates: CandidateRef[]; // MUST be bounded
  resolved: CandidateRef | null;

  // Optional explainability
  reason?: string | null;       // short reason code/message
  confidence?: number | null;   // 0..1
};

type CandidateRef = {
  // Candidate identities (at least one MUST exist)
  chunkUid?: string;
  symbolId?: string;
  path?: string;

  // Optional descriptor fields
  symbolKey?: string;
  kindGroup?: string;
  signatureKey?: string | null;

  // Optional scoring
  confidence?: number | null; // 0..1
};
```

**Requirements**
- `candidates` MUST be capped (`maxCandidates`) and deterministically ordered.
- `resolved` MUST be `null` when `status !== "resolved"`.
- If `status === "resolved"`, `resolved` MUST be non-null and MUST be one of the `candidates`.
- `confidence` (if present) MUST be between 0 and 1 inclusive.

---

## 3) Shared truncation and warning contracts

### 3.1 TruncationRecord
A truncation record MUST exist when any cap triggers.

```ts
type TruncationRecord = {
  scope: "graph" | "impact" | "types" | "risk" | "ranking" | "apiContracts" | "architecture" | "suggestTests";

  cap:
    | "maxDepth"
    | "maxFanoutPerNode"
    | "maxNodes"
    | "maxEdges"
    | "maxPaths"
    | "maxCandidates"
    | "maxWorkUnits"
    | "maxWallClockMs";

  // What limit was applied
  limit: number | { [k: string]: number };

  // What was observed/consumed
  observed?: number | { [k: string]: number };

  // What was omitted/truncated (if measurable)
  omitted?: number | { [k: string]: number };

  // Optional additional info
  at?: {
    node?: string; // nodeKey at which truncation occurred (optional)
    edge?: string; // edgeKey (optional)
  } | null;

  note?: string | null;
};
```

**Requirements**
- `truncation[]` MUST be absent only when **no** caps triggered.
- If multiple caps trigger, multiple records MAY be emitted (recommended), or a single record MAY name multiple caps (not recommended). Prefer one record per cap.

### 3.2 WarningRecord
Warnings communicate partial results, missing artifacts, or degraded modes.

```ts
type WarningRecord = {
  code: string;            // stable code, e.g., "MISSING_SYMBOL_EDGES"
  message: string;         // human readable
  data?: object | null;    // machine readable extra fields
};
```

**Requirements**
- Warnings MUST NOT be unbounded; cap warning count (recommended default: 100).

---

## 4) Determinism and ordering contract

### 4.1 Stable ordering requirements
Every Phase 11 output list MUST have deterministic ordering.

Recommended comparators:

- `nodeKey(NodeRef)`:
  - chunk: `"chunk:" + chunkUid`
  - symbol: `"symbol:" + symbolId`
  - file: `"file:" + path"`

- Node ordering (default):
  1. `distance` (if present) ascending
  2. `nodeKey` ascending

- Edge ordering:
  1. `from.nodeKey` ascending
  2. `edgeType` ascending (lexicographic)
  3. `to.nodeKey` ascending
  4. `confidence` descending
  5. deterministic edge id (if present) ascending

### 4.2 WorkBudget and time fuses
Traversal MUST be bounded by structural caps and SHOULD also be bounded by a deterministic `maxWorkUnits`.

```ts
type WorkBudget = {
  maxWorkUnits: number;      // REQUIRED for deterministic bounding
  maxWallClockMs?: number;   // OPTIONAL last-resort fuse
};
```

**Requirements**
- `maxWorkUnits` MUST drive truncation deterministically.
- `maxWallClockMs` (if used) MUST:
  - be treated as a safety fuse,
  - produce a truncation record when it fires,
  - and MUST NOT be relied upon for deterministic behavior across machines.

---

## 5) Graph Context Pack (bounded neighborhood extraction)

### 5.1 Inputs
```ts
type GraphContextPackRequest = {
  seed: SeedRef; // canonical seed preferred
  direction: "out" | "in" | "both";
  depth: number;

  edgeFilters?: {
    graphs?: ("callGraph" | "importGraph" | "usageGraph" | "symbolEdges")[];
    edgeTypes?: string[]; // see edge type notes below
    minConfidence?: number; // 0..1
  };

  includePaths?: boolean; // include witness paths from seed to nodes

  caps: {
    maxDepth: number;
    maxFanoutPerNode: number;
    maxNodes: number;
    maxEdges: number;
    maxPaths: number;
    maxCandidates: number;
    maxWorkUnits: number;
    maxWallClockMs?: number;
  };
};

Edge type notes:
- For graph_relations graphs, supported edgeTypes are: `call`, `usage`, `import`, `export`, `dataflow`.
- For `symbolEdges`, `edgeTypes` match `symbol_edges.type` values (implementation-defined);
  any additional types MUST be documented and treated deterministically.
```

### 5.2 Output (GraphContextPack)
```ts
type GraphContextPackV1 = {
  version: "1.0.0";

  seed: SeedRef;

  // Deterministic, bounded
  nodes: GraphNodeV1[];
  edges: GraphEdgeV1[];

  // Optional, bounded witness paths
  paths?: WitnessPathV1[];

  truncation?: TruncationRecord[];
  warnings?: WarningRecord[];

  stats?: {
    artifactsUsed: {
      graphRelations: boolean;
      symbolEdges: boolean;
      callSites: boolean;
    };

    counts: {
      nodesReturned: number;
      edgesReturned: number;
      pathsReturned: number;
      workUnitsUsed: number;
    };
  };
};

type GraphNodeV1 = {
  ref: NodeRef;
  distance?: number;            // 0..depth
  label?: string | null;        // display label
  file?: string | null;         // repo-relative path when available
  kind?: string | null;         // function/class/module/etc
  name?: string | null;         // symbol-ish name when available
  signature?: string | null;    // bounded summary, when available
  confidence?: number | null;   // 0..1, if node derived from fuzzy join
};

type GraphEdgeV1 = {
  edgeType: string;             // "call"|"import"|"usage"|...
  graph?: "callGraph" | "importGraph" | "usageGraph" | "symbolEdges" | null;

  from: NodeRef | ReferenceEnvelope;
  to: NodeRef | ReferenceEnvelope;

  confidence?: number | null;   // 0..1
  evidence?: {
    callSiteIds?: string[] | null; // bounded
    note?: string | null;
  } | null;
};

type WitnessPathV1 = {
  to: NodeRef;                  // target node
  distance: number;             // hop count

  // A single representative path (do not enumerate all paths)
  nodes: NodeRef[];             // length == distance + 1
  edges?: { from: NodeRef; to: NodeRef; edgeType: string }[]; // optional detail

  confidence?: number | null;

  partial?: boolean;            // true if path contains unresolved segments
  unresolvedAt?: number[];      // indices into nodes[] where resolution failed
};
```

**Requirements**
- `nodes[]` MUST include the seed (distance 0) when the seed is resolved.
- `nodes[]`, `edges[]`, and `paths[]` MUST be deterministically ordered.
- `paths[]` MUST be omitted unless requested or required by a higher-level tool.
- No output array may exceed its corresponding cap.

---

## 6) Impact Analysis (callers/callees + k-hop impact radius)

### 6.1 Input
```ts
type ImpactAnalysisRequest = {
  seed?: SeedRef;
  changed?: string[];      // repo-relative paths (optional)
  changedFile?: string;    // file with newline-separated paths (optional)
  direction: "upstream" | "downstream";
  depth: number;
  edgeFilters?: GraphContextPackRequest["edgeFilters"];
  caps: GraphContextPackRequest["caps"];
};
```

### 6.2 Output
```ts
type GraphImpactAnalysisV1 = {
  version: "1.0.0";

  seed: SeedRef;
  direction: "upstream" | "downstream";
  depth: number;

  impacted: ImpactedNodeV1[];    // bounded, stable ordering

  truncation?: TruncationRecord[];
  warnings?: WarningRecord[];

  stats?: {
    workUnitsUsed: number;
    impactedReturned: number;
  };
};

type ImpactedNodeV1 = {
  ref: NodeRef;
  distance: number;             // 1..depth
  confidence?: number | null;   // 0..1

  // One bounded witness path per impacted node when available
  witnessPath?: WitnessPathV1 | null;

  // Explicit marker for partial/unresolved reachability
  partial?: boolean;
};
```

**Requirements**
- At least one of `seed` or `changed`/`changedFile` MUST be provided.
- If `seed` is omitted and `changed`/`changedFile` is provided, the tool MUST
  derive candidate seeds deterministically and set `seed` in the output to a
  `ReferenceEnvelope` with bounded candidates. Emit a warning describing the
  derivation.
- `impacted[]` ordering MUST be stable and documented. Recommended:
  - `(distance asc, confidence desc, nodeKey asc)`
- Witness paths MUST NOT enumerate all paths; exactly one is recommended.

---

## 7) Composite Context Pack (tooling/LLM)

### 7.1 Input
```ts
type CompositeContextPackRequest = {
  seed: SeedRef;

  // Hard budget (bytes) + optional token budget
  maxBytes: number;
  maxTokens?: number;

  hops: number; // graph hops (k)

  include: {
    graph: boolean;
    types: boolean;
    risk: boolean;

    // Graph slice toggles
    imports: boolean;
    usages: boolean;
    callersCallees: boolean;
  };

  caps: GraphContextPackRequest["caps"] & {
    // per-slice extras
    maxTypeEntries?: number;
    maxRiskFlows?: number;
    maxRiskEvidencePerFlow?: number;
  };
};
```

### 7.2 Output
```ts
type CompositeContextPackV1 = {
  version: "1.0.0";

  seed: SeedRef;

  primary: {
    ref: NodeRef;               // canonical seed node when resolved
    file: string | null;
    range?: { startLine: number; endLine: number } | null;

    // Bounded excerpt (no unbounded code blobs)
    excerpt: string;            // <= maxBytes after assembly trimming
    excerptHash?: string | null;

    provenance?: {
      chunkUid?: string | null;
      chunkId?: string | null;  // index-local id if needed
      segmentId?: string | null;
    } | null;
  };

  graph?: GraphContextPackV1 | null;

  types?: {
    // Minimal, bounded “type facts” for the seed and/or neighbors
    facts: TypeFactV1[];        // bounded, stable ordering
  } | null;

  risk?: {
    // Bounded selection of flows relevant to the seed
    flows: RiskFlowSummaryV1[]; // bounded, stable ordering
  } | null;

  truncation?: TruncationRecord[];
  warnings?: WarningRecord[];

  stats?: {
    bytesUsed: number;
    tokensEstimated?: number | null;
  };
};

type TypeFactV1 = {
  subject: NodeRef;
  role: "param" | "return" | "field" | "var" | "typeAlias" | "unknown";
  name?: string | null;
  type: string;
  source?: "declared" | "inferred" | "tooling" | "heuristic" | null;
  confidence?: number | null;
};

type RiskFlowSummaryV1 = {
  flowId?: string | null;        // if sourced from risk_flows
  sourceChunkUid?: string | null;
  sinkChunkUid?: string | null;

  category?: string | null;
  severity?: string | null;
  confidence?: number | null;

  // A bounded call path summary (chunkUid list or symbol labels)
  path: {
    nodes: NodeRef[];            // bounded
    callSiteIdsByStep?: string[][] | null; // bounded
  };

  evidence?: {
    // bounded evidence coordinates/snippet hashes
    callSites?: {
      callSiteId: string;
      file: string;
      startLine: number;
      startCol: number;
      endLine: number;
      endCol: number;
      snippetHash?: string | null;
    }[] | null;
  } | null;
};
```

**Requirements**
- `maxBytes` is the hard limit; the assembler MUST trim deterministically to fit.
- Raw code blobs MUST NOT be embedded unbounded; use bounded excerpt + coordinates + hashes.
- Ordering MUST be stable across runs.

---

## 8) Graph-aware ranking hooks (opt-in) + explainability

### 8.1 Config contract
Graph ranking MUST be opt-in and MUST preserve membership.

```ts
type GraphRankingConfig = {
  enabled: boolean;                 // default false
  weights: { [feature: string]: number };  // explicit

  maxGraphWorkUnits: number;        // required
  maxWallClockMs?: number;          // optional fuse

  // How to choose seeds for proximity features
  seedSelection?: "top1" | "topK" | "none";
  seedK?: number;
};

CLI mapping (normative):
- `--graph-ranking-max-work` -> `retrieval.graphRanking.maxGraphWorkUnits`
- `--graph-ranking-max-ms` -> `retrieval.graphRanking.maxWallClockMs`
- `--graph-ranking-seeds` -> `retrieval.graphRanking.seedSelection`
- `--graph-ranking-seed-k` -> `retrieval.graphRanking.seedK`
```

### 8.2 Membership invariant
When graph ranking is enabled:
- The baseline pipeline MUST compute the result set (membership) first.
- Graph ranking MAY reorder items within that set.
- Graph ranking MUST NOT add or remove hits compared to baseline.

### 8.3 Explain output additions
When explain output is enabled, hits MUST include a `graph` section in score breakdown:

```ts
type GraphScoreBreakdownV1 = {
  enabled: boolean;
  delta: number;  // blended delta applied for reordering

  features: { [feature: string]: number | null };

  truncated?: boolean;
  truncation?: TruncationRecord[]; // scope "ranking" when caps triggered
};

### 8.4 Context expansion (post-ranking; optional)
Context expansion remains a post-ranking step that may append additional hits with
`scoreType=context`. Phase 11 requires it to be:

- opt-in (default off),
- bounded (explicit caps, no unbounded candidate arrays),
- deterministic (stable ordering and reason precedence),
- and identity-first when `graph_relations` exists.

Implementations MUST emit truncation records when caps trigger and MUST cap
explain reasons when `--explain`/`--context-expansion-explain` is enabled.
```

---

## 9) API contracts report (cross-file)

### 9.1 Output (JSON)
```ts
type ApiContractsReportV1 = {
  version: "1.0.0";
  generatedAt: string;

  options: {
    onlyExports: boolean;
    failOnWarn: boolean;
    caps: {
      maxSymbols: number;
      maxCallsPerSymbol: number;
      maxWarnings: number;
    };
  };

  symbols: ApiContractEntryV1[];   // bounded, stable ordering
  truncation?: TruncationRecord[];
  warnings?: WarningRecord[];
};

type ApiContractEntryV1 = {
  symbol: {
    symbolId: string;
    chunkUid?: string | null;
    file?: string | null;
    name?: string | null;
    kind?: string | null;
  };

  signature: {
    declared?: string | null;
    tooling?: string | null;
  };

  observedCalls: ObservedCallV1[]; // bounded
  warnings?: ApiContractWarningV1[] | null;

  truncation?: TruncationRecord[]; // scope "apiContracts" (per-symbol optional)
};

type ObservedCallV1 = {
  arity?: number | null;
  args?: string[] | null;        // bounded stringified args
  callSiteId?: string | null;
  file?: string | null;
  startLine?: number | null;
  confidence?: number | null;
};

type ApiContractWarningV1 = {
  code: "ARITY_MISMATCH" | "UNRESOLVED_TARGET" | "INCOMPATIBLE_ARG_KIND" | "UNKNOWN";
  message: string;
  data?: object | null;
};
```

### 9.2 Optional artifact emitter (JSONL)
If Phase 11 enables an artifact emitter:
- Emit `api_contracts.jsonl` with one `ApiContractEntryV1`-like record per symbol.
- Each JSONL row MUST be size-capped and deterministic in ordering.

---

## 10) Architecture rules + report

### 10.1 Rules file format (JSON/JSONC/YAML)
```ts
type ArchitectureRulesV1 = {
  version: 1;
  rules: ArchitectureRuleV1[];
};

type ArchitectureRuleV1 =
  | ForbiddenImportEdgeRuleV1
  | ForbiddenCallEdgeRuleV1
  | LayeringRuleV1;

type ForbiddenImportEdgeRuleV1 = {
  id: string;
  type: "forbiddenImport";
  from: PathSelectorV1;
  to: PathSelectorV1;
  severity?: "error" | "warn";
  message?: string | null;
};

type ForbiddenCallEdgeRuleV1 = {
  id: string;
  type: "forbiddenCall";
  from: PathSelectorV1;
  to: PathSelectorV1;
  severity?: "error" | "warn";
  message?: string | null;
};

type LayeringRuleV1 = {
  id: string;
  type: "layering";
  layers: { name: string; match: PathSelectorV1 }[];
  severity?: "error" | "warn";
};

type PathSelectorV1 = {
  anyOf?: string[];   // glob patterns (picomatch)
  noneOf?: string[];
};
```

**Requirements**
- Globs MUST be evaluated on normalized repo-relative POSIX paths.
- Rule evaluation MUST be deterministic (stable match ordering, stable violation ordering).

### 10.2 Architecture report output
```ts
type ArchitectureReportV1 = {
  version: "1.0.0";
  rules: {
    id: string;
    type: string;
    severity?: string | null;
    summary: { violations: number };
  }[];

  violations: ArchitectureViolationV1[]; // bounded, stable ordering

  truncation?: TruncationRecord[];
  warnings?: WarningRecord[];
};

type ArchitectureViolationV1 = {
  ruleId: string;

  edge: {
    edgeType: "import" | "call";
    from: NodeRef;
    to: NodeRef;
  };

  evidence?: {
    file?: string | null;
    note?: string | null;
  } | null;
};
```

---

## 11) Suggest-tests report

### 11.1 Input
```ts
type SuggestTestsRequest = {
  changed: string[];  // repo-relative file paths
  max: number;
  caps: GraphContextPackRequest["caps"] & { maxSuggestions?: number };
};
```

### 11.2 Output
```ts
type SuggestTestsReportV1 = {
  version: "1.0.0";

  changed: { path: string }[];

  suggestions: SuggestedTestV1[]; // bounded, stable ordering

  truncation?: TruncationRecord[];
  warnings?: WarningRecord[];
};

type SuggestedTestV1 = {
  testPath: string;
  score: number;           // deterministic score
  reason: string;          // short explanation
  witnessPath?: WitnessPathV1 | null;
};
```

**Requirements**
- Suggested tests MUST be ordered deterministically (score desc, path asc).
- The tool MUST not enumerate unbounded candidate tests; cap discovery and ranking work.

---

## Appendix A — Cap defaults (non-normative placeholder)

Phase 11 will add calibrated defaults in `docs/perf/graph-caps.md` and a machine-readable defaults file.
Until calibrated defaults exist, recommended safe starting caps:

```json
{
  "maxDepth": 2,
  "maxFanoutPerNode": 25,
  "maxNodes": 250,
  "maxEdges": 500,
  "maxPaths": 200,
  "maxCandidates": 25,
  "maxWorkUnits": 50000
}
```

---

## Appendix B — Required schema registry updates (implementation mapping)

- Add schema constants to `src/contracts/schemas/analysis.js`:
  - `GRAPH_CONTEXT_PACK_SCHEMA` → `GraphContextPackV1`
  - `GRAPH_IMPACT_SCHEMA` → `GraphImpactAnalysisV1`
  - `COMPOSITE_CONTEXT_PACK_SCHEMA` → `CompositeContextPackV1`
  - `API_CONTRACTS_SCHEMA` → `ApiContractsReportV1`
  - `ARCHITECTURE_REPORT_SCHEMA` → `ArchitectureReportV1`
  - `SUGGEST_TESTS_SCHEMA` → `SuggestTestsReportV1`

- Add validators to `src/contracts/validators/analysis.js`.

- Update `docs/contracts/analysis-schemas.md` and `docs/contracts/search-cli.md`.
