# Runtime/search consolidation checkpoint

Owner-approved integration follows the established branch destinations:

- #555 into #554, then #554 into #552, then #552 into #550.
- #553 into #551.
- Both #550 and #551 into #548, then #548 into #549, then #549 into #547,
  and #547 into main.

All nine PRs merged. Main is `11f1556c8a71b191e090c1257cddced2b92d9ef7`,
tree `46c89dc01a936806086dcb081cf2c7a137479317`. This is exactly the tree of
locally validated consolidation `f23b1e42ce71f7cdac34b9e5753e296db3cea34b`.
Connector publication preserved both branch ancestries and verified every newly
combined Git blob/tree. Native Git lacked credentials; no force push was used.

## Conflict resolution

The WASM compiler-task abstraction retains the canonical stage2-relations queue,
shared closure admission, lease rollback and durable publication. Combined binding
producer version 7 invalidates replay from either pre-integration binding producer.
Native syntax/parser identities coexist with WASM extractor/runtime identities.
Native and binary execution retain recovery disk accounts and cancellation through
the existing control store. Combined LSP binding producer version 4 distinguishes
both sets of source-location/provider changes. Crash-stage diagnostics remain around
native semantic collection. Generated config/schema inventories were regenerated.

The merged roadmap initially exceeded its existing 20,000-byte contract. Its
completed prose was condensed into existing receipt links, including allowance for
CRLF checkouts; the final documentation/freshness check passed without relaxing it.

## Exact-tree bounded verification

Node 26.8.1, official native/patch readiness verification, no bootstrap bypass:

- 13 integration fixtures: cache identity, compiler bindings, frontier drain,
  interrupted multi-worker recovery, native production/retrieval, deferred WASM,
  analysis-version identity, control repair, frontier control, retained-cache
  cleanup, transient metadata accounting and LSP source-location evidence.
  All passed; slowest 14.7 seconds.
- Required format, config budget, environment usage, generated freshness,
  command surface, workflow contract, 39/39 gate cases and whitespace checks passed.
- Source review confirmed compiler/task admission and storage safeguards survived
  the four-way source integration.

Hosted CI remains a separate exact-head record. These checks do not establish
full-platform, real-model, full-index, physical Windows-path or release acceptance.
The existing user-run index and its source/dependencies/configuration were untouched.

## Existing 14-item backlog reconciliation

The older retrieval/throughput plan was already implemented in the merged ancestry.
The follow-on branch retains it rather than recreating parallel owners:

| Item | Existing implementation checkpoint | Focused present-behavior evidence |
| --- | --- | --- |
| SQLite BM25 override | `a24f5dd7a` | `retrieval/ranking/bm25-sqlite-override` |
| Literal phrases and early constraints | `0a0d54e6b` | `retrieval/query/literal-phrase-and-eligibility` |
| Archive ranked continuation | `73d6a7ece` | `integrations/inference-history/ranked-continuation` |
| Actual optional FTS tables and defaults | `88fd16a6c`, `91c0d736d` | FTS null-default, optional-table, tokenizer and compaction fixtures |
| Writer reservations and committed checksums | `43f885b0f`, `318973622` | Global admission, writer critical-path and packed-checksum fixtures |
| Dependency-scoped reuse | `f261440b6`, `ec7857731` | Dependency signatures, stage checkpoint build/refresh, SCM provenance |
| Concurrent files, ordered post-fill HNSW | `3332fb6ff` | File thread caps and HNSW post-fill order |
| Batched physical cache I/O | `a1b2f82ac` | `embeddings/cache/batched-physical-storage` |
| Independent hybrid candidates | `339970eb2` | ANN independent-discovery and adaptive-routing fixtures |
| Lazy embedding and warm reuse | `554306988` | `retrieval/cache/embedding-process-reuse` |
| Shared multilingual analyzer | `e829869b5` | `indexing/tokenization/multilingual-symmetry` |
| Diverse evidence and reranker hooks | `faa3ce3ee` | Evidence selection/reranker and deterministic bundles |
| Useful presets/evidence controls | `06b85ad31` | `retrieval/cli/search-controls` |
| Archive facets/original grouping/semantics | `75834fc2a`, `1afa5e1fe` | Native discovery and ranked continuation; real-corpus semantics remain separately qualified |

The 27 exact test IDs associated with these slices passed again on the follow-on
tree, with zero retries, skips or timeouts; slowest 10.6 seconds. They are small
fixtures, not a new corpus/model benchmark. Existing archive originals, stable
citations, unknown dates and optional enrichment boundaries remain preserved.

New work is the runtime audit, strict queryless structured enumeration, terminal
presentation, and the newly reproduced grouped-tail defect. The
[tail-packing receipt](embedding-tail-packing-2026-10-12.md) records its bounded fix.
