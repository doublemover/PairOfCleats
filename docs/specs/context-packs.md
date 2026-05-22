# Spec -- Graph-Backed Context Packs (Active Contract)

**Status:** Active implemented contract v1.0
**Last audited:** 2026-05-21
**Roadmap area:** Graph-powered product features; current status is tracked in `docs/roadmap.md`.
**Implementation anchors:** `src/context-pack/assemble.js`, `src/graph/context-pack.js`,
`src/integrations/tooling/context-pack.js`, `src/shared/context-pack-request.js`,
`tools/analysis/context-pack.js`, `tools/api/router/analysis.js`, and `tools/mcp/tools/handlers/analysis.js`.
**Authoritative schema:** `COMPOSITE_CONTEXT_PACK_SCHEMA` in `src/contracts/schemas/analysis/context-pack.js`.
**Primary goal:** Deterministic, evidence-rich, bounded "context bundles" assembled using graph neighborhoods (calls/usages/imports/dataflow) and exposed consistently across CLI, MCP, and any API/server surfaces.

---

## 0. Non-negotiable properties

1. **Deterministic outputs**
   - Given identical inputs (repo, index build root, seed, caps, and selected slices), a context pack must be stable after canonical JSON normalization.
2. **Bounded computation**
   - Graph expansion, risk slicing, type inclusion, excerpting, and federation must obey explicit caps.
3. **Explainability**
   - The payload must expose evidence state, truncation, warnings, provenance, and graph/risk details when those slices are included.
4. **Contract-stable identifiers**
   - Pack contents use SymbolId where available, chunkUid for chunk identity, and file node refs for path seeds. Never key by `file::name`.
5. **Schema validated**
   - Emitted payloads must validate against `COMPOSITE_CONTEXT_PACK_SCHEMA`.
6. **Cross-surface parity**
   - CLI, API, and MCP must project request fields through the same shared request helper before assembly.

---

## 1. Definitions

### 1.1 Inputs

- **IndexRoot**: A build output directory containing:
  - `chunk_meta` (JSON/JSONL/sharded) and manifests
  - `chunk_uid_map` (tooling JSONL): lightweight mapping `{chunkUid,file,start,end}` used for streaming excerpt resolution
  - Graph artifacts (calls/usages/imports/dataflow/exports)
  - Optional: callsite evidence artifacts, risk flows, contracts, etc.

- **Seed Ref**: The explicit seed supplied by a caller. It may resolve to a chunk,
  symbol, file, or a reference envelope.

- **Graph Layer**: A normalized, versioned set of node/edge tables keyed by stable IDs.
  - Nodes are either Symbol nodes or Chunk nodes.
  - Edges include types: `call`, `usage`, `import`, `export`, `dataflow`.

### 1.2 Output: CompositeContextPack

A CompositeContextPack is a deterministic payload centered on one primary seed excerpt, optional graph/type/risk slices, evidence state, and provenance.

**Top-level shape (JSON):**
```json
{
  "version": "1.0.0",
  "seed": { "...": "SeedRef" },
  "provenance": { "...": "Provenance" },
  "primary": { "...": "PrimaryContext" },
  "graph": { "...": "GraphContextPack" },
  "types": { "...": "TypeSlice" },
  "risk": { "...": "RiskSlice" },
  "evidence": { "...": "EvidenceState" },
  "truncation": [ { "...": "TruncationRecord" } ],
  "warnings": [ { "...": "WarningRecord" } ],
  "stats": { "...": "ContextPackStats" }
}
```

### 1.3 Stable IDs

- **symbolId**: canonical graph identity (preferred)
- **chunkUid**: universal stable-ish chunk identity (required for all items)
- **docId**: build-local integer; NEVER used for cross-surface identity in packs

---

## 2. PackRequest contract

A pack is computed from the shared seed-centric request projection in
`src/shared/context-pack-request.js`. Surface-specific validation and trust
checks remain local to the CLI, API, and MCP handlers.

```ts
type ContextPackRequestInput = {
  repoRoot?: string;
  workspacePath?: string;
  workspaceId?: string;
  select?: string | string[] | object;
  includeDisabled?: boolean;
  maxFederatedRepos?: number;

  seed: string | object;
  hops: number;

  includeGraph?: boolean;
  includeTypes?: boolean;
  includeRisk?: boolean;
  includeRiskPartialFlows?: boolean;
  strictRisk?: boolean;
  strictEvidence?: boolean;
  includeImports?: boolean;
  includeUsages?: boolean;
  includeCallersCallees?: boolean;
  includePaths?: boolean;

  maxBytes?: number;
  maxTokens?: number;
  maxTypeEntries?: number;
  maxDepth?: number;
  maxFanoutPerNode?: number;
  maxNodes?: number;
  maxEdges?: number;
  maxPaths?: number;
  maxCandidates?: number;
  maxWorkUnits?: number;
  maxWallClockMs?: number;

  riskFilters?: object;
};
```

The emitted payload validates against `COMPOSITE_CONTEXT_PACK_SCHEMA` and has
these required top-level keys: `version`, `seed`, `primary`, `provenance`, and
`evidence`. Optional graph, type, risk, truncation, warnings, and stats blocks
are included only when requested and available.

### Default values
- `hops` is required by public surfaces and is clamped through graph caps.
- Graph/risk/type slices are controlled by the booleans above.
- Evidence strictness is explicit: `strictEvidence=true` fails closed when required evidence is incomplete.
- Risk filters are projected through the shared risk-filter contract before assembly.

**Hard caps (must be enforced regardless of config):**
- Graph traversal caps are resolved through `resolveGraphCliCapsAndFilters()` and `mergeCaps()`.
- Output shaping caps (`maxBytes`, `maxTokens`, `maxTypeEntries`) are normalized before assembly.
- Federated packs are bounded by `maxFederatedRepos`.

---

## 3. Payload Model

### 3.1 Required blocks

- `seed`: the caller-provided seed, resolved or represented as a reference envelope.
- `provenance`: generated time, index signature/compat key, caps used, repo, and index dir.
- `primary`: resolved seed file/range/excerpt plus primary evidence/provenance.
- `evidence`: strict-evidence policy, primary excerpt state, type-slice state, and completeness flag.

### 3.2 Optional blocks

- `graph`: `GRAPH_CONTEXT_PACK_SCHEMA` payload with graph nodes, edges, witness paths, truncation, warnings, and stats.
- `types`: type facts when `includeTypes=true`.
- `risk`: risk summary/flow/partial-flow slice when `includeRisk=true`.
- `truncation`: pack-level truncation records.
- `warnings`: pack-level warning records.
- `stats`: implementation metrics.

**Key invariants**
- `primary.ref` is a node ref and must include the stable identity available for the resolved seed.
- `primary.file` and `primary.excerpt` are required.
- Evidence state must distinguish file-backed excerpts, fallback excerpts, missing excerpts, substitution, and truncation.
- Optional slices must be omitted or set to `null` when disabled or unavailable, rather than emitting malformed partial shapes.

---

## 4. Algorithms

### 4.1 High-level flow

1. Resolve the repo/index root and require a code index.
2. Parse the seed ref and build a chunk index from `chunk_meta`.
3. Resolve graph inputs and graph indexes for selected graph slices.
4. Build the primary excerpt and evidence state.
5. Optionally assemble graph, type, and risk slices.
6. Merge truncation/warning records and provenance.
7. Validate the payload against `COMPOSITE_CONTEXT_PACK_SCHEMA`.

### 4.2 Candidate generation

For graph slices:
- `includeCallersCallees`, `includeUsages`, and `includeImports` select the graph families.
- `hops`, `maxDepth`, `maxFanoutPerNode`, `maxNodes`, `maxEdges`, `maxPaths`,
  `maxCandidates`, `maxWorkUnits`, and `maxWallClockMs` cap traversal and output.
- `includePaths=true` requests witness paths.

**Strictness rules**
- `strictEvidence=true` fails when required evidence is incomplete.
- Risk strictness is independent and controlled by `strictRisk`.
- Missing optional slices degrade through warnings/status fields instead of corrupting the payload.

## 5. Export boundary

Native context-pack JSON is the authoritative representation. Standards-friendly exports are derived views and must
not change the canonical pack schema.

### 5.1 SARIF-compatible risk export

- Risk flows may be exported as a SARIF v2.1.0-compatible log.
- The export is bounded by the same flow and evidence caps as the native pack.
- Stable `flowId` values remain the primary cross-surface identity and are copied into SARIF `properties` and
  per-result `partialFingerprints`.
- Ordered `threadFlowLocation` entries follow the native bounded flow-step ordering.
- PairOfCleats-specific metadata stays in SARIF `properties`, including:
  - confidence
  - provenance
  - truncation records
  - cap state
  - analysis status
  - normalized filters

### 5.2 Native vs export contract

- Native pack JSON is validated by the PairOfCleats analysis/context-pack schemas.
- SARIF export is a derived interchange view for external code-scanning consumers.
- Consumers must not treat SARIF output as the canonical persistence format for packs.

Retrieval result bundles (outside full context-pack generation) follow a reduced deterministic contract:
- group by `file` (fallback synthetic bundle for missing file)
- order bundles by `totalScore`, then `topScore`, then `modeCount`, then `file`, then `bundleId`
- order items inside each bundle by `score`, mode precedence, source index, then stable id key

This alignment keeps bundle previews deterministic and compatible with context-pack ordering expectations.

---

## 6. Optional Persistence Extension

Status: not part of the current active release contract. The current shipped
surface emits contract-validated context-pack payloads through CLI/API/MCP;
durable pack persistence can use the plan below if it becomes roadmap work.

### 5.1 Artifact types

- `context_packs.jsonl` (record-per-pack)
- `context_packs.meta.json` (sharded sidecar if sharded)
- `context_packs.manifest.json` (optional top-level manifest pointer; preferred to reuse main `pieces/manifest.json` entry)

### 5.2 Storage rules

- Packs should be keyed by stable `packId` and include the input request in the record for auditability.
- Cache key for pack generation is `sha256(indexSignature + normalized(PackRequest))`.

### 5.3 Sharding policy

- If `context_packs.jsonl` exceeds `maxShardBytes` (default 16-32MB), write sharded JSONL.

---

## 7. Integration surfaces

### 6.1 CLI

Live command:

- `pairofcleats context-pack --repo <path> --seed <path|chunk|symbol> --hops <n> [--json]`

Common options:
- `--include-risk`, `--include-risk-partial-flows`, `--strict-risk`
- `--include-types`, `--strict-evidence`
- `--include-paths`, `--include-imports`, `--include-usages`, `--include-callers-callees`
- `--max-bytes`, `--max-tokens`, `--max-depth`, `--max-nodes`, `--max-edges`, `--max-paths`

### 6.2 API

Live route:
- `POST /analysis/context-pack`

The route projects API input through `buildContextPackRequestInput()` and returns
the same composite payload schema as the CLI.

### 6.3 MCP
 
Tool:
- `context_pack`

Required inputs:
- `seed`
- `hops`

Transport error mapping is owned by `tools/mcp/tools/handlers/analysis.js` and
uses the shared error-code system for invalid request, no-index, cancellation,
and strict evidence failures.

### 6.4 Streaming Assembly (Implementation Note)

Definition (current code intent):
- A context pack is assembled by resolving only the seed's primary chunk metadata (file + byte range) via `chunk_uid_map`,
  then performing range reads for excerpts, without materializing the full `chunk_meta` array or a full `chunkIndex`.
- This keeps interactive tooling memory-bounded even for large repos.
- `chunk_uid_map` must be a streaming-friendly artifact format (JSONL/sharded). JSON array payloads require materialization and
  are rejected by streaming loaders in strict mode.

Limitations:
- If a pack requests features that require full chunk metadata (e.g., inferred types from `chunk_meta.docmeta`), the builder may:
  - warn and omit those slices, or
  - fall back to a materialized `chunk_meta` load when explicitly requested by the caller.

---

## 8. Observability

Stats fields:
- counts per section
- dropped candidate counts by reason (`budget`, `noEvidence`, `duplicate`, `unsupported`)
- max hop encountered
- graph traversal timings
- graph store/cache stats (GraphStore cache hits/misses, build time, CSR source/bytes) when graph-backed expansion is enabled
- graph traversal cache info (hit/miss) and traversal cap trigger counts (fanout/nodes/edges/paths/work-budget)
- import graph lookup miss counts (unique + total) when seeds require import expansion
- streaming assembly mode markers when the pack was built without materializing full `chunk_meta` (e.g., via `chunk_uid_map`)

---

## 9. Contract Coverage

- `tests/context-pack/core-contract-matrix.test.js`
- `tests/context-pack/excerpt-contract-matrix.test.js`
- `tests/context-pack/risk-assembly.test.js`
- `tests/context-pack/risk-filters-parity.test.js`
- `tests/retrieval/graph/context-pack-contract-matrix.test.js`
- `tests/retrieval/output/composite-context-pack-contract-matrix.test.js`
- `tests/shared/context-pack-request-contract.test.js`
- `tests/shared/contracts/analysis-schemas-validate.test.js`
- `tests/services/api/context-pack-*`

---

## 10. Implementation Touchpoints

- `src/context-pack/assemble.js`: composite pack assembly.
- `src/context-pack/assemble/*`: budget, risk, evidence, excerpt, and finalization helpers.
- `src/graph/context-pack.js`: graph neighborhood payload construction.
- `src/shared/context-pack-request.js`: pure CLI/API/MCP request projection.
- `src/contracts/schemas/analysis/context-pack.js`: payload schema.
- `src/integrations/tooling/context-pack.js`: CLI/runtime entrypoint and federated assembly.
- `tools/analysis/context-pack.js`: CLI wrapper.
- `tools/api/router/analysis.js`: API route handler.
- `tools/mcp/tools/handlers/analysis.js`: MCP handler.

---

## 11. Explicit non-goals (v1)

- No attempt at "LLM prompt formatting" beyond stable excerpts. Packs are raw evidence containers.
- No unbounded graph expansions.
- No PageRank/centrality in v1 (can be added later as optional ranking signals).
