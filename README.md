# PairOfCleats

<p align=center><img src="https://github.com/doublemover/PairOfCleats/blob/main/clete.png" width=10% height=10%></img></p>

Local-first hybrid indexing and retrieval for source repositories.

PairOfCleats builds deterministic index artifacts for code and prose, then runs mixed sparse + dense retrieval with strict contracts around artifacts, schemas, and cache identity.

## Runtime Requirements

Hard requirements:
- Node.js `>=24.13.0` (`.nvmrc` is `24.13.0`)
- npm (normal dependency install; scripts enabled)

Important install requirement:
- Source-checkout installs are expected to include dev dependencies so required patches can be applied.
- `npm ci --omit=dev` / production-only installs can fail in this repo when required `patches/*.patch` files are present.

Optional capabilities:
- Python 3 (for Python-related tooling/tests and optional AST paths)
- sqlite-vec extension (faster ANN path when available)
- LMDB / LanceDB / HNSW backends (selected by policy and capability)
- PDF/DOCX extraction dependencies (capability-gated document extraction flows)

## What It Provides

- CLI: `pairofcleats <command>`
- HTTP API: `pairofcleats service api`
- Indexer service worker: `pairofcleats service indexer`
- MCP server mode via tooling scripts (`npm run mcp-server`)

Primary CLI surface:
- `setup`
- `bootstrap`
- `index build`
- `index watch`
- `index validate`
- `search`
- `lmdb build`

## Quick Start

Install:
```bash
npm install
```

Guided setup (recommended):
```bash
pairofcleats setup
```

Non-interactive bootstrap:
```bash
pairofcleats bootstrap
```

Build and validate:
```bash
pairofcleats index build --mode all --quality balanced
pairofcleats index validate
```

Search:
```bash
pairofcleats search -- "where is query cache invalidated?" --mode code
pairofcleats search -- "release matrix and packaging" --mode prose --explain --json
```

Start API server:
```bash
pairofcleats service api
```

## Mental Model

PairOfCleats is a two-plane system:
- Build plane: deterministic artifact production
- Retrieval plane: query planning, candidate generation, scoring, and output shaping

Core data model:
- Repo identity -> cache root -> build root -> per-mode index roots
- Modes: `code`, `prose`, `extracted-prose`, `records`
- Contract-first artifacts with manifest-first loading

High-level flow:

```text
Repo files
  -> discovery + mode classification
  -> chunking + metadata + postings + relations
  -> artifact pieces + manifest + build_state
  -> optional sqlite/ann materialization
  -> builds/current.json promotion

Query
  -> parse + plan + intent
  -> candidate prefilter
  -> sparse rank (BM25 / sqlite-fts)
  -> dense rank (ann providers)
  -> fusion + boosts + explain
  -> stable output (human or json)
```

## Build Pipeline (Technical)

1. Runtime envelope:
- config resolution + policy normalization
- concurrency and capability resolution

2. Discovery and classification:
- ignore rules + file caps
- deterministic mode assignment

3. Foreground indexing:
- chunk extraction and metadata
- sparse artifacts (postings/chargrams/filter index)
- per-mode artifact writing with manifest entries

4. Background enrichment:
- tree-sitter/lint/risk/embeddings (policy-gated)
- optional ANN materialization paths

5. Promotion:
- validation gate
- `builds/current.json` update only after successful build

## Retrieval Pipeline (Technical)

1. Query parse and routing:
- query-plan construction
- mode-aware tokenization and routing

2. Candidate generation:
- filter index and chargram prefilter for path/file constraints
- backend/provider availability checks

3. Ranking:
- sparse ranking (`bm25` or `sqlite-fts`)
- dense ranking (ann providers based on capability/policy)

4. Fusion and output:
- RRF or blend policy
- deterministic tie-breaking
- optional `--explain` score breakdown and pipeline stats

5. Cache behavior:
- query cache keys include retrieval-relevant knobs and index identity
- strict manifest-first index loading by default

## Artifact and Cache Layout

Default cache layout is outside the repository:
- `<cacheRoot>/repos/<repoId>/builds/<buildId>/index-code`
- `<cacheRoot>/repos/<repoId>/builds/<buildId>/index-prose`
- `<cacheRoot>/repos/<repoId>/builds/<buildId>/index-extracted-prose`
- `<cacheRoot>/repos/<repoId>/builds/<buildId>/index-records`
- `<cacheRoot>/repos/<repoId>/builds/current.json`

Set custom cache root in `.pairofcleats.json`:
```json
{
  "cache": {
    "root": "C:/absolute/path/to/cache"
  }
}
```

## Query Notes

Core syntax:
- `"exact phrase"`
- `-term`
- `-"excluded phrase"`

Mode flags:
- `--mode code`
- `--mode prose`
- `--mode extracted-prose`
- `--mode records`
- `--mode all`

Diagnostics:
- `--explain` for ranking/routing details
- `--stats` for pipeline timing and memory checkpoints
- `--json` for machine-readable output

## Testing and CI Lanes

Run a lane:
```bash
node tests/run.js --lane ci-lite
node tests/run.js --lane ci
node tests/run.js --lane ci-long
```

Run with parallel jobs and timing outputs:
```bash
node tests/run.js --lane ci-long --jobs 4 --log-times .testLogs/ci-long-testRunTimes.txt --timings-file .testLogs/ci-long-timings.json
```

List lanes/tags:
```bash
node tests/run.js --list-lanes
node tests/run.js --list-tags
```

## Learn More

Architecture and pipelines:
- [`docs/guides/architecture.md`](docs/guides/architecture.md)
- [`docs/guides/search.md`](docs/guides/search.md)
- [`docs/perf/retrieval-pipeline.md`](docs/perf/retrieval-pipeline.md)
- [`docs/perf/index-artifact-pipelines.md`](docs/perf/index-artifact-pipelines.md)

Contracts and schemas:
- [`docs/contracts/indexing.md`](docs/contracts/indexing.md)
- [`docs/contracts/search-contract.md`](docs/contracts/search-contract.md)
- [`docs/contracts/artifact-contract.md`](docs/contracts/artifact-contract.md)
- [`docs/contracts/search-cli.md`](docs/contracts/search-cli.md)
- [`docs/config/schema.json`](docs/config/schema.json)
- [`docs/config/contract.md`](docs/config/contract.md)

SQLite and ANN:
- [`docs/sqlite/index-schema.md`](docs/sqlite/index-schema.md)
- [`docs/sqlite/ann-extension.md`](docs/sqlite/ann-extension.md)
- [`docs/guides/external-backends.md`](docs/guides/external-backends.md)

Setup, service, and integrations:
- [`docs/guides/setup.md`](docs/guides/setup.md)
- [`docs/guides/service-mode.md`](docs/guides/service-mode.md)
- [`docs/api/server.md`](docs/api/server.md)
- [`docs/api/mcp-server.md`](docs/api/mcp-server.md)
- [`docs/guides/mcp.md`](docs/guides/mcp.md)
- [`docs/guides/editor-integration.md`](docs/guides/editor-integration.md)

Advanced roadmap features and specs:
- [`docs/specs/index-refs-and-snapshots.md`](docs/specs/index-refs-and-snapshots.md)
- [`docs/specs/index-diffs.md`](docs/specs/index-diffs.md)
- [`docs/specs/federated-search.md`](docs/specs/federated-search.md)
- [`docs/specs/workspace-config.md`](docs/specs/workspace-config.md)
- [`docs/specs/workspace-manifest.md`](docs/specs/workspace-manifest.md)
- [`docs/specs/progress-protocol-v2.md`](docs/specs/progress-protocol-v2.md)
- [`docs/specs/node-supervisor-protocol.md`](docs/specs/node-supervisor-protocol.md)

Testing and reliability:
- [`docs/testing/test-runner-interface.md`](docs/testing/test-runner-interface.md)
- [`docs/testing/truth-table.md`](docs/testing/truth-table.md)
- [`docs/testing/ci-capability-policy.md`](docs/testing/ci-capability-policy.md)

## License

License not yet specified in this repository.

