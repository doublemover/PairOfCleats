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

## ANN Fallbacks

Vector ANN backends are queried only when vectors are present and an embedding has been computed for
the query. If no provider is available, the pipeline logs a single warning and continues with sparse
ranking.

## Graph/Context Pack Caches

When graph-backed expansion (impact/context-pack) is enabled, `GraphStore` maintains small bounded LRU caches
for graph artifacts and indexes to avoid per-request rebuilds.

Cache keys include `indexSignature`, `repoRoot`, requested graph set, and the CSR inclusion flag. When present,
`graph_relations_csr` is loaded and validated (ordering/offsets/bounds); invalid CSR falls back to a legacy
`graph_relations` representation (and may derive CSR from it).

When CSR is available, incoming traversal (`direction=in|both`) should use a reverse-edge CSR derived once per graphIndex,
instead of materializing full `in`/`both` adjacency lists.

Some traversal results may be cached per graphIndex, keyed by the traversal query signature (seeds, filters, depth/direction, caps, includePaths)
and `indexSignature`. Cache hits must preserve deterministic ordering.

Composite context-pack assembly may avoid loading full `chunk_meta` by resolving only the primary chunk's excerpt range via `chunk_uid_map`.
