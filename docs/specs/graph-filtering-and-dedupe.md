# Graph Filtering + Dedupe Semantics

This spec defines the source-of-truth behaviors for graph filtering, graph index reuse,
edge de-duplication, and related warnings. It applies to:

- `src/graph/neighborhood.js` (graph expansion)
- `src/graph/store.js` (graph index caching)
- `src/retrieval/output/graph-context-pack.js`
- `src/context-pack/assemble.js`
- graph-based tooling (`impact`, `architecture`, `suggest-tests`, `api-contracts`)

Related docs:
- `docs/specs/graph-product-surfaces.md` (payload shapes + ordering)
- `docs/specs/graph-caps.md` (caps + truncation behavior)
- `docs/perf/graph-context-pack.md` (perf implementation details)

## 1. Terminology
- **Graph**: one of `callGraph`, `usageGraph`, `importGraph`, `symbolEdges`.
- **edgeTypes**: edge-level tags (e.g., `call`, `usage`, `import`, `export`, `symbol`).
- **edgeFilters**: request-time filters `{ graphs?: string[]; edgeTypes?: string[]; minConfidence?: number }`.
- **graphIndex**: precomputed adjacency/ids/cache for graph artifacts.

## 2. Graph selection semantics
1. `edgeFilters.graphs` **only** controls graph inclusion. If provided, only those graphs are eligible.
2. `edgeFilters.edgeTypes` **never** controls graph inclusion (it filters edges inside included graphs).
3. Unknown graph names:
   - Emit warning `UNKNOWN_GRAPH_FILTER` listing unknown values.
   - If all requested graphs are unknown, expansion returns no edges and includes warning.
4. Unknown edgeType values:
   - Emit warning `UNKNOWN_EDGE_TYPE_FILTER` listing unknown values.
   - If no edges match the filter, expansion returns no edges and includes warning.
5. If the requested graph set is empty after filtering, emit warning `GRAPH_EXCLUDED_BY_FILTERS`.

## 3. Graph index reuse + consistency
1. If `graphIndex` is provided and `graphRelations` is also provided:
   - If they match (same identity or same signature), reuse graphIndex.
   - If they mismatch, emit warning `GRAPH_INDEX_MISMATCH` and prefer `graphRelations` data.
2. If `graphIndex.repoRoot` differs from request `repoRoot`:
   - Emit warning `GRAPH_INDEX_REPOROOT_MISMATCH`.
   - Use `graphIndex.repoRoot` for normalization to keep deterministic behavior.
3. Optional CSR acceleration:
   - If `includeCsr=true` and `graph_relations_csr` is present, `GraphStore` may attach `graphIndex.graphRelationsCsr`.
   - CSR payloads are validated (sorted/unique node ids, monotonic offsets, edge bounds, per-node edge ordering) and must match
     the `graph_relations` node ordering for each graph.
   - On CSR validation failure, the system must fall back to the legacy `graph_relations` representation (and may derive CSR from it).
   - When CSR is enabled:
     - Neighbor resolution for `direction=out` must use CSR directly.
     - Neighbor resolution for `direction=in|both` must use a reverse-edge index derived from CSR (built once per graphIndex and cached),
       rather than materializing full `in`/`both` adjacency lists.
     - Adjacency maps may omit `in` and `both` lists entirely (keep legacy adjacency only as fallback when CSR is unavailable).
4. Traversal-result caching:
   - Graph neighborhood results may be cached on the `graphIndex`, keyed by a query signature:
     - seeds, graphs/edgeTypes filters, depth, direction, caps, includePaths, and `indexSignature`.
   - Cache hits must return the same nodes/edges/paths ordering as an uncached traversal.
   - Cache invalidation must be strict: a changed `indexSignature` must not reuse cached results.

## 4. Import graph expansion with chunk seeds
When expanding import edges from a chunk seed:
1. Resolve the chunk's `file` from:
   - Graph node metadata (`callGraph`/`usageGraph` node `file`), then
   - Any chunk metadata passed into the request (when available).
2. If file mapping is unavailable:
   - Emit warning `IMPORT_GRAPH_MISSING_FILE`.
   - Skip import expansion for that seed.

## 5. Edge de-duplication policy
Edges are de-duplicated by `(graph, from, edgeType, to)` and **retain one winner**.
Winner selection:
1. Prefer higher `confidence` (numeric).
2. If confidence ties or missing, prefer edge that includes `evidence`.
3. If still tied, choose lexicographically by `edgeKey` to keep deterministic output.

This policy ensures deterministic results while retaining the most informative edge.

## 6. Symbol edge direction semantics
Symbol edges are asymmetric:
- `chunk -> symbol` edges are **outgoing** from chunk nodes.
- `symbol -> chunk` edges are **incoming** to symbol nodes.

Direction handling:
- `direction=in`: only incoming edges are expanded.
- `direction=out`: only outgoing edges are expanded.
- `direction=both`: includes both.

## 7. Graph metadata validation (warnings)
When `graphRelations` is loaded:
1. If `nodeCount` or `edgeCount` does not match actual counts:
   - Emit warning `GRAPH_COUNT_MISMATCH`.
2. If a graph lists nodes without `id` or missing `out/in`:
   - Emit warning `GRAPH_NODE_INVALID` with sample ids.

These are warnings (non-fatal) so that partial graphs still render.

## 8. Edge filter normalization
Normalize `edgeTypes` values using:
- lowercase, trimmed values
- allow aliases: `calls` -> `call`, `imports` -> `import`, `usages` -> `usage`, `symbols` -> `symbol`

If a value is not recognized after normalization, warn.

## 9. Test requirements
Every change above must be covered by tests that assert:
1. Unknown graphs/edgeTypes produce warnings and preserve deterministic output.
2. `edgeTypes` does not exclude graphs.
3. Graph index mismatch triggers warning and uses fresh graph relations.
4. Repo root mismatch warning is emitted.
5. Import graph expansion warns when file mapping missing.
6. Edge de-duplication picks highest confidence/evidence deterministically.
7. Symbol edge direction semantics align with `in/out/both`.
8. Node/edge count mismatch produces warnings.
9. Graph outputs follow shared ordering rules and record hashes in `build_state.json` orderingLedger.

## 10. Non-goals
- Changing graph schema.
- Changing default caps or truncation policy (see `docs/specs/graph-caps.md`).
