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

Comparators work on scalar values without constructing intermediate normalized-ID
records or small-list sorting records. Mixed numeric/string ID order, duplicate
ties, selector evaluation and ID coercion behavior remain compatible. Focused
parity fixtures cover both heap and full-sort paths; end-to-end allocation or
latency gains have not been measured.

## Top-K Selection

Top-K selection uses a heap-based reducer when the candidate list is large enough relative to `k`
(to avoid full-array sorts). Smaller lists fall back to a full sort for simplicity.

Top-K reducers operate over a `k + slack` window to preserve ranking quality when multiple stages
compose results (fusion + ranking). The `slack` is bounded to keep memory usage predictable.

## Buffers and Pools

Candidate sets and score buffers use small pools to avoid repeated allocations inside a single query.
Pools are capped and drop oversized buffers to avoid unbounded growth.

Resetting a score buffer retires nonnumeric values in its active rows, including
the transient blend/RRF explanations created during fusion. Entry objects and
numeric arrays remain reusable; unused capacity is not scanned. Ranking returns
independent result objects before the pipeline releases the buffer, so previously
returned results survive later reuse. Borrowed buffer entries are valid only until
reset or release. This is a reference-lifetime improvement; no throughput or RSS
reduction has been measured.

Output file-text and body-summary caches honor their configured byte budgets
when no entry-count environment override is supplied. A missing override is
distinct from an explicit zero, which disables the cache; explicit positive
entry limits retain their existing precedence. Repeated summaries and different
chunks from the same file reuse the admitted text within the configured search
session. A tiny fixture counts actual reads rather than claiming a throughput
improvement. This correction does not change the shared LRU policy or introduce
a combined entry/byte budget.

## MinHash Signature Work

For ordinary string tokens and unsigned integer seeds, MinHash factors its
existing polynomial recurrence into one UTF-16 scan and a short arithmetic update
per signature component. It preserves the original 32-bit signature values, seed
order, reset behavior and query ranking, including compatibility with existing
indexes. Empty tokens, unusual seeds, nonstring token-like inputs and custom hash
methods retain their prior hash behavior. The focused test compares the original
recurrence and counts character reads; it does not measure end-to-end speed.

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

With `minhashStream` enabled, oversized-corpus emission retains the sampling
descriptor and borrows the existing chunk signatures instead of retaining a
second array of transformed rows. JSON measurement/writing uses a repeatable
iterator that allocates only the current sampled row. Packed emission reads the
recorded indices directly into its final buffer, preserving the bytes and row
coercion behavior of materialized sampling. Explicit `minhashStream: false`
retains materialized rows. This removes the additional document-count-sized JS
row collection; the existing full chunk signatures and complete packed buffer
are still retained. No whole-index peak-memory or throughput gain is measured.

After the packed binary and its metadata are successfully written, publication
reuses the SHA-1 checksum already computed for those exact binary bytes. The
pieces manifest still checks that the file exists; it avoids an additional full
read/hash of that packed file. JSON metadata and other artifacts retain their
existing checksum paths. A tiny actual-writer fixture verifies the digest
independently and counts the avoided reread. This does not change packed bytes,
checksum validation or atomic write/failure boundaries.

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

Neighborhood traversal consumes raw call/usage CSR rows through iterators,
including the sorted union of incoming and outgoing IDs. It avoids per-node
neighbor arrays while retaining direction, duplicate removal and deterministic
ordering. Import normalization and legacy adjacency retain their existing
materialized sorting paths; the default direct resolver API still returns arrays.
The synchronous traversal borrows the immutable graph index for the iterator's
lifetime. Tiny fixtures verify output/path/cap parity and prefix-only CSR reads.
The traversal still builds its capped edge batches and visited/witness state;
total allocation, peak RSS and latency changes remain unmeasured.

Some traversal results may be cached per graphIndex, keyed by the traversal query signature (seeds, filters, depth/direction, caps, includePaths)
and `indexSignature`. Cache hits must preserve deterministic ordering.

Composite context-pack assembly may avoid loading full `chunk_meta` by resolving only the primary chunk's excerpt range via `chunk_uid_map`.

Benchmarks:
- `node tools/bench/graph/context-pack-latency.js --index <indexDir> --mode compare`
- `node tools/bench/graph/neighborhood-index-dir.js --index <indexDir> --mode compare`

Bench harness:
- `node tools/bench/bench-runner.js --suite sweet16-ci --json .testLogs/bench-sweet16.json --quiet`
