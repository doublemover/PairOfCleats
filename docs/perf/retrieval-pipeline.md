# Retrieval Pipeline Performance Notes

This document captures ordering invariants and performance-sensitive behaviors in the retrieval pipeline.

## Top-K Ordering

When candidate lists are reduced to top-K results, the ordering is deterministic and stable. Entries are
compared using the following tie-break rules:

1. Primary: score descending.
2. Secondary: normalized id ascending (numeric ids sort before string ids).
3. Tertiary: source rank ascending (earlier sources win ties).

These invariants ensure that tie cases produce consistent output across runs and across different
ANN/sparse providers.

## Top-K Selection

Top-K selection uses a heap-based reducer when the candidate list is large enough relative to `k`
(to avoid full-array sorts). Smaller lists fall back to a full sort for simplicity.

Top-K reducers operate over a `k + slack` window to preserve ranking quality when multiple stages
compose results (fusion + ranking). The `slack` is bounded to keep memory usage predictable.

## Buffers and Pools

Candidate sets and score buffers use small pools to avoid repeated allocations inside a single query.
Pools are capped and drop oversized buffers to avoid unbounded growth.

Score-buffer fallback growth is geometric and stays within the configured
retention ceiling while the requested size fits. The main search pipeline
already supplies a capacity hint; fallback growth is an API safety improvement,
not evidence of a normal-query latency gain. Reset and release clear only the
previous active prefix's nonnumeric references, including oversized drops.
Released buffers have no active lease and duplicate release cannot pool one
buffer twice. Retained output objects must be independent of borrowed entry views.

Top-K comparators use primitive ID/type values and selector locals, avoiding
temporary comparison records while retaining numeric-before-string ordering,
string coercion, selector evaluation order and stable source-rank ties. No timing
gain is implied by this source-level allocation reduction.

## ANN Fallbacks

Vector ANN backends are queried only when vectors are present and an embedding has been computed for
the query. If no provider is available, the pipeline logs a single warning and continues with sparse
ranking.

## Sampled MinHash

Sampled signatures are compared using the same recorded stride and component
indices for the query, with similarity divided by the sampled width. JSON,
packed artifacts and streamed rows retain that descriptor. SQLite stores it in
an optional per-mode metadata table, while full-width legacy schema-12 stores
remain readable. The LMDB producer accepts packed-only artifacts and preserves
numeric values through its existing codec. Unknown sampling plans and shortened
rows without metadata are unavailable rather than guessed. Older sampled SQLite
stores and packed-only LMDB stores need a backend rebuild to restore those data;
there is no automatic store migration.

## Graph/Context Pack Caches

When graph-backed expansion (impact/context-pack) is enabled, `GraphStore` maintains small bounded LRU caches
for graph artifacts and indexes to avoid per-request rebuilds.

Cache keys include `indexSignature`, `repoRoot`, requested graph set, and the CSR inclusion flag. When present,
`graph_relations_csr` is loaded and validated (ordering/offsets/bounds); invalid CSR falls back to a legacy
`graph_relations` representation (and may derive CSR from it).

Callers should pass either a prebuilt `graphIndex` (preferred) or raw `graphRelations` (baseline). When CSR is enabled,
some graphIndex variants store a trimmed graph_relations representation (no adjacency lists); passing both `graphIndex` and
raw `graphRelations` will trigger `GRAPH_INDEX_MISMATCH` and disable cache reuse.

When CSR is available, incoming traversal (`direction=in|both`) should use a reverse-edge CSR derived once per graphIndex,
instead of materializing full `in`/`both` adjacency lists.

Some traversal results may be cached per graphIndex, keyed by the traversal query signature (seeds, filters, depth/direction, caps, includePaths)
and `indexSignature`. Cache hits must preserve deterministic ordering.

Composite context-pack assembly may avoid loading full `chunk_meta` by resolving only the primary chunk's excerpt range via `chunk_uid_map`.

Benchmarks:
- `node tools/bench/graph/context-pack-latency.js --index <indexDir> --mode compare`
- `node tools/bench/graph/neighborhood-index-dir.js --index <indexDir> --mode compare`

Bench harness:
- `node tools/bench/bench-runner.js --suite sweet16-ci --json .testLogs/bench-sweet16.json --quiet`
