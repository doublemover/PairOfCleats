# PairOfCleats

<p align="center">
  <img src="./clete.png" alt="PairOfCleats logo" width="96" />
</p>

**Find code, follow its connections, and bring the right context to your next change.**

PairOfCleats builds a local, searchable view of source code, documentation and
structured records. It combines text retrieval with language-aware chunks,
metadata and relationships, then makes that index available through a CLI,
editors, services and tools for coding agents.

The useful result is more than a matching file: a function or section with its
location, relevant metadata and connections you can follow. You can search for
an implementation, inspect its callers or imports, explore a change's impact,
and collect the source context needed to work on it.

## Why it matters

Repository work usually starts with a question: where is this behavior implemented,
what else depends on it, or what should I read before changing it? PairOfCleats
keeps the search and follow-up investigation connected.

- **Search code and its explanation together.** Code, prose, extracted document
  text and normalized records have separate modes, so you can look for an
  implementation, the design behind it or the record that points to a problem.
- **Use the structure of code to narrow a search.** Paths, languages, symbol
  metadata and relation filters help you find a useful match. Where fielded
  postings are available, ranking can distinguish a name or signature match from
  a word buried in a body or documentation.
- **Follow evidence from a match.** Imports, calls and other indexed relationships
  support impact analysis, test suggestions and code maps. Context expansion and
  context packs can bring neighboring source into the next step of an investigation.
- **Reuse one analysis across interfaces.** A developer can browse results in an
  editor, a script can consume JSON, and an agent can request a bounded context
  pack from the same indexed repository.
- **Reuse work as the project changes.** Incremental indexing can reuse unchanged
  file analysis, while query-plan and result caches reuse repeated search work
  within their configured limits.
- **Keep the source context visible.** File locations and build metadata help you
  check a result's origin. Optional Git metadata adds author, change-history and
  chunk-attribution context, with filters for authorship and modification time.
- **Choose the cost of richer analysis.** Sparse search works without embedding
  models. Optional language tools, embeddings and additional backends add their
  own capabilities and setup costs; you can enable the parts your workflow needs.

For example, a search result can point directly to a function and its source span:

```text
1. renderSearchOutput
  src/retrieval/cli/render.js:[20-60]                     3/28/26 7:00AM
  renderSearchOutput(options)
```

*Example captured from a tiny checked-in output fixture with the current formatter;
location/date metadata is illustrative.*

If you are changing a shared cache helper, the next useful steps might be to
inspect its callers, look at the affected tests, and assemble those source
excerpts into a context pack. You can keep the investigation focused instead of
having to assemble the same surrounding information by hand for every tool.

## Who it is for

| Audience | A useful starting point |
| --- | --- |
| Developers and maintainers | Locate implementations, navigate unfamiliar modules and check connected code before making a change. |
| Reviewers | Inspect dependencies, compare indexed builds and explore potentially affected code and tests. |
| Coding agents and tool builders | Request structured search results, exact source locations and context with explicit limits. |
| Teams working across repositories | Search a workspace of repositories and expose a consistent index through local services or editor integrations. |

Mixed-language and documentation-heavy projects can use the same workflow while
keeping each language's actual analysis coverage visible. Start with a small
repository and the sparse-search path below, then add richer analysis as needed.

## What you get

| Capability | What it helps you do |
| --- | --- |
| Code-aware search | Combine terms, phrases, path/language filters and available symbol or relation metadata; inspect ranking with `--explain`. |
| Optional hybrid retrieval | Combine lexical and vector result lists when models and vector artifacts are configured. Rank fusion lets the two contribute without treating their raw scores as the same scale. |
| Impact and test suggestions | Explore indexed dependencies around a change and identify tests worth reviewing. |
| Context packs | Collect source excerpts and supporting relationships inside explicit result, traversal and output limits. |
| Code maps and architecture checks | Explore or export repository structure and inspect configured dependency rules. |
| Snapshots, diffs and as-of search | Compare indexed builds and query a selected historical index rather than mixing it with the current one. |
| Workspace search | Query indexes from several repositories as one workspace while preserving repository identity. |
| Incremental indexing and caches | Reuse unchanged file analysis and repeated query work when cache settings permit. |
| Git-aware metadata | Add authorship and change context to searches when that metadata is available. |
| Watch/background indexing | Keep selected repositories indexed through watch mode or a queue-backed indexing service. |
| Human and machine output | Browse results in the terminal or request JSON, compact projections, explanations and supporting context. |

The CLI is the easiest entry point. HTTP, MCP, the terminal UI and editor
integrations provide other ways to use these capabilities, with their own setup
or build requirements. The interfaces and references are linked below.

## Quickstart

The current install path is a source checkout with **Node.js 26.x**
and npm. Native dependencies may require a C/C++ toolchain and Python 3 when
compatible prebuilt binaries are unavailable.

```sh
git clone https://github.com/doublemover/PairOfCleats.git
cd PairOfCleats
npm run bootstrap:ci
```

Development dependencies are needed to apply the checkout's required patches.
The examples run the CLI directly, so you do not need a global command install.

Normal CLI commands, test runs and benchmark entry points refuse to start when
bootstrap is missing, incomplete or stale. Run `npm run bootstrap` from this
checkout to install dependencies, apply required patches and rebuild/verify native
modules; `npm run bootstrap:ci` performs the same steps with the pinned lockfile.
No command silently installs dependencies or substitutes a fallback for this gate.
The saved verification evidence is checked against current setup inputs, runtime
and dependency artifacts, followed by small SQLite-query and parser-activation
probes. It is not merely an “installed” marker and does not rerun setup on launch.

For a first sparse-search build, merge this into the target project's
`.pairofcleats.json`; embedding models and automatic tool installation stay optional:

```json
{
  "indexing": { "embeddings": { "enabled": false, "mode": "off" } },
  "tooling": { "autoInstallOnDetect": false, "autoEnableOnDetect": false }
}
```

Replace `"path/to/your-project"` below with the repository you want to search.
Run from the PairOfCleats checkout:

```sh
node bin/pairofcleats.js index build --repo "path/to/your-project" --mode code --threads 1 --no-sqlite
node bin/pairofcleats.js search --repo "path/to/your-project" --mode code --backend memory --top 5 -- "cache"
```

Use a word or symbol from your project. For a more selective search, add
`--path src`, a language filter or a quoted phrase. Use `--json --compact` for
structured results and `--explain` to inspect ranking.

The [first-search guide](docs/guides/first-search.md) covers configuration
validation, resource controls and documentation search. [Guided setup](docs/guides/setup.md)
is available when you want optional dictionaries, models, language tools or SQLite.

## How the pipeline works

PairOfCleats does the repository analysis when building an index, then searches
the resulting artifacts. The build and query stages have different jobs:

1. **Discover and classify files.** Repository roots, ignore rules and mode
   selection determine which code, prose, documents or records are included.
2. **Build useful chunks and metadata.** Parsers and format handlers identify
   functions, sections and other searchable units, retain source ranges, and
   collect available imports, relations, annotations and supporting metadata.
   Optional tooling can enrich the result where its integration supports it.
3. **Write the index.** Token postings, filters, graph data and chunk metadata
   become file artifacts. Configured database and vector stores provide
   additional retrieval paths. Build metadata and validation help you inspect the
   completed index selected for search.
4. **Plan and execute a query.** The query parser resolves terms, phrases and
   filters. Sparse ranking uses BM25 or an alternate backend; optional vector
   ranking can contribute through fusion and configured boosts.
5. **Return the right context.** Results retain file locations and metadata.
   Explanations, related context and graph workflows provide follow-up evidence;
   the output layer shapes it for people or structured clients.

```text
Files and records
  -> discovery and language-aware chunks
  -> metadata, relations, postings and optional vectors
  -> reusable index artifacts and configured backend stores

Query
  -> terms, phrases and filters
  -> retrieval, ranking and optional context expansion
  -> source-located results and context for the next step
```

This separation lets several interfaces reuse completed indexing work. It also
keeps analysis, storage and retrieval choices distinct: an optional database or
vector backend does not define which source-language facts were extracted.
See the [architecture guide](docs/guides/architecture.md) for the detailed stages.

## Storage and retrieval choices

The base index is a set of file artifacts containing chunks, postings, metadata
and related data. SQLite, LMDB and optional search engines add retrieval paths
alongside those artifacts. This makes the build inspectable and reusable across
interfaces, while letting you choose a backend that fits your workload.

### Sparse search and metadata storage

| Choice | What it provides | Tradeoff to consider |
| --- | --- | --- |
| File-backed `memory` | The lowest-setup retrieval path: search the file artifacts directly. A straightforward starting point for a small repository. | Active postings and metadata consume process memory; the useful corpus size depends on the workload and configuration. |
| `sqlite` | Persistent structured lookup and database-backed retrieval alongside sparse ranking and metadata. Useful when you want the built SQLite store. | Requires a built SQLite index and its native runtime. Some filters and metadata still live in process memory. |
| `sqlite-fts` | SQLite FTS5 as an alternate sparse result list. | FTS ranking/tokenization has its own behavior; BM25 remains the reference for the project's default sparse tuning. |
| `lmdb` | Memory-mapped key-value lookup. A choice to evaluate for larger indexes or repeated key-based reads. | Requires separate LMDB artifacts and native support; mapped files and readers have their own resource lifetimes. |
| `tantivy` | An optional Rust-backed sparse engine with its own index builder and retrieval adapter. | Experimental/optional setup. Bounded global candidate retrieval followed by filtering can underfill very selective queries. |

`--backend auto` selects among available backends using the index and configured
thresholds. Explicit SQLite or LMDB choices require their corresponding index;
they fail when it is missing. Records-only search uses its file-backed record
index. Use an explicit backend when comparing behavior or diagnosing a query.

### Optional vector search

Vector retrieval requires configured embedding models and matching vector
artifacts. It complements sparse search when similarity is useful for the query;
you can inspect the returned source and ranking evidence before relying on a match.

| Choice | What it provides | Setup and scope |
| --- | --- | --- |
| JavaScript (`js`) | A vector retrieval path without a separate native ANN index. | Uses the stored vectors; CPU and memory work grow with the indexed vectors. |
| HNSW (`hnsw`) | Graph-based approximate nearest-neighbor retrieval. | Requires its native module and a compatible built index. |
| SQLite vector (`sqlite`) | Vector retrieval alongside SQLite storage. | Requires the vector extension/index setup; the current SQLite ANN route uses merged vectors. |
| LanceDB (`lancedb`) | Local ANN retrieval through an optional vector store. | Requires the optional package and its built artifacts. |

These are capability and storage choices, not benchmark promises. Representative
latency, memory and retrieval quality depend on the corpus, filters and platform.
The [backend guide](docs/guides/external-backends.md) and
[embedding guide](docs/guides/embeddings.md) explain the configuration and limits.

## From a result to a change

Search, graph tools and context packs can form a small investigation:

1. Find an implementation using a term or symbol, then narrow it by path or language.
2. Follow available imports/calls and inspect nearby source to understand its role.
3. Explore impact and test suggestions before changing a shared owner.
4. Export focused context or machine-readable results for the next tool or reviewer.

Use [code maps](docs/guides/code-maps.md) to browse structure,
[graph commands](docs/contracts/graph-tools-cli.md) for impact/context workflows,
or [workspace setup](docs/specs/workspace-config.md) when the code spans repositories.
The same index can support a human browsing interactively and a client asking
for only the evidence it needs.

## What to expect

Language analysis has several layers: syntax structure, imports/relationships,
types and navigation. Coverage varies by language, format and optional tooling;
the [language-support record](docs/guides/language-toolchain-acceptance.md) explains
supported features and tested limits. Heuristic and syntax-only routes remain
useful partial analysis. Indexed relationships can miss dynamic behavior, so
impact and test suggestions are starting points for source review.

Choose the modes you need: `code`, `prose`, `extracted-prose` or `records`.
PDF/DOCX text extraction is an optional indexing path; it does not imply OCR or
complete layout interpretation. Richer analysis and larger repositories need
their own resource choices. The first-search guide keeps a small initial setup
easy to inspect, and links the controls for expanding it.

## Interfaces and documentation

The CLI is the simplest place to start. Other interfaces have separate setup or
build requirements:

- [VS Code and Sublime Text](docs/guides/editor-integration.md)
- [HTTP services](docs/guides/service-mode.md)
- [MCP](docs/guides/mcp.md)
- [Interactive TUI](docs/guides/tui.md)

For detail: [search behavior and output](docs/guides/search.md),
[commands](docs/guides/commands.md), [configuration](docs/config/contract.md),
[architecture](docs/guides/architecture.md) and
[optional backends](docs/guides/external-backends.md).

For coding agents and contributors, the single
[repository work guide](docs/agents.md) links instructions, source owners and
validation references.

The package is currently marked private; no license file is included in this checkout.
