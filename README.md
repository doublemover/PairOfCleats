# PairOfCleats

<p align="center">
  <img src="./clete.png" alt="PairOfCleats logo" width="96" />
</p>

**PairOfCleats is a local-first Codebase Intelligence Engine.**

It turns a repository into a structured, searchable, explainable intelligence layer that can be used by developers, services, CI, and LLM-driven tools.

Instead of treating a codebase like a pile of files, PairOfCleats builds deterministic artifacts for code, prose, extracted document text, and normalized records, then serves that intelligence through search, graph analysis, context-pack generation, APIs, MCP, a queue-backed indexing service, a packaged TUI, and editor integrations.

## Why It Matters

Most repository tooling stops at one layer:

- text search
- symbol lookup
- embeddings retrieval
- graph analysis
- API serving

PairOfCleats is built to combine those into one engine.

That matters when you want to ask higher-value questions such as:

- Where is a symbol defined, used, imported, or called?
- What changed, what is impacted, and which tests should I run?
- Which files are related to a concept, not just a keyword?
- How do I search source code, docs, extracted PDF or DOCX text, and machine-generated records together?
- How do I expose the same repository intelligence to humans, automation, and LLM clients?

In short: PairOfCleats is for teams that need more than grep, but still want operational discipline instead of a fragile prototype.

## What You Get

PairOfCleats exposes the same engine through multiple product surfaces:

- CLI commands for setup, indexing, validation, search, graph workflows, and workspace operations
- hybrid search across code, prose, extracted-prose, and records
- graph-aware impact analysis and architecture checks
- bounded context packs for downstream tools and model workflows
- HTTP API endpoints for search and repository intelligence
- a queue-backed indexing service for long-running or background work
- an MCP server for AI tooling integration
- a packaged terminal UI
- editor integrations for local workflows

## Why "Codebase Intelligence Engine"

Because the real product is not just search.

Search is one interface on top of a deeper layer that understands repository structure, language-specific file behavior, relations, graph artifacts, and retrieval policy.

That deeper layer can be reused to support:

- search
- explainable ranking
- symbol and relation lookup
- architecture analysis
- change impact analysis
- test suggestion
- code maps
- multi-repo workspace search
- context assembly for tools and models

## Quick Start

### 1. Install dependencies

```powershell
npm install
```

### 2. Run guided setup

```powershell
pairofcleats setup
```

This can validate config, install optional tooling, download dictionaries and models, verify the SQLite vector extension, and prepare the environment for indexing.

### 3. Build the index

```powershell
pairofcleats index build --mode all
```

### 4. Validate the build

```powershell
pairofcleats index validate
```

### 5. Search

```powershell
pairofcleats search --mode code -- "where is query cache invalidated?"
pairofcleats search --mode prose --json -- "release packaging matrix"
```

### 6. Optional service surfaces

```powershell
pairofcleats service api
pairofcleats service indexer work --watch
```

## The Short Version

PairOfCleats works in two broad phases:

1. It builds repository intelligence artifacts.
2. It serves those artifacts through retrieval and analysis surfaces.

At a high level:

```text
Repository files
  -> discovery and mode classification
  -> language-aware chunking and metadata extraction
  -> imports, relations, graph artifacts, postings, vectors
  -> deterministic artifact writing and build promotion

User query or API request
  -> parse and plan
  -> load compatible artifacts and choose backends
  -> sparse retrieval + ANN retrieval + fusion
  -> relation/graph/context-aware ranking
  -> stable human or machine-readable output
```

## Core Concepts

### Modes

PairOfCleats indexes four primary modes:

- `code`: source files and code-oriented artifacts
- `prose`: markdown, docs, and prose-like text
- `extracted-prose`: text extracted from documents such as PDF and DOCX
- `records`: normalized structured records produced by ingest or analysis flows

These modes can be searched independently or together, and they can use different artifact and backend paths.

### Local-First Build Roots

The engine is artifact-first and local-first.

- A repository resolves to a repo identity.
- That identity maps to a cache root.
- Each build is written to a build root under that cache root.
- A successful build updates `builds/current.json`.

Typical layout:

```text
<cacheRoot>/repos/<repoId>/builds/<buildId>/index-code
<cacheRoot>/repos/<repoId>/builds/<buildId>/index-prose
<cacheRoot>/repos/<repoId>/builds/<buildId>/index-extracted-prose
<cacheRoot>/repos/<repoId>/builds/<buildId>/index-records
<cacheRoot>/repos/<repoId>/builds/current.json
```

### Canonical Artifacts First, Accelerators Second

The canonical output of PairOfCleats is a manifest-driven set of file artifacts.

SQLite, LMDB, and ANN-friendly stores are acceleration layers built from those artifacts, not the only durable form of the index.

This is one of the project's strongest design decisions. It keeps builds inspectable, portable, reproducible, and easier to validate.

## Who This Is For

PairOfCleats is useful when a repository needs to support more than one kind of consumer:

- developers searching locally
- CI pipelines validating or comparing builds
- services answering repository queries over HTTP
- LLM clients requesting structured context or search results
- operators running background indexing or workspace-wide search

It is especially useful when the repository is large, mixed-language, documentation-heavy, or spread across multiple repos that still need to be queried as one logical system.

## How the Engine Is Built

The sections above explain the product. The rest of this README explains how that product works.

## Runtime and Policy Layer

PairOfCleats is explicit about runtime policy instead of burying it in ad hoc defaults.

The runtime layer is responsible for:

- environment parsing
- config normalization
- quality and capability policy selection
- queue and thread sizing
- subprocess environment shaping
- progress, logging, and telemetry conventions

This makes the engine behave more like infrastructure software than a lightweight script. Runtime decisions are visible, bounded, and reusable across indexing, retrieval, services, and tooling.

## Language Intelligence

Language handling is descriptor-driven.

PairOfCleats does not just map file extensions to parsers. For each language or file type, it can define:

- how the file is recognized
- how it should be chunked
- what metadata should be extracted
- how imports and relations should be collected
- which parser path should be preferred
- which fallback path should be used when richer analysis is unavailable

That allows the engine to stay useful on real repositories, including messy ones where the ideal parser is not always available.

Supported analysis paths include combinations of:

- managed adapters
- heuristic adapters
- config-file adapters
- Tree-sitter-backed parsing
- JavaScript and TypeScript AST stacks
- Python AST subprocess pooling

The practical outcome is strong fail-soft behavior. When richer analysis is available, PairOfCleats uses it. When it is not, the engine still tries to produce something useful and compatible instead of collapsing entirely.

## Index Build Pipeline

Indexing is staged, explicit, and deterministic.

At a high level, a build proceeds like this:

1. Resolve the repo root, configuration, runtime policy, and output roots.
2. Discover files and assign them to one or more indexing modes.
3. Process files with language-aware chunking and metadata extraction.
4. Build imports, relations, graph data, postings, and vector artifacts.
5. Write deterministic artifact sets under the build root.
6. Optionally materialize accelerated SQLite or ANN-oriented structures.
7. Validate the result and promote the build.

Capabilities in this pipeline include:

- watch mode
- staged execution
- two-stage or background enrichment
- incremental bundle reuse
- extracted document text indexing
- type, graph, and risk-oriented enrichment
- embeddings generation or embeddings queueing
- validation before promotion

This is where PairOfCleats earns the "engine" framing. The build does not just produce a search index. It produces a reusable artifact graph that other surfaces depend on.

## Retrieval Pipeline

Search in PairOfCleats is hybrid and policy-aware.

At query time, the engine can:

1. parse and classify the query
2. resolve repo, mode, snapshot, and backend context
3. load compatible artifacts and side indexes
4. run sparse retrieval
5. optionally run ANN retrieval
6. fuse, rerank, explain, and format the result

Retrieval features include:

- query planning and caching
- exact and token-oriented matching
- SQLite FTS
- BM25-style sparse ranking
- ANN and vector search
- relation boosts
- graph-aware ranking
- mode-aware filtering
- workspace and federated search
- explain and stats output

The result is a retrieval stack that can behave like a fast local search tool when needed, but can also provide more structured and context-aware answers when the workflow demands it.

## Storage and Retrieval Backends

PairOfCleats can operate across several storage and retrieval backends depending on policy, capabilities, and installed dependencies.

### File-Backed Artifacts

These are the canonical build products.

They can include:

- chunk metadata
- token, phrase, and chargram postings
- file metadata
- relation and graph artifacts
- index state
- vector payloads

### SQLite

SQLite is the main accelerated backend.

It supports use cases such as:

- FTS-backed sparse retrieval
- compact searchable stores
- dense vector side tables
- faster query-serving paths
- incremental or service-friendly retrieval flows

### LMDB

LMDB is available as an alternate artifact-oriented backend for workflows that benefit from that storage model.

### ANN Providers

ANN support can route through multiple providers, including:

- SQLite vector extension
- HNSW
- LanceDB
- dense in-memory fallback providers

The important point is not that every backend is always enabled. It is that the engine has a policy-aware path for choosing compatible acceleration strategies without changing the underlying artifact model.

## Graph, Context, and Workspace Intelligence

This is where the system clearly moves beyond search.

### Graph and Impact

The graph layer can build bounded neighborhoods around a seed, compute impact sets, enforce architecture rules, and suggest tests from repository structure.

That makes PairOfCleats useful not only for "find me this thing," but also for "what else is connected to this thing, and what should I care about next?"

### Context Packs

Context packs assemble a bounded, provenance-stamped slice of the repository for downstream tools or models.

A context pack can include combinations of:

- a seed excerpt
- graph neighborhood
- type facts
- import and usage context
- supporting metadata for downstream interpretation

This is especially useful when feeding repository context into another system that needs structure and boundaries instead of a raw dump of files.

### Code Maps

The map layer can produce:

- machine-readable code maps
- DOT exports
- HTML or SVG views
- an isometric visualization surface

### Workspaces and Federation

PairOfCleats can treat multiple repositories as one searchable workspace.

The workspace layer handles:

- repo identity and canonicalization
- workspace config loading
- per-repo manifest generation
- compatibility and availability checks
- federated cache and retrieval roots

This matters for organizations where the architecture is spread across many repos but the questions users ask still cross repo boundaries.

## Service and Integration Surfaces

### CLI

The CLI is the main operator and developer interface.

It covers workflows such as:

- setup and bootstrap
- index build, watch, validate, stats, snapshot, and diff
- search
- workspace manifest, status, and build
- graph context, context packs, architecture checks, impact, and test suggestion
- alternate backend builds
- tooling doctor flows
- ingest and reporting workflows

### HTTP API

The API surface exposes repository intelligence to services and remote clients.

Typical capabilities include:

- repo status
- search
- federated workspace search
- streaming status or search responses
- metrics
- index snapshots
- index diffs

### Queue-Backed Indexer Service

The indexer service supports longer-running operational workflows such as:

- repo sync
- queued indexing work
- queued embeddings work
- queue draining
- retries
- stale-job recovery
- API-spawned background execution

### MCP

PairOfCleats includes an MCP surface for AI tooling integration.

That layer can expose search, indexing, downloads, bootstrap flows, triage, and artifact-oriented operations to MCP-compatible clients.

### TUI

The packaged terminal UI is split into a terminal application layer and a supervising runtime layer.

That allows the system to support a richer interactive experience while still keeping process control, event flow, and protocol behavior explicit.

### Editor Integrations

Editor integrations make the engine usable in normal local workflows.

The current shape is:

- VS Code as a focused search-oriented integration
- Sublime Text as a broader surface for search, indexing, validation, watch mode, and map-oriented workflows

## Operator Tooling

The `tools/` tree is a substantial part of the product, not just maintenance glue.

It includes support for:

- setup and bootstrap
- tooling detect, install, and doctor workflows
- model, dictionary, and extension downloads
- artifact inspection and validation
- alternate backend builds
- evaluation and model comparison
- code-map export
- benchmarks
- ingest from ctags, GNU Global, LSIF, and SCIP
- triage and analysis workflows

This tooling is one reason the project feels operationally serious. It is designed to be installed, diagnosed, repaired, and exercised as a system.

## Runtime Requirements

### Hard requirements

- Node.js `>=24.13.0`
- npm
- a normal source-checkout install with dev dependencies available

Why dev dependencies matter:

- this repository applies required patch files during install
- production-only installs can fail if those patches are present but patch tooling is unavailable

### Optional capabilities

- Python 3 for Python-related tooling, tests, and AST paths
- SQLite vector extension for faster ANN paths
- LMDB, LanceDB, and HNSW backends when enabled by policy and capability
- document extraction dependencies for PDF and DOCX flows

## Configuration

Repo-local configuration lives in `.pairofcleats.json`.

A simple example:

```json
{
  "cache": {
    "root": "C:/absolute/path/to/cache"
  }
}
```

Configuration covers much more than cache roots. It can normalize settings for:

- indexing
- retrieval
- runtime
- tooling
- MCP
- SQLite
- LMDB
- dictionaries
- models

## Testing and Reliability

The test suite is one of the strongest parts of the repository.

The deepest coverage is concentrated in areas that tend to fail in real systems:

- indexing
- retrieval
- shared runtime
- tooling
- storage
- services
- TUI

Those tests emphasize:

- deterministic output and hashing
- artifact and manifest safety
- path traversal and trust-boundary defense
- scheduler deadlock and backpressure handling
- subprocess cleanup
- workspace and federated search correctness
- service and protocol contracts
- snapshot and as-of correctness

Run the test runner:

```powershell
node tests/run.js --lane ci-lite
node tests/run.js --lane ci
node tests/run.js --lane ci-long
node tests/run.js --lane gate
```

List lanes and tags:

```powershell
node tests/run.js --list-lanes
node tests/run.js --list-tags
```

## What Makes This Good

The best parts of PairOfCleats are concentrated in the hard parts:

- staged build orchestration
- compatibility-safe artifact loading
- aggressive but controlled fallback behavior
- deterministic output contracts
- bounded graph and context generation
- hardened service and protocol surfaces
- explicit scheduling and cleanup hygiene
- deep testing around failure cases, not just happy paths

That is why the project reads more like infrastructure software than a thin developer utility.

## Current Shape and Limits

The codebase is strong, but it is not pretending every surface is equally mature.

Relative to the core engine:

- the indexing, retrieval, runtime, service, and tooling layers are deeper than the editor integrations
- VS Code is currently a lighter integration than Sublime Text
- graph and context features are strong, but some higher-level slices are thinner than the indexing and retrieval core

Those are maturity differences inside a codebase that is still unusually serious in its fundamentals.

## Project Layout

High-level structure:

- `src/`: core engine, runtime, retrieval, graph, workspace, storage, integrations
- `bin/`: top-level CLI and TUI wrappers
- `tools/`: setup, operational tooling, API, MCP, reports, ingest, service, benchmarks
- `tests/`: custom test runner, fixtures, subsystem and product tests
- `extensions/`: VS Code integration
- `sublime/`: Sublime Text integration
- `crates/`: Rust TUI binary

## License

License not yet specified in this repository.
