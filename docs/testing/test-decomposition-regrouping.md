# Test Suite Decomposition & Regrouping Plan

## Context / problem
The test surface is currently flat and extremely broad:

- The repository historically had many executable scripts directly under `tests/*.js` (now reorganized into subsystem folders).
- Many of those scripts were *not single-purpose tests*; they were **multi-domain suites** that validate artifacts, indexing, search, filters, protocol behavior, and error handling in one run.
- This structure makes failures hard to triage ("one red test" can mean many unrelated things), and it encourages a proliferation of one-off scripts and npm entries.

This document identifies the **largest / most multi-responsibility test scripts** that should be split, and proposes a **manageable regrouping** of the overall test suite into coherent chunks.

## Guiding principles

1. **One responsibility per test file**
   - A failure should immediately suggest the subsystem at fault (indexer, search filters, sqlite schema, MCP, etc.).

2. **Prefer contract tests over end-to-end when possible**
   - Keep a small number of high-signal end-to-end tests; move most assertions into contract/unit tests that run faster and fail more precisely.

3. **Make grouping obvious from paths and ids**
   - A test's directory should tell you what it validates.

4. **Keep today's scripts runnable during migration**
   - Splitting is phased: new tests can be introduced alongside existing scripts, then old scripts retired when coverage is equivalent.

5. **Avoid incidental coupling**
   - Tests that start servers, bind ports, mutate local repos, or use shared cache roots should be isolated and tagged as such.

## Proposed grouping (manageable "chunks")

Introduce a small set of top-level test groups (these become runner lanes/tags and folder names over time):

1. **`runner/`** -- meta-tests and suite controllers
   - script-coverage harness, discovery checks, suite sanity

2. **`unit/`** -- pure logic (no indexing, no servers)
   - parsers, scorers, tokenization, normalization

3. **`indexing/`** -- build-time and artifact contracts
   - `build_index` outputs, chunk metadata invariants, postings integrity

4. **`retrieval/`** -- search behavior and filter semantics
   - query parsing, filters, scoring outputs, determinism

5. **`storage/`** -- SQLite/LMDB backends and migrations
   - schema versioning, incremental updates, corruption handling

6. **`services/`** -- API and MCP servers
   - endpoint contracts, protocol framing, error handling

7. **`tooling/`** -- external tooling integration and enrichment
   - LSP enrichment, cross-file inference tooling, worker process contracts

8. **`perf/`** -- benchmarks and performance guardrails
   - benches, perf regressions, throughput/heap checks

These eight groups are few enough to be learnable and broad enough to cover the repo.

## Inventory: largest multi-responsibility suites (and what to do about them)

Sizes below are approximate (filesystem block sizes) and are used only to prioritize refactors.

| File | Approx. size | What it currently mixes | Recommended action |
|---|---:|---|---|
| `tests/lang/contracts/*.test.js` (split suite) | 32 KB | index build, postings validation, search filters, per-language AST/docmeta assertions, risk flow assertions | Split completed across `tests/indexing/language-fixture/*.test.js`, `tests/retrieval/filters/*.test.js`, and `tests/lang/contracts/*.test.js` |
| `tests/perf/bench/run.test.js` | 24 KB | benchmark harness + correctness self-checks + build orchestration | **Move to `perf/`** and split scenarios |
| `tests/indexing/fixtures/*.test.js` (split suite) | 18 KB | fixture generation, artifact presence, minhash checks, search invariants, compact json shape, language-specific assertions | Split completed across `tests/indexing/fixtures/*.test.js`, `tests/retrieval/contracts/*.test.js`, `tests/retrieval/filters/*.test.js`, and `tests/lang/fixtures-sample/*.test.js` |
| `tests/retrieval/parity/parity.test.js` | 13 KB | cross-backend parity runner + reporting + thresholds | Keep as tool-like test; optionally split reporting |
| `tests/indexing/type-inference/crossfile/crossfile-output.integration.test.js` + `tests/tooling/type-inference/crossfile-stats.unit.test.js` | 12 KB | unit-ish inference stats + full index build + graph relations assertions | Split complete: keep unit + integration separation |
| `tests/services/mcp/*.test.js` | 9 KB | protocol init, tools registry, build-index tool, search tool, filters, progress events, error behavior | Split complete across MCP contract areas |
| `tests/storage/sqlite/incremental/*.test.js` | 8 KB | incremental index build, sqlite build, manifest normalization, schema downgrade/rebuild, search check | Split complete across incremental + schema/migration + normalization |
| `tests/retrieval/filters/query-syntax/*.test.js` + `tests/retrieval/filters/file-and-token/*.test.js` | 8 KB | git repo setup + query parser behavior + author/time/branch filters + file/token case semantics | Split complete by filter family |
| `tests/indexing/type-inference/crossfile/type-inference-crossfile-go.test.js` | 7 KB | Go-specific cross-file inference behavior + index build | Consider splitting similarly to JS cross-file |
| `tests/tooling/triage/*.test.js` | 7 KB | triage ingest, markdown rendering, decision updates, records indexing/search, context-pack assembly | Split complete by triage pipeline stage |
| `tests/indexing/type-inference/providers/type-inference-lsp-enrichment.test.js` | 6 KB | multi-language LSP enrichment (C++/Swift/Python) | Optional split by language; keep together if stable |
| `tests/services/mcp/mcp-schema.test.js` | 6 KB | tool schema snapshot + server response shape snapshot | Optional: split snapshot types |
| `tests/services/mcp/mcp-robustness.test.js` | 6 KB | queue overload + tool timeout scenarios | Split into two tests (queue vs timeout) |
| `tests/services/api/*.test.js` | 6 KB | startup + health/status + search + request validation + repo authorization + no-index | Split complete by endpoint family |
| `tests/services/api/api-server-stream.test.js` | 6 KB | stream-specific behavior | Keep separate; consider splitting by stream mode |

The remainder of the suite can be regrouped largely by path/tagging without splitting, but the above scripts are the biggest "multipliers" for confusion and should be tackled first.

---

## Detailed split plans (by script)

### 1) Language fidelity suite (split across indexing/retrieval/lang)

**Legacy responsibilities (formerly in one file):**
- Builds a language fixture index.
- Validates postings payload integrity (including sharded postings metadata).
- Runs search queries to validate **filter flags** (`--branches`, `--inferred-type`, `--return-type`, `--returns`, `--async`, file regex, risk tags/flows).
- Validates chunk metadata across many languages and file types (JS/TS, Go, Python, Swift, ObjC/C, Rust, C++, Java, SQL dialects, Dockerfile/Makefile, Bazel, etc.).

**Proposed split (new tests):**

**Indexing artifact integrity** (`indexing/language-fixture/`)
- `indexing/language-fixture/postings-integrity.test.js`
  - Token postings counts are integers; shards enumerated correctly.
- `indexing/language-fixture/chunk-meta-exists.test.js`
  - `chunk_meta.json` + `file_meta.json` basics and resolvers.

**Search filter semantics** (`retrieval/filters/`)
- `retrieval/filters/control-flow.test.js` (branches)
- `retrieval/filters/types.test.js` (inferred-type, return-type)
- `retrieval/filters/behavioral.test.js` (returns, async)
- `retrieval/filters/file-selector.test.js` (file regex)
- `retrieval/filters/risk.test.js` (risk tag + risk flow)

**Language/format contracts** (`lang/contracts/`)
- `lang/contracts/javascript.test.js` (aliases, inferred locals, class extends, async modifiers)
- `lang/contracts/typescript.test.js` (extends + alias tracking + inferred types)
- `lang/contracts/python.test.js` (dataclass fields, nested functions, awaits, controlFlow)
- `lang/contracts/go.test.js` (docstrings + call graph + control flow)
- `lang/contracts/sql.test.js` (dialect metadata + dataflow/controlFlow presence)
- `lang/contracts/misc-buildfiles.test.js` (Dockerfile/Makefile/Bazel/CMake/Nix/templates)

**Why this split helps:**
- Filter failures become clearly "retrieval filter regression" instead of "language fidelity broke."
- Per-language regressions are isolated (Python changes do not fail CMake checks).
- Index artifact integrity failures become a single targeted failure.

**Regrouping:**
- Most of these belong to `integration` lane, but they can also be tagged for selective runs:
  - tags: `lang`, `filters`, `risk`, `indexing-artifacts`

---

### 2) Fixture smoke suite (split by contract area)

**Legacy responsibilities:**
- Iterates fixtures (or single fixture), optionally runs a generator.
- Builds memory index and sqlite index.
- Validates a long list of required artifact files.
- Validates chunk weights and minhash signatures.
- Runs searches across backends (`memory`, `sqlite-fts`) and checks scoring/shape invariants.
- Verifies compact JSON output excludes certain fields.
- Runs "sample fixture" language-specific assertions (Python decorators/signature; Swift attributes/signature; Rust signature).
- Validates search filter flags (`--ext`, `--path`, `--type`, `--signature`, `--decorator`).

**Proposed split:**

**Fixture build + artifacts** (`indexing/fixtures/`)
- `indexing/fixtures/build-and-artifacts.test.js`
  - Builds indexes for fixture(s) and checks required artifacts exist.
- `indexing/fixtures/minhash-consistency.test.js`
  - Minhash signatures align with tokens; weights are finite.

**Search output contracts** (`retrieval/contracts/`)
- `retrieval/contracts/result-shape.test.js`
  - `score`, `scoreType`, `scoreBreakdown.selected` invariants.
- `retrieval/contracts/compact-json.test.js`
  - Forbidden fields absent when compact output requested.

**Fixture-scoped filter semantics** (`retrieval/filters/`)
- `retrieval/filters/ext-path.test.js`
- `retrieval/filters/type-signature-decorator.test.js`

**Language spot-checks (fixture sample only)** (`lang/fixtures-sample/`)
- `lang/fixtures-sample/python-metadata.test.js`
- `lang/fixtures-sample/swift-metadata.test.js`
- `lang/fixtures-sample/rust-metadata.test.js`

**Regrouping:**
- `indexing/fixtures/*` in `integration` lane.
- `lang/fixtures-sample/*` optional tag `lang` (run in CI if stable; otherwise nightly).

---

### 3) SQLite incremental suite (split by behavior axis)

**Legacy responsibilities:**
- Builds incremental index + sqlite index.
- Asserts sqlite build output contains "Validation (smoke) ok ...".
- Uses `better-sqlite3` to read `file_manifest` and validate hash/chunk_count change after a file edit.
- Runs search after update.
- Mutates incremental manifest to use Windows-style backslashes and verifies normalization.
- Forces schema downgrade and verifies rebuild on schema mismatch.

**Proposed split:**

`storage/sqlite/incremental/`:
- `storage/sqlite/incremental/file-manifest-updates.test.js`
  - Hash changes + chunk_count present after incremental run.
- `storage/sqlite/incremental/search-after-update.test.js`
  - Updated content becomes searchable (backend `sqlite-fts`).
- `storage/sqlite/incremental/manifest-normalization.test.js`
  - Backslash normalization path handling.

`storage/sqlite/migrations/`:
- `storage/sqlite/migrations/schema-mismatch-rebuild.test.js`
  - Downgrade user_version and verify rebuild restores current schema version.

**Regrouping:**
- All belong to `storage` lane; include in `ci` if runtime acceptable.

---

### 4) Search filter suite (split by filter family)

**Legacy responsibilities:**
- Creates a git repo with authored commits at different times.
- Builds index.
- Tests:
  - negative tokens and negative phrases
  - phrase scoring breakdown
  - chunk-author filter
  - modified-after / modified-since filters
  - branch filter
  - file filter case sensitivity + regex
  - token case sensitivity
  - punctuation token matching (code mode)

**Proposed split:**

`retrieval/filters/query-syntax/`:
- `retrieval/filters/query-syntax/negative-terms.test.js`
- `retrieval/filters/query-syntax/phrases-and-scorebreakdown.test.js`

`retrieval/filters/git-metadata/`:
- `retrieval/filters/git-metadata/chunk-author.test.js`
- `retrieval/filters/git-metadata/modified-time.test.js`
- `retrieval/filters/git-metadata/branch.test.js`

`retrieval/filters/file-and-token/`:
- `retrieval/filters/file-and-token/file-selector-case.test.js`
- `retrieval/filters/file-and-token/token-case.test.js`
- `retrieval/filters/file-and-token/punctuation-tokenization.test.js`

**Regrouping:**
- These are integration tests (need git + indexing) but can be tagged `git` and excluded where git is unavailable.

---

### 5) MCP server suite (split into MCP contract areas)

**Legacy responsibilities:**
- JSON-RPC framing + initialization.
- Tool registry (`tools/list`).
- Tool calls: `index_status`, `config_status`, `build_index`, `search`, `clean_artifacts`.
- Asserts progress notifications.
- Validates default compact outputs.
- Validates error payloads for missing repo and missing indexes.

**Proposed split:**

`services/mcp/`:
- `services/mcp/protocol-initialize.test.js`
- `services/mcp/tools-list.test.js`
- `services/mcp/tool-index-status.test.js`
- `services/mcp/tool-config-status.test.js`
- `services/mcp/tool-build-index-progress.test.js`
- `services/mcp/tool-search-defaults-and-filters.test.js`
- `services/mcp/errors.test.js` (missing repo, missing index)
- `services/mcp/mcp-robustness.test.js` (queue overload, cancellation, timeout)
- `services/mcp/mcp-runner-abort-kills-child.test.js`

**Regrouping:**
- `services` lane; tag `mcp`.

---

### 6) API server suite (split by endpoint family)

**Legacy responsibilities:**
- Builds fixture index.
- Starts API server (port 0), parses startup JSON.
- Validates `/health`, `/status`.
- Validates `/search` default output + errors:
  - invalid requests (missing query)
  - unknown fields
  - forbidden repo path
  - missing index returns NO_INDEX

**Proposed split:**

`services/api/`:
- `services/api/health-and-status.test.js`
- `services/api/search-happy-path.test.js`
- `services/api/search-validation.test.js`
- `services/api/repo-authorization.test.js`
- `services/api/no-index.test.js`

**Regrouping:**
- `services` lane; tag `api`.

---

### 7) Cross-file inference suite (split unit vs integration)

**Legacy responsibilities:**
- Unit-like scenarios using `applyCrossFileInference()` directly (stats assertions).
- Full index build on a synthetic repo and validation of:
  - inferred return types (`Widget`)
  - call links + summaries
  - usage links
  - `graph_relations.json` call/usage graphs

**Proposed split:**

`tooling/type-inference/`:
- `tooling/type-inference/crossfile-stats.unit.test.js` (pure function)

`indexing/type-inference/`:
- `indexing/type-inference/crossfile-output.integration.test.js` (build_index output contracts)

**Regrouping:**
- unit part in `unit` lane.
- integration part in `integration` lane.

---

### 8) Triage records suite (split by pipeline stage)

**Legacy responsibilities:**
- Ingest multiple sources (`generic`, `dependabot`, `aws_inspector`).
- Validate stored JSON + rendered markdown contain exposure metadata.
- Apply a decision.
- Build code index and records index.
- Search records with meta filters.
- Create a context pack and validate it contains history and repo evidence.

**Proposed split:**

`tooling/triage/`:
- `tooling/triage/ingest-generic.exposure.test.js`
- `tooling/triage/ingest-sources.smoke.test.js` (dependabot + inspector minimal)
- `tooling/triage/decision.test.js`
- `tooling/triage/records-index-and-search.test.js`
- `tooling/triage/context-pack.test.js`

**Regrouping:**
- `tooling` lane (or `integration` if you keep tooling under integration). Tag `triage`.

---

### 9) Bench suite (move + split scenarios)

**Legacy responsibilities:**
- Bench CLI parsing + validation.
- Correctness self-checks (safe-regex guards).
- Optional index build orchestration.
- Executes search workloads with concurrency and histogram stats.

**Proposed restructure:**

`perf/bench/`:
- `perf/bench/run.test.js` (or `run.js` if treated as a tool, not a test)
- `perf/bench/scenarios/`
  - `memory-vs-sqlite.js`
  - `sqlite-fts.js`
  - `ann-on-off.js`
  - `bm25-params.js`

Benchmarks should generally be excluded from default CI; include in a `perf` lane.

---

## Regrouping the rest (without splitting everything)

Once the large scripts above are decomposed, the remainder of the test suite can be made manageable primarily by **re-homing files into the group folders** and tagging them. A pragmatic migration approach:

### Phase 1 -- Tag-and-lane only (no file moves)
- Establish lane membership using a small mapping (runner manifest).
- Keep files in place but expose only a few lanes.

### Phase 2 -- Move tests into group folders (mechanical)
- Move files into `tests/<group>/...` while preserving ids via a manifest.
- Create thin compatibility shims only where necessary.

### Phase 3 -- Remove deprecated suites
- Remove the monolith scripts once the split tests cover the same assertions.

## Success criteria

- A developer can answer "what should I run?" with one of ~6 lanes.
- The largest multi-domain scripts are split so failures point to a subsystem.
- CI can run the `ci` lane deterministically with clear logs and minimal flake.
- The test tree communicates intent through folder structure and ids.
