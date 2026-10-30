# Choose and prepare a backend

Start with [first search](first-search.md) and a verified application checkout.
Sparse search backend, vector provider and artifact storage are different choices.
Installed package bytes, selectable adapters, built representations and qualified
workloads are separate states.

| Sparse route | Required selected artifacts | Behavior |
| --- | --- | --- |
| `memory` | File-backed postings and metadata for the selected mode | Supported by the canonical search wrapper; bypasses SQLite/LMDB |
| `sqlite` / `sqlite-fts` | Compatible SQLite representation for the selected build | Forced selection fails if unavailable; no silent backend fallback |
| `lmdb` | Compatible LMDB representation | Forced selection fails if unavailable; separate LMDB build owner |
| `auto` | Available representations and current selection thresholds | Uses the current backend-selection owner; inspect the observed backend |
| `tantivy` | Optional external module with the adapter's expected API and built Tantivy artifacts | Experimental; the root package does not declare/install the module |

`auto` selection considers `search.sqliteAutoChunkThreshold` and
`search.sqliteAutoArtifactBytes`; accepted zero values disable the respective
threshold. Records-only search uses file-backed records and reports its forced-
backend limitation. Review the current [selection owner](../../src/retrieval/cli/normalize-options.js)
and provider diagnostics instead of assuming a package or directory is ready.

## Bounded sparse recipes

<!-- poc:recipe backend-memory-build shell=portable effects=derived-build -->
```sh
node bin/pairofcleats.js index build --repo "path/to/your-project" --mode code --threads 1 --no-sqlite
node bin/pairofcleats.js index validate --repo "path/to/your-project" --mode code
node bin/pairofcleats.js search --repo "path/to/your-project" --mode code --backend memory --top 5 -- "cache"
```

To deliberately include SQLite, use the current index-build owner and validate
the selected mode before forcing it:

<!-- poc:recipe backend-sqlite-build shell=portable effects=derived-build -->
```sh
node bin/pairofcleats.js index build --repo "path/to/your-project" --mode code --threads 1 --sqlite
node bin/pairofcleats.js index validate --repo "path/to/your-project" --mode code
node bin/pairofcleats.js search --repo "path/to/your-project" --mode code --backend sqlite --top 5 -- "cache"
```

There is no `pairofcleats sqlite build` route. The current direct LMDB builder is
`node tools/build/lmdb-index.js --repo <target> --mode code`; build it only against
a compatible selected file-backed generation, then deliberately search with
`--backend lmdb`. Its native prerequisite is not established by a file-backed pass.
See [SQLite incremental behavior](../sqlite/incremental-updates.md) and the
[artifact contract](../contracts/artifact-contract.md).

Tantivy rebuilds publish an immutable payload with a schema-2 source receipt.
An old receipt requires rebuilding against the selected source generation. The
reader adapter requires synchronous open/search and a handle or module close
whose completion confirms disposal; unsupported lifetime APIs fail explicitly.
The optional module is absent from the current installation and lockfile.
Twenty-one deterministic adapter controls pass for source-pinned publication,
failed/cancelled/concurrent builds, activation and original reader-close
ownership. Supported native rebuild/readback remains separately unqualified;
these protocol controls do not establish an installed native backend.

Installing a package named `tantivy` does not establish this adapter contract.
No third-party native binding is currently pinned or qualified here. For example,
[`@harperfast/fulltext` 0.7.0](https://github.com/HarperFast/fulltext/blob/v0.7.0/ts/native.ts)
provides asynchronous readers/search and an `english@2` raw-text analyzer, whereas
this adapter consumes source-token postings and synchronous ranked ordinals.
[`@oxdev03/node-tantivy-binding` 0.3.3](https://github.com/oxdev03/node-tantivy-binding/blob/v0.3.3/src/index.rs)
has synchronous index/search APIs but no explicit index-reader close operation;
its writer's `waitMergingThreads()` does not close a reader. Their Windows native
packages therefore require a reviewed integration and actual Node26 readback and
lifetime qualification; package aliases or garbage collection cannot supply the
missing contract.

## Vectors and ANN

LanceDB is a declared root dependency whose use is optional; it is not listed as
an `optionalDependency`. Its artifacts and configured ANN selection still need
validation. SQLite vector extensions, HNSW and file-backed dense representations
have their own runtime/artifact requirements. Follow
[embeddings](embeddings.md) for provider/model/dimensions/precision/format identity
and explicit acquisition. Never substitute another model/provider or treat missing
native activation as an empty successful query.

Exact versus approximate candidates, bounded overfetch and selective filters can
limit recall. The Tantivy adapter obtains a bounded global candidate list before
allowed-ID filtering; small eligible sets can underfill requested results. A
larger-scale or ANN-heavy recommendation needs measured, matching workload
qualification; these choices alone do not establish faster or better retrieval.

## Evaluation-only alternatives

Meilisearch and Typesense are research alternatives, not integrated product
backends. Their dependency research sheets are background material, not installation
recipes or current package recommendations. Planned retrieval experiments do not
change shipped selection behavior until their consuming implementation and
qualification land. The recipes above and optional-native platform coverage are
**UNVALIDATED** in the current development batch.
