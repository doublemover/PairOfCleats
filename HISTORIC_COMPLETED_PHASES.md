# Completed phases

# Phase 1 — Truth Alignment, Spec Freeze, and Correctness Harness

**Objective:** Establish the authoritative definition of “what the tool does,” then encode it into tests, validations, and reproducible fixtures so every subsequent phase is measurable.

## 1.1 Feature truth table (claims → evidence → tests → limitations)

### Dependency guidance (best choices)
- `ajv` — model the truth table itself as a JSON Schema and **validate it in CI** so the “claims → evidence → tests → limits” ledger can’t silently drift.
  - Compile schemas once at startup (`new Ajv({ strict: true, allErrors: true })`), not per file/run.
- `jsonc-parser` — if feature flags or config files are JSONC, use offset-aware parsing (`getLocation`, `parseTree`) so you can attach *precise* diagnostics to a feature claim.
- `semver` — version every claim bundle and feature gate using semver ranges rather than ad-hoc strings.

- [x] Build `docs/truth-table.md` that covers:
  - [x] Build modes: code / prose / records / mixed
  - [x] Chunking rules (by language and file type)
  - [x] Tokenization semantics (code vs prose)
  - [x] Index artifact outputs (memory + sqlite + shard formats)
  - [x] Search semantics (filters, scoring, explain)
  - [x] Enrichment outputs (risk, types, relations, git)
  - [x] Service/API/MCP behavior (contracts, stability expectations)
- [x] For each claim:
  - [x] link to implementation module(s)
  - [x] list configuration toggles
  - [x] list known limitations / failure modes
  - [x] identify a fixture-based test that demonstrates it

## 1.2 Acceptance-test fixtures and golden expectations

### Dependency guidance (best choices)
- `seedrandom` — make all randomized fixture generation deterministic (seed = repo hash + test name), so flaky “random repos” never block correctness gates.
- `xxhash-wasm` — use fast, stable hashing to derive fixture IDs and to detect unintended fixture drift (hash raw inputs + normalized outputs).

- [x] Add fixture repos representing:
  - [x] small: <1k files mixed code/prose
  - [x] medium: 5k–50k files with mixed languages
  - [x] multi-language mixed-file repo (HTML+JS+CSS, markdown code fences, etc)
- [x] Define “must-hit” retrieval assertions:
  - [x] symbol lookup (name/kind)
  - [x] structural filters (e.g., `--kind`, `--signature`, `--decorator`)
  - [x] risk filter behavior (even if basic initially)
  - [x] type inference visibility (even if minimal initially)

## 1.3 Tool invocation correctness (install-root vs repo-root)

### Dependency guidance (best choices)
- `execa` — standardize all subprocess calls (git, node, pnpm) with robust quoting, streaming output capture, timeouts, and non-throwing exit handling.
  - Prefer `reject: false` and check `exitCode` explicitly; capture `stdout`, `stderr`, and combined `all` output.
- `semver` — validate runtime/tool versions (Node, npm/pnpm, optional native deps) and emit actionable errors early.

- [x] Implement and require a single resolver:
  - [x] `resolveToolRoot()` (ESM-safe, based on `import.meta.url`)
  - [x] `resolveRepoRoot()` (explicit > inferred; deterministic)
- [x] Convert *all* scripts that spawn other scripts/tools to use toolRoot resolution.
- [x] Add tests that run commands from a directory **outside** repoRoot.

## 1.4 Determinism and reproducibility baseline

### Dependency guidance (best choices)
- `seedrandom` — seed any randomized ordering (file traversal, shard selection, benchmark query generation).
- `xxhash-wasm` — deterministic hashing for chunk IDs and segment IDs; avoid crypto hashes unless explicitly required.
- `msgpackr` — if you snapshot intermediate artifacts for determinism tests, prefer MsgPack for speed and stable binary outputs.

- [x] Ensure build artifacts include:
  - [x] tool version, node version, OS, effective config hash
  - [x] repo provenance (git commit + dirty flag when available)
- [x] Establish a deterministic test mode:
  - [x] deterministic embedding stub (by default in tests)
  - [x] deterministic ordering everywhere (files, shards, chunk IDs)

**Deliverables**
- `docs/truth-table.md`
- fixture repos + goldens
- installed-package E2E test suite

**Exit criteria**
- Tier-1 E2E tests pass reliably (Linux) and are reproducible locally.
- “Truth table” coverage: every user-visible feature claim has a test or explicit limitation.

---

# Phase 2 — Artifact Contracts, Metadata Schema v2, and Atomic Build Durability

**Objective:** Make artifacts and metadata self-describing, versioned, validated, and crash-safe.

## 2.1 Artifact contract (schema + invariants)

### Dependency guidance (best choices)
- `ajv` — enforce artifact schema invariants (index file, shard manifests, metadata v2, benchmark outputs) as a hard gate.
  - Consider Ajv standalone validation for hot-path validation during large builds (generate validators once).
- `msgpackr` — use for compact, fast serialization of intermediate shard artifacts (especially metadata-rich chunks).
  - Prefer a versioned envelope (magic bytes + schema version + codec version) so upgrades are safe.
- `fflate` — compress large artifacts (shards, posting lists) with streaming APIs to avoid event-loop stalls.
- `xxhash-wasm` — compute stable content hashes and IDs efficiently; cache initialized WASM instance and reuse.
- `roaring-wasm` (optional but high ROI) — represent posting lists and large ID sets as compressed bitmaps for fast intersection/union.
  - Explicitly call `dispose()` on bitmaps to avoid WASM memory growth.
- `better-sqlite3` — if SQLite is a backend, standardize on prepared statements + WAL mode + transactional writes for durability.
- `lmdb` (optional) — consider as an alternative backend for very high write throughput; gate behind optional dependency/feature flag (install friction).

- [x] Define/refresh `docs/artifact-contract.md`:
  - [x] every artifact file + format + version
  - [x] required fields + optional fields
  - [x] invariants (cross-artifact) and validation rules
- [x] Strengthen `tools/index-validate`:
  - [x] schema validation per artifact
  - [x] cross checks: chunk IDs, file references, postings references, embedding references
  - [x] human remediation hints for each failure class

## 2.2 **Metadata schema v2** (rich per-chunk metadata contract)

### Dependency guidance (best choices)
- `ajv` — treat **Metadata Schema v2** as the canonical contract.
  - Encode “required when …” rules as schema + additional runtime checks (Ajv can’t express every cross-field invariant cleanly).
- `semver` — version metadata schema independently from the index container version; negotiate reader compatibility.

This is the foundation for advanced rich metadata, risk flows, and type inference.

- [x] Create `docs/metadata-schema-v2.md` defining:
  - [x] stable core: `chunkId`, `file`, `segment`, `range`, `lang`, `ext`, `kind`, `name`
  - [x] provenance: `generatedBy`, `tooling`, `parser`, versions
  - [x] doc metadata: signature, docstring/doc-comments, annotations, decorators/attributes
  - [x] control-flow summary: branches/loops/returns/throws/awaits/async/generator
  - [x] dataflow summary: reads/writes/mutates/aliases (local first; later cross-file)
  - [x] dependencies: imports, referenced modules, includes
  - [x] risk metadata: sources/sinks/sanitizers/flows (+ confidence)
  - [x] type metadata: declared/inferred/tooling (+ confidence)
  - [x] embedded metadata: segment parent, embedded language, embedding context
- [x] Define compatibility rules with existing `docmeta`:
  - [x] migration mapping from current fields to v2 fields
  - [x] deprecation schedule for legacy keys

## 2.3 Atomic build and “current” pointer

### Dependency guidance (best choices)
- `better-sqlite3` — implement “current pointer” and multi-stage build state updates as **atomic transactions**.
  - Use WAL journaling; keep write transactions short and bounded.
- `fflate` — if “current pointer” points at compressed shard bundles, stream compress/decompress rather than buffering whole bundles.

- [x] Build to staging directory `builds/<buildId>/...` (default format: `YYYYMMDDTHHMMSSZ_<gitShortSha|nogit>_<configHash8>`)
- [x] Validate staging artifacts before promoting to “current”
- [x] Ensure readers never see partial outputs:
  - [x] atomic rename/swap semantics
  - [x] sqlite temp file + rename
  - [x] shard manifest atomicity

## 2.4 Durable state machine for multi-stage builds

### Dependency guidance (best choices)
- `better-sqlite3` / `lmdb` — persist the build state machine (stage, shard progress, error ledger, tool versions, input manifest hashes) in a durable store.
  - Prefer append-only event logs + periodic snapshots rather than in-place mutation only.
- `pino` — log state transitions as structured events (runId, shardId, stage, timings, error category).
- `prom-client` — expose state machine counters/histograms for throughput and failure rates (per stage, per language).

- [x] Create a build state model with explicit phases:
  - [x] discovery → preprocessing → stage1 → stage2 → stage3 → validation → promote
- [x] Ensure stage2/stage3 jobs cannot remain “running forever”:
  - [x] heartbeat timestamps: persist `lastHeartbeatAt` every **30s** while a job is `running`
  - [x] stale job detection: consider a job stale if `now - lastHeartbeatAt` exceeds:
    - [x] **10 minutes** for stage2 (enrichment; mostly CPU + local IO)
    - [x] **15 minutes** for stage3 (embeddings; can be longer-running, but heartbeat is independent of work duration)
  - [x] recovery policy: mark stale jobs as `failed` and re-queue up to **2 retries** (default) with exponential backoff (**2m**, **10m**)
  - [x] resumable checkpoints: persist progress at least every **1,000 files** or **120 seconds** (whichever comes first)

**Deliverables**
- `docs/artifact-contract.md`
- `docs/metadata-schema-v2.md`
- hardened `index-validate`
- atomic build/promotion implementation + tests

**Exit criteria**
- Killing the process mid-build never corrupts last-known-good index.
- Any index can be validated deterministically; schema v2 is published and enforced.

---

# Phase 3 — Generalized Hybrid Chunking and Prose Extraction (Correctness)

**Objective:** Make file segmentation and chunking correct for real-world mixed files (embedded languages) and ensure comments are consistently extracted and searchable as prose when desired.

## 3.1 Introduce a **SegmentedDocument** pipeline

### Dependency guidance (best choices)
- `file-type` + `istextorbinary` — aggressively avoid parsing binaries; detect via magic bytes first, then fallback heuristics.
- `chardet` + `iconv-lite` — only attempt encoding detection/decoding when UTF-8 decoding fails; preserve byte offsets by tracking decoding strategy.
- `fdir` — fast directory traversal (significantly faster than naive `fs.readdir` recursion).
- `ignore` — implement `.gitignore` semantics correctly (and cache per-directory ignore matchers).
- `picomatch` — precompile include/exclude globs for the segment discovery pre-pass (don’t recompile per file).
- `linguist-languages` — unify extension → languageId mapping, but keep project overrides (repo-local config) higher priority.

- [x] Define a new internal representation:
  - [x] `FileDocument { file, bytes, text, ext, langHint }`
  - [x] `Segment { segmentId, type: code|prose|config|comment|embedded, languageId, start, end, parentSegmentId?, meta }`
  - [x] `Chunk { chunkId, segmentId, start, end, name, kind, metaV2 }`
- [x] Replace “single chunker per file” with:
  1) segment discovery
  2) per-segment chunking
  3) chunk merging + stable ordering + overlap rules

## 3.2 Mixed-file support coverage (beyond HTML)

### Dependency guidance (best choices)
- Markdown / MDX / prose containers:
  - `micromark` — extract **exact byte ranges** of headings, paragraphs, and fenced code blocks (language from info string).
  - `yaml` + `smol-toml` + `jsonc-parser` — parse frontmatter blocks into config segments with node/range provenance.
  - `@mdx-js/mdx` — for MDX, compile with plugins disabled by default; enable remark/rehype plugins only when requested (performance).
- Web component containers:
  - `@vue/compiler-sfc` — use `parse()` to get descriptor blocks and their `loc`/range; treat template/script/style as segments and preserve ordering.
  - `svelte` — use compiler `parse()`; extract `<script>`/`<style>`/markup regions via node ranges.
  - `@astrojs/compiler` — parse frontmatter and template; treat embedded scripts/styles as segments with correct languageId.
- Infrastructure / config / DSL:
  - `dockerfile-ast` — parse Dockerfile into instruction nodes; keep comments and continuations intact.
  - `fast-xml-parser` — parse XML with `preserveOrder` when positional/ordering matters for chunk boundaries.
  - `graphql` — use `parse()` + `visit()` to extract definitions and references with location mapping.
  - `protobufjs` — parse `.proto` to reflection model for symbol metadata and cross-file references.
- Templates:
  - `@handlebars/parser` — parse templates into AST to extract helpers/partials and embedded JS-like expressions as metadata.
  - `nunjucks` — prefer API-supported parsing paths (custom tags expose parser API); treat templates as prose+embedded expressions if full AST isn’t stable.

Implement segment discovery + chunking for at least:

- [x] Markdown/RST/AsciiDoc:
  - [x] heading segments (existing)
  - [x] fenced code blocks (```lang) as **embedded code segments**
  - [x] inline code spans as optional micro-segments (configurable; concrete defaults):
    - [x] `indexing.segments.inlineCodeSpans = false` (default)
    - [x] if enabled: only emit spans with **≥ 8** non-whitespace characters
    - [x] per-file caps: **≤ 200** spans AND **≤ 64 KiB** total inline-code bytes (truncate beyond cap)
  - [x] frontmatter blocks (YAML/TOML/JSON) as **config segments**
- [x] Web components and template containers:
  - [x] `.vue` (template/script/style)
  - [x] `.svelte` (script/style/template)
  - [x] `.astro` (frontmatter + template + style)
- [x] “HTML inside other languages” baseline:
  - [x] JSX/TSX: treat JSX regions as embedded markup segments (at least for metadata; chunk boundaries already exist)
- [x] JSON/YAML embedded inside comments or strings (best-effort):
  - [x] detect fenced blocks in comments/docstrings tagged `json`, `yaml`, `toml`
  - [x] treat them as embedded config segments if parseable

## 3.3 Comment extraction as first-class segments

### Dependency guidance (best choices)
- `@es-joy/jsdoccomment` — parse JSDoc blocks into structured AST; preserve descriptions as prose segments and tags/types as metadata.
  - Use `commentParserToESTree` when you need type expressions and tags integrated into an ESTree-like form.
- `jsdoc-type-pratt-parser` — parse complex JSDoc type expressions into AST; store both raw and normalized forms.
- `@typescript-eslint/typescript-estree` — for JS/TS, enable comment/tokens output to reliably extract all comments with ranges.
  - Prefer a non-type-aware parse for comment extraction (fast path), and only enable type-aware mode in Phase 4 when needed.

- [x] Implement a comment extraction layer per language:
  - [x] doc comments (existing behavior) as `comment:doc`
  - [x] inline comments (optional, configurable) as `comment:inline`
  - [x] block comments as `comment:block`
  - [x] license/header comments as `comment:license` (default: **extract but do not index**; searchable only when explicitly enabled)
- [x] Each comment segment must record:
  - [x] original language + comment style
  - [x] byte range and line range
  - [x] nearest symbol anchor (chunkId) when linkable
- [x] Add config toggles (with concrete defaults):
  - [x] `indexing.comments.extract = off|doc|all` (default: `doc`)
  - [x] `indexing.comments.includeLicense = false` (default; when false, emit `comment:license` segments but exclude from term postings)
  - [x] minimum length thresholds (defaults):
    - [x] doc comments: **≥ 15** non-whitespace characters after stripping markers
    - [x] inline/block comments: **≥ 30** non-whitespace characters after stripping markers
    - [x] after normalization/tokenization: **≥ 5** prose tokens (otherwise drop)
  - [x] skip patterns (defaults enabled; configurable allow/deny lists):
    - [x] license/header detector: if a comment is within the first **200 lines** and matches `copyright|license|spdx|apache|mit|gpl|bsd`
    - [x] generated detector: matches `generated by|do not edit|@generated|autogenerated`
    - [x] linter-noise detector: matches `eslint-disable|prettier-ignore|noinspection`

## 3.4 Prose-index strategy for comments and extracted prose

### Dependency guidance (best choices)
- `micromark` — for comment-prose indexing, treat fenced blocks inside comments/docstrings similarly to markdown fenced blocks.
- `lru-cache` — cache comment-prose normalization and snippet generation (bounded by sizeCalculation + TTL).
- `msgpackr` — if you create a dedicated prose index, serialize it separately with a small, versioned envelope for fast load/unload.

Two supported options (choose one as default, keep the other as optional):

**Option A — Separate “extracted-prose” index (recommended for clarity)**
  - [x] Build a distinct index mode: `mode=extracted-prose`
  - [x] Store comment segments + extracted prose blocks (frontmatter, docstrings, etc.)
  - [x] Use **prose tokenization** (stemming/stopwords) for these segments
  - [x] Search tool can query `code`, `prose`, and `extracted-prose` and fuse (RRF)

**Option B — Fielded indexing inside code chunks (DEFAULT)**
- [x] Keep a single code chunk and index comment-prose as a **separate field**:
  - [x] add `fieldTokens.comment` (normalized prose tokens from extracted inline/block comments)
  - [x] keep doc comments in `fieldTokens.doc` (existing behavior)
  - [x] store raw comment snippets in `docmeta.comments[]` for explain/snippet (not tokenized)
- [x] Default caps (configurable):
  - [x] max **5** comment segments per chunk (nearest-to-symbol first)
  - [x] max **8 KiB** total raw comment bytes per chunk (truncate + note `truncated=true`)
- [x] Default scoring weights (BM25 field weights; overrideable via `search.fieldWeights`):
  - [x] code intent: `comment=0.6`
  - [x] prose intent: `comment=1.8`
  - [x] mixed intent: `comment=1.2`
  - [x] path intent: `comment=0.4`

## 3.5 Correctness tests for segmentation and hybrid chunking

### Dependency guidance (best choices)
- `seedrandom` — generate stress fixtures deterministically (random mixed-language embedding + comment fences).
- `ajv` — validate that segmentation outputs comply with `SegmentedDocument` + metadata v2 schema before indexing.

- [x] Fixture files covering:
  - [x] HTML with script/style blocks (existing) + nested code/pre
  - [x] markdown with multiple fenced blocks + frontmatter
  - [x] Vue/Svelte/Astro files
  - [x] mixed json-in-comments (doc blocks)
- [x] Assert:
  - [x] segment boundaries correct (byte + line ranges)
  - [x] chunk boundaries correct (no overlaps unless explicitly allowed)
  - [x] embedded language detection correct enough (by tag/fence/lang attr)
  - [x] comment segments extracted according to config

**Deliverables**
- SegmentedDocument pipeline + segment discovery implementations
- comment extraction engine + config
- either “extracted-prose index” or fielded comment-prose indexing (or both, with a default)
- fixtures + tests

**Exit criteria**
- Mixed-language fixtures chunk correctly with stable IDs and validated invariants.
- Comments become searchable as prose **via the code-chunk `comment` field (Option B, default)**; extracted-prose mode remains optional, and both are validated by tests when enabled.

---

# Phase 4 — Advanced Rich Metadata, Advanced Risk Analysis, and Advanced Type Inference

**Objective:** Fully implement advanced versions of:
1) rich per-chunk metadata,
2) risk analysis (sources/sinks/flows), and
3) type inference,
with explicit provenance, confidence scoring, and testable correctness.

## 4.1 Rich metadata per chunk (schema v2 compliance)

### Dependency guidance (best choices)
- JS/TS structural metadata:
  - `@swc/core` — preferred for high-throughput parsing to AST (Rust); use when native deps are allowed and install is stable for your targets.
  - `typescript` — use compiler API for type-aware metadata (Program/TypeChecker); cache Programs per tsconfig.
  - `@typescript-eslint/typescript-estree` — when you need ESTree compatibility + TS node services; keep config minimal for speed.
  - `@babel/traverse` — traverse JS/TS ASTs for symbol extraction, call graphs, and reference collection.
  - `eslint/js` — derive lexical scopes/variable bindings (useful for risk analysis + metadata).
  - `esquery` — allow declarative AST queries for “extractor rules” without writing custom visitors.
- Data structure speedups:
  - `roaring-wasm` — store large sets of symbol IDs, callsites, and references compactly with fast set ops.
  - `xxhash-wasm` — hash AST node signatures and normalized identifiers for stable IDs.


## 4.2 Advanced **risk analysis**: sources / sinks / sanitizers / flows

### Dependency guidance (best choices)
- `@ast-grep/napi` — implement rule packs for sources/sinks/sanitizers using structural patterns (AST-level matching).
  - Use the JS API for integration; keep rule packs versioned and testable.
- `re2js` — use for user-supplied or configurable regex rules to avoid ReDoS in large repos.
- `aho-corasick` — accelerate “dictionary style” scanning (many fixed tokens like sink names, env var keys, SQL APIs) before expensive AST passes.
- `graphology` — represent flows as graphs (nodes = symbols/expressions/files; edges = dataflow/callflow/import).
  - Use traversal + shortest-path utilities for explainable flow paths.
- `roaring-wasm` — represent taint sets and reachability sets efficiently; union/intersection are hot-path ops for flows.

The current regex-based “sources × sinks” cartesian product is a useful baseline, but not advanced.

### 4.2.1 Risk rule system

### 4.2.2 Intra-procedural taint/dataflow (per chunk/function scope)

### 4.2.3 Inter-procedural flows (within file, then cross-file)

### 4.2.4 Risk metadata outputs

## 4.3 Advanced **type inference** (local + cross-file + tooling)

### Dependency guidance (best choices)
- `typescript` — primary for TS/JS type inference when a tsconfig exists; extract types with provenance (source, inferred, any/unknown).
  - Prefer incremental Programs (or reuse) rather than re-creating per file.
- `pyright` — primary for Python static typing; run via CLI with `--outputjson` for machine-readable results.
  - Cache pyright environment resolution per repo; treat missing stubs as low-confidence types.
- `protobufjs` — leverage schema-defined types for `.proto` files and for generated-code correlation when present.

### 4.3.1 Local type extraction upgrades


### 4.3.2 Cross-file inference engine

### 4.3.3 Tooling integration hardening (LSP and language servers)

### 4.3.4 Output schema and search integration

**Deliverables**
- [x] `docs/risk-rules.md` + risk rules bundle format
- [x] advanced risk engine (local → file → cross-file)
- [x] advanced type inference engine (local + cross-file + tooling)
- [x] v2 metadata completeness across core languages
- [x] fixtures and goldens for risk/types correctness

**Exit criteria**
- [x] Risk flows and type inference are correct on fixtures with documented conservative limitations.
- [x] `index-validate` can validate risk/type metadata invariants.
- [x] Enrichment never crashes indexing; it degrades gracefully with actionable logs.

---

# Phase 5 — Search Correctness, Parity, and Index Benchmarking Suite

**Objective:** Guarantee that search semantics are correct, explainable, and stable across backends, and add an index-evaluation tool that can auto-generate benchmark queries (10–100+ configurable) that exercise flags.

## 5.1 Search contract and explainability

### Dependency guidance (best choices)
- `roaring-wasm` — implement fast boolean retrieval operators (AND/OR/NOT) over postings; this underpins correctness + speed.
- `lru-cache` — query-result caching (per query plan signature); enforce size/TTL to prevent runaway memory.
- `msgpackr` — persist query plans and explain traces for debugging/benchmark replay.

- [x] Define `docs/search-contract.md`:
  - [x] ranking components and weights
  - [x] filter semantics and precedence rules
  - [x] how multi-mode results are fused (RRF rules)
  - [x] how metadata fields impact scoring and filtering
- [x] Implement a single explain schema across backends:
  - [x] lexical score components
  - [x] semantic score components
  - [x] filter decisions
  - [x] metadata boosts

## 5.2 Backend parity as a gate (memory vs sqlite vs sqlite-fts)

### Dependency guidance (best choices)
- `better-sqlite3` — SQLite backend parity testing: ensure identical semantics vs in-memory index.
- `lmdb` (optional) — if introduced as an alternate backend, add parity tests against SQLite and in-memory.

- [x] Define parity thresholds (concrete defaults; `K=5`):
  - [x] Gate policy (concrete default):
    - [x] memory vs sqlite: **blocking** (fails CI)
    - [x] memory vs sqlite-fts: **non-blocking warning** (until the backend is promoted from experimental)
  - [x] Parity scoring rule (concrete default):
    - [x] if both backends return **0 hits** for a given query+mode, treat `overlap@K = 1.0` and exclude that query+mode from `rankCorr` averaging
  - [x] memory vs sqlite (primary backend; blocking):
    - [x] `overlap@5` average **≥ 0.95** (code and prose evaluated separately)
    - [x] Spearman `rankCorr` average **≥ 0.90**
    - [x] `avgDelta` average **≤ 0.10**
    - [x] no single query with `overlap@5 < 0.60`
  - [x] memory vs sqlite-fts (experimental backend; warning-only):
    - [x] `overlap@5` average **≥ 0.70**
    - [x] Spearman `rankCorr` average **≥ 0.55**
    - [x] `avgDelta` average **≤ 0.50**
- [x] Create parity debug tooling:
  - [x] compare component-level scoring
  - [x] diff filters and metadata interpretation

## 5.3 **Index evaluator + benchmark query generator** (new)

### Dependency guidance (best choices)
- `tinybench` — microbench harness for parsing, chunking, indexing, and query operators (configurable runs, warmups).
- `hdr-histogram-js` — capture latency distributions (p50/p95/p99) across repeated queries and builds.
- `seedrandom` — deterministic benchmark query generation (seeded by index hash + config).
- `prom-client` — export benchmark metrics for dashboards/CI regression gates (histograms + counters).
- `@vscode/ripgrep` — baseline external comparator for lexical search latency + correctness on the same corpora.

This is the requested capability.

- [x] Implement benchmark query generator + runner (`tools/bench-query-generator.js`, `tests/bench.js`):
  - Inputs:
    - [x] index path (or repoRoot)
    - [x] number of queries (10–1000)
    - [x] random seed
    - [x] coverage targets (ensure flags are exercised)
  - Index analysis step:
    - [x] sample symbols by language/kind
    - [x] sample files by ext/size
    - [x] sample metadata values (decorators, risk tags, types, visibility, imports)
  - Query generation step:
    - [x] generate a mixed set:
      - [x] “name lookup” queries (symbol exact-ish)
      - [x] “natural language” queries
      - [x] filters-heavy queries exercising flags:
        - [x] `--lang`, `--ext`, `--file`, `--kind`
        - [x] `--calls`, `--uses`, `--reads`, `--writes`, `--mutates`, `--awaits`
        - [x] `--decorator`, `--signature`, `--param`, `--return-type`, `--inferred-type`
        - [x] `--risk`, `--min-risk-score` (or equivalent), flow existence filters
        - [x] `--modified-after`, `--author`, churn filters (where available)
      - [x] backend toggles:
        - [x] memory vs sqlite vs sqlite-fts
        - [x] ann on/off
        - [x] rrf/mrr/mmr toggles where available
    - [x] ensure at least `N = max(10, ceil(0.25 * queryCount))` queries include **multiple flags simultaneously**
  - Execution step:
    - [x] run the search CLI/core search with each query
    - [x] capture latency, candidate counts, and topK stability
  - Report step:
    - [x] JSON report + optional markdown summary
    - [x] per-flag coverage report (“did we exercise X?”)

- [x] Integrate into CI (smoke-level) and perf pipelines (tiered).

**Deliverables**
- [x] `docs/search-contract.md`
- [x] unified explain schema and parity tools
- [x] index benchmark suite generator + runner + reports
- [x] CI gate that runs a small benchmark suite on fixtures

**Exit criteria**
- [x] Search parity gates are green for fixtures.
- [x] Benchmark suite can generate and run 10–100+ flag-rich queries and produce a report deterministically.

---

# Phase 6 — Throughput Engineering: Sharding, Worker Pools, Parallelism, WASM Parsing Acceleration

**Objective:** After correctness gates are met, maximize build throughput and stability by making sharding metric-driven, tuning concurrency, improving pre-pass leverage, and accelerating language parsing (especially tree-sitter WASM).

## 6.1 Metric-driven sharding (time-equalized shards)

### Dependency guidance (best choices)
- Shard planner algorithm (default): **LPT greedy bin packing** (Longest-Processing-Time first; implement in-house, no new dependency).
- `xxhash-wasm` — stable file identity + content hash used to reuse prior throughput measurements safely across runs.
- `hdr-histogram-js` — maintain per-language/per-extension throughput distributions to inform shard planning.

### 6.1.1 Collect throughput metrics
- [x] During builds, record per-language performance:
  - [x] files/sec, lines/sec, bytes/sec
  - [x] parse time (chunking + relations)
  - [x] tokenization time
  - [x] stage2/3/x enrichment time
- [x] Persist a “perf profile” artifact:
  - [x] per language + file-size bucket cost model
  - [x] versioned and tied to config hash

### 6.1.2 Shard planning with a cost model
- [x] Replace line-count-only shard sizing with estimated time cost:
  - [x] cost(file) = overhead(lang) + bytes * byteCost(lang) + lines * lineCost(lang)
  - [x] modifiers for enabled features (relations/flow/tree-sitter/tooling)
- [x] Implement bin-packing / greedy balancing to minimize shard makespan
- [x] Support constraints:
  - [x] preserve directory locality (optional; default: off; for cache locality)
  - [x] cap max shard size by bytes/lines (defaults): **maxShardBytes = 64 MiB**, **maxShardLines = 200,000**
- [x] At runtime:
  - [x] adaptively rebalance when early shards show different throughput than predicted

## 6.2 Worker pool correctness + Windows reliability hard gate

### Dependency guidance (best choices)
- `piscina` — standardize on Piscina for worker pools (robust scheduling, backpressure, worker lifecycle controls).
  - Prefer transferable objects (ArrayBuffer) or SharedArrayBuffer for large payloads; avoid structured-clone of huge JSON.
  - Validate Windows paths/URLs for worker entrypoints (`file://` URLs where needed).
- `pino` — log worker lifecycle events and crashes with shard context; ensure uncaught exceptions are attributed to a shard + stage.

- [x] Explicitly cap default worker counts (concrete defaults):
  - [x] `fileConcurrency = min(cpuCount, 16)` (Windows: `min(cpuCount, 8)`)
  - [x] `cpuConcurrency = fileConcurrency` (avoid CPU oversubscription by default)
  - [x] `ioConcurrency = min(64, fileConcurrency * 4)` (Windows: `min(32, fileConcurrency * 4)`)
  - [x] `workerPool.maxWorkers = min(8, fileConcurrency)` (default), and hard-cap at **16** unless explicitly overridden
  - [x] `indexing.pythonAst.maxWorkers = min(4, fileConcurrency)` (default), and hard-cap at **8** unless explicitly overridden
- [x] Add Windows-specific CI and stress tests:
  - [x] worker pool creation, restart, and shutdown
  - [x] long runs with many small tasks
  - [x] path length + spaces + unicode paths
- [x] Improve worker crash reporting:
  - [x] capture error class, message, stack, serialized “cause” chain
  - [x] include task context (file, ext, size, mode) on failure
- [x] Consider splitting pools by task type:
  - [x] tokenization pool
  - [x] parsing pool (tree-sitter/Babel/TS)
  - [x] quantization pool
  - [x] avoid contention and reduce restart blast radius

## 6.3 Parallelism and pipeline refactors (architectural changes allowed)

### Dependency guidance (best choices)
- `piscina` — use a single pool per stage (or per workload class) with explicit concurrency limits; avoid nested pools.
- `fdir` — parallelize file discovery and stat collection; feed measured work weights into shard planning.
- `lru-cache` — cache parse artifacts (AST, token streams, segment maps) within shard lifetime; enforce strict memory budgets.
- `fflate` — stream intermediate shard writes so workers can flush incrementally rather than buffering.

- [x] Reduce redundant IO passes:
  - [x] integrate import extraction into file processing when feasible
  - [x] defer import-link enrichment to a post-pass instead of separate full scan
- [x] Stream postings construction:
  - [x] avoid holding all chunk texts/tokens in memory at once
  - [x] incremental flush of postings shards
- [x] Pipeline embeddings with backpressure:
  - [x] overlap embedding computation with lexical index build where possible
  - [x] control memory via bounded queues (defaults):
    - [x] cap pending file-processing tasks at `min(10_000, fileConcurrency * 100)`
    - [x] cap pending embedding batches at `min(64, embeddingConcurrency * 8)`
    - [x] when caps are hit, producers block (no unbounded Promise arrays)

## 6.4 WASM parsing acceleration (tree-sitter)

### Dependency guidance (best choices)
- `@swc/core` — where tree-sitter WASM is insufficiently fast for JS/TS metadata, use SWC parse as an accelerator (native, optional).
- `@ast-grep/napi` — can offload certain structural matches to tree-sitter engines efficiently; apply before bespoke analyzers.
- `xxhash-wasm` — cache AST/parse results keyed by stable content hash to avoid repeat work across stages.

Within the limits of web-tree-sitter + tree-sitter-wasms:

- [x] Optimize traversal:
  - [x] avoid `node.namedChildren` allocations; use `namedChildCount`/`namedChild(i)` or TreeCursor
  - [x] avoid `text.split('
')` for doc extraction when possible (use line index + windowed scanning)
- [x] Preload grammars efficiently:
  - [x] keep per-process cache as today, but add an option to preload in parallel after correctness verification
- [x] Offload heavy parsing to workers (optional; default: off):
  - [x] per-worker wasm init + grammar cache
  - [x] measure if this improves throughput vs overhead
- [x] Add/enable additional WASM grammars where available:
  - [x] JavaScript / TypeScript / TSX / JSX
  - [x] Python (chunking fallback to avoid spawning python for stage1)
  - [x] JSON / YAML / TOML / Markdown (as available) for segment parsing
- [x] Add per-language performance guardrails:
  - [x] maxBytes/maxLines gating (defaults):
    - [x] tree-sitter: skip if file > **512 KiB** or > **10,000 lines**
    - [x] YAML top-level chunking: skip if file > **200 KiB**
    - [x] Kotlin flow: skip if file > **200 KiB** or > **3,000 lines**
    - [x] Kotlin relations: skip if file > **200 KiB** or > **2,000 lines**
    - [x] per-file parse timeout: if parsing exceeds **1000 ms**, fall back to heuristic chunking for that file
  - [x] automatic fallback to heuristic parsing on slow files

**Deliverables**
- [x] perf profile artifact + cost-model sharder
- [x] Windows worker pool reliability gate
- [x] reduced redundant passes and pipelined indexing where beneficial
- [x] tree-sitter traversal optimizations + additional wasm grammars
- [x] benchmark comparisons showing throughput improvements

**Exit criteria**
- [x] Shards finish in near-equal wall time on benchmark repos (reduced straggler effect).
- [x] Worker pool does not fail on Windows across stress runs.
- [x] Measured throughput improves without violating correctness gates.

---

# Phase 7 — Observability, Failure Capture, and Operational Durability

**Objective:** Ensure failures are diagnosable, logs are complete, and long-running operation is durable (watch mode, service mode).

## 7.1 Structured logging and run diagnostics

### Dependency guidance (best choices)
- `pino` — structured logs with runId/shardId/stageId; use redaction for secrets; avoid logging full file contents by default.
- `pino-pretty` — developer-only pretty transport; ensure production logs remain JSON.
- `prom-client` — export counters/histograms for build throughput, parse failures, risk rule matches, and query latency.
- `hdr-histogram-js` — maintain in-process histograms for high-cardinality timing stats (then export summaries).

- [x] Add structured JSON logs option:
  - [x] log levels
  - [x] timestamps
  - [x] buildId correlation
  - [x] shardId / workerId correlation
- [x] Capture environment snapshot at start of build:
  - [x] node version, OS, CPU count, memory
  - [x] enabled features and effective config hash
- [x] Ensure logs flush on crash:
  - [x] avoid fire-and-forget writes for crash logs
  - [x] add “last N events” ring buffer persisted on fatal errors (default: **N=200** events, capped to **2 MiB** serialized)

## 7.2 Failure taxonomy and actionable capture

### Dependency guidance (best choices)
- `pino` — emit structured error events with classification fields: `{ category, languageId, stage, shardId, file, offset?, tool, retryable }`.
- `ajv` — validate that error objects conform to a schema (so failures are machine-actionable, not ad-hoc strings).

- [x] Define a failure taxonomy:
  - [x] parse failures
  - [x] tool dependency failures
  - [x] worker pool failures
  - [x] artifact IO failures (JSON too large, corruption)
  - [x] sqlite build failures
- [x] For each failure class:
  - [x] record minimal reproduction hints
  - [x] suggest config mitigations (e.g., file caps, disable feature X)

## 7.3 Watch/service durability

### Dependency guidance (best choices)
- `chokidar` — cross-platform file watching; on Windows/network drives prefer `awaitWriteFinish` and consider polling fallback.
- `piscina` — for watch mode, keep pools warm but rate-limit rebuilds; cancel in-flight shard work on superseding changes.

- [x] Ensure watch mode debounces and avoids rebuild storms
- [x] Ensure service queue and stage2 jobs:
  - [x] have durable state machine (Phase 2)
  - [x] can be resumed after crash/restart
  - [x] produce per-job logs and reports

**Deliverables**
- [x] structured logging + diagnostic bundle output
- [x] failure taxonomy + captured evidence improvements
- [x] hardened watch/service operation

**Exit criteria**
- [x] Any build failure produces a diagnostic bundle sufficient to triage without rerunning.
- [x] Long-running modes remain stable over multi-hour runs.

---

# Phase 8 — Language Coverage Expansion and Long-Term Architecture Simplification

**Objective:** Expand supported languages and mixed-file containers while reducing maintenance cost and ensuring performance guardrails.

## 8.1 New language onboarding playbook (repeatable)

### Dependency guidance (best choices)
- `linguist-languages` — bootstrap languageId mapping and aliases; treat it as a baseline and allow project overrides.
- Parser deps (only when the language is in the support matrix):
  - `graphql`, `protobufjs`, `fast-xml-parser`, `dockerfile-ast`, `@handlebars/parser`, `nunjucks`, etc.
- For higher-level metadata/risk:
  - `@ast-grep/napi`, `graphology`, `re2js`, `aho-corasick` as reusable primitives across languages.

For each new language or container format:

- [x] Decide parsing strategy:
  - [x] tree-sitter wasm grammar (preferred)
  - [x] heuristic parser
  - [x] tooling/LSP enrichment only (optional)
- [x] Implement:
  - [x] chunk extraction
  - [x] minimal relations (imports + calls) where feasible
  - [x] comment extraction rules
  - [x] metadata v2 mapping
- [x] Add fixtures:
  - [x] “language fidelity” tests
  - [x] perf guard tests (max bytes/lines)
- [x] Add to benchmark matrix.

## 8.2 Recommended language priorities

### Dependency guidance (best choices)
- Prioritize languages whose parsers expose **ranges/locations** and can run deterministically in your target environments (Node + optional native/WASM).
- Reuse existing primitives (`micromark`, `parse5`, `@ast-grep/napi`, `graphology`, `ajv`) rather than adding bespoke parsers where possible.

**High priority (common + high ROI)**
- [x] JavaScript/TypeScript (tree-sitter wasm for chunking/metadata)
- [x] TSX/JSX segmentation improvements
- [x] Python (tree-sitter wasm chunking as stage1 fallback)
- [x] Dockerfile
- [x] Makefile
- [x] Protobuf
- [x] GraphQL

**Next tier (ecosystem breadth)**
- [x] CMake
- [x] Bazel/Starlark
- [x] Nix
- [x] Dart
- [x] Scala / Groovy
- [x] R / Julia

**Web template tier**
- [x] Handlebars/Mustache
- [x] Jinja2 / Django templates
- [x] Razor

## 8.3 Architecture simplification after stabilization

### Dependency guidance (best choices)
- Consolidate on fewer parsing/AST stacks per ecosystem:
  - JS/TS: SWC for speed + TypeScript for type-aware enrichment, with AST bridges where needed.
  - Structural matching: `@ast-grep/napi` rule packs to reduce custom per-language logic.
- Keep serialization + storage minimal: `msgpackr` + `fflate` + one durable backend (`better-sqlite3` or `lmdb`) behind a stable contract.

- [x] Consolidate parsing APIs:
  - [x] one segment discovery API
  - [x] one chunking API
  - [x] one metadata v2 builder interface
- [x] Reduce duplicate passes and duplicated formats
- [x] Remove deprecated schema paths once migrations are complete

**Deliverables**
- [x] language onboarding playbook
- [x] expanded language and mixed-file coverage
- [x] simplified architecture and reduced defect surface

**Exit criteria**
- [x] New languages can be added with predictable steps, tests, and guardrails.
- [x] Maintenance burden decreases while coverage increases.

---

# Phase 10 — Dependency Bundle Parser/AST Checklists

**Objective:** Complete extraction checklists for parser/AST dependency sheets and link them to implementation and tests.

## 10.1 Parser/AST extraction checklist completion
- [x] For each dependency sheet below, fill in the extraction checklist (stable ranges, minimal traversal, metadata vs. indexes, performance pitfalls) and check it off:
  - `docs/references/dependency-bundle/deps/ast-grep-napi.md`
  - `docs/references/dependency-bundle/deps/astrojs-compiler.md`
  - `docs/references/dependency-bundle/deps/babel-traverse.md`
  - `docs/references/dependency-bundle/deps/dockerfile-ast.md`
  - `docs/references/dependency-bundle/deps/es-joy-jsdoccomment.md`
  - `docs/references/dependency-bundle/deps/esquery.md`
  - `docs/references/dependency-bundle/deps/fast-xml-parser.md`
  - `docs/references/dependency-bundle/deps/graphql.md`
  - `docs/references/dependency-bundle/deps/handlebars-parser.md`
  - `docs/references/dependency-bundle/deps/jsdoc-type-pratt-parser.md`
  - `docs/references/dependency-bundle/deps/jsonc-parser.md`
  - `docs/references/dependency-bundle/deps/mdx-js-mdx.md`
  - `docs/references/dependency-bundle/deps/micromark.md`
  - `docs/references/dependency-bundle/deps/nunjucks.md`
  - `docs/references/dependency-bundle/deps/parse5.md`
  - `docs/references/dependency-bundle/deps/picomatch.md`
  - `docs/references/dependency-bundle/deps/protobufjs.md`
  - `docs/references/dependency-bundle/deps/semver.md`
  - `docs/references/dependency-bundle/deps/smol-toml.md`
  - `docs/references/dependency-bundle/deps/svelte.md`
  - `docs/references/dependency-bundle/deps/swc-core.md`
  - `docs/references/dependency-bundle/deps/typescript.md`
  - `docs/references/dependency-bundle/deps/typescript-eslint-typescript-estree.md`
  - `docs/references/dependency-bundle/deps/vue-compiler-sfc.md`
  - `docs/references/dependency-bundle/deps/vscode-ripgrep.md`
  - `docs/references/dependency-bundle/deps/yaml.md`

**Deliverables**
- Parser/AST dependency sheets updated with extraction notes and links to code/tests.

**Exit criteria**
- Every listed sheet has all extraction checklist items checked with concrete references.

---

# Phase 11 — Dependency Bundle API/Knobs/Test Checklists

**Objective:** Complete integration checklists for core helper libraries (API entrypoints, config knobs, fixtures/benchmarks).

## 11.1 Integration checklist completion
- [x] For each dependency sheet below, document API entrypoints, config knobs, and add references to fixtures/benchmarks; then check the boxes.
  - `docs/references/dependency-bundle/deps/aho-corasick.md`
  - `docs/references/dependency-bundle/deps/ajv.md`
  - `docs/references/dependency-bundle/deps/chardet.md`
  - `docs/references/dependency-bundle/deps/execa.md`
  - `docs/references/dependency-bundle/deps/fdir.md`
  - `docs/references/dependency-bundle/deps/fflate.md`
  - `docs/references/dependency-bundle/deps/file-type.md`
  - `docs/references/dependency-bundle/deps/graphology.md`
  - `docs/references/dependency-bundle/deps/greedy-number-partitioning.md`
  - `docs/references/dependency-bundle/deps/hdr-histogram-js.md`
  - `docs/references/dependency-bundle/deps/hnswlib-node.md`
  - `docs/references/dependency-bundle/deps/iconv-lite.md`
  - `docs/references/dependency-bundle/deps/ignore.md`
  - `docs/references/dependency-bundle/deps/istextorbinary.md`
  - `docs/references/dependency-bundle/deps/linguist-languages.md`
  - `docs/references/dependency-bundle/deps/lru-cache.md`
  - `docs/references/dependency-bundle/deps/onnxruntime-node.md`
  - `docs/references/dependency-bundle/deps/pino-pretty.md`
  - `docs/references/dependency-bundle/deps/pyright.md`
  - `docs/references/dependency-bundle/deps/re2js.md`
  - `docs/references/dependency-bundle/deps/seedrandom.md`

**Deliverables**
- Integration sheets updated with API usage notes, config knobs, and test/bench references.

**Exit criteria**
- All listed sheets have the integration checklist items checked.

---

# Phase 12 — Dependency Bundle Storage/Determinism Checklists

**Objective:** Document artifact format, determinism, and durability expectations for storage/serialization dependencies.

## 12.1 Artifact/determinism checklist completion
- [x] For each dependency sheet below, complete the artifact/determinism checklist and check the boxes:
  - `docs/references/dependency-bundle/deps/better-sqlite3.md`
  - `docs/references/dependency-bundle/deps/lmdb.md`
  - `docs/references/dependency-bundle/deps/msgpackr.md`
  - `docs/references/dependency-bundle/deps/roaring-wasm.md`
  - `docs/references/dependency-bundle/deps/xxhash-wasm.md`

**Deliverables**
- Storage/serialization sheets updated with format/determinism/throughput notes.

**Exit criteria**
- All listed sheets have artifact/determinism checklist items checked.

---

# Phase 13 — Dependency Bundle Metrics/Concurrency Checklists

**Objective:** Finalize metrics/logging and concurrency checklist items for observability and rebuild safety.

## 13.1 Metrics and logging checklist completion
- [x] For each dependency sheet below, complete the metrics/logging checklist and check the boxes:
  - `docs/references/dependency-bundle/deps/pino.md`
  - `docs/references/dependency-bundle/deps/prom-client.md`
  - `docs/references/dependency-bundle/deps/tinybench.md`

## 13.2 Concurrency and rebuild safety checklist completion
- [x] For each dependency sheet below, complete the concurrency checklist and check the boxes:
  - `docs/references/dependency-bundle/deps/chokidar.md`
  - `docs/references/dependency-bundle/deps/piscina.md`

**Deliverables**
- Metrics/logging and concurrency sheets updated with concrete policies and test references.

**Exit criteria**
- All listed sheets have their checklist items checked.

---

# Phase 14 — Integration Checklist Items (Detailed)

**Objective:** Complete the integration checklists captured in `TEMP_DEPENDENCY_CHECKLISTS.md` for Phase 11 dependencies.

## 14.1 API entrypoints and persisted data structures
- [x] Identify the exact API entrypoints you will call and the data structures you will persist for:
  - `docs/references/dependency-bundle/deps/aho-corasick.md`
  - `docs/references/dependency-bundle/deps/chardet.md`
  - `docs/references/dependency-bundle/deps/fflate.md`
  - `docs/references/dependency-bundle/deps/file-type.md`
  - `docs/references/dependency-bundle/deps/graphology.md`
  - `docs/references/dependency-bundle/deps/greedy-number-partitioning.md`
  - `docs/references/dependency-bundle/deps/hdr-histogram-js.md`
  - `docs/references/dependency-bundle/deps/hnswlib-node.md`
  - `docs/references/dependency-bundle/deps/iconv-lite.md`
  - `docs/references/dependency-bundle/deps/istextorbinary.md`
  - `docs/references/dependency-bundle/deps/linguist-languages.md`
  - `docs/references/dependency-bundle/deps/onnxruntime-node.md`
  - `docs/references/dependency-bundle/deps/pyright.md`
  - `docs/references/dependency-bundle/deps/re2js.md`

## 14.2 Configuration knobs that impact output/performance
- [x] Record configuration knobs that meaningfully change output/performance for:
  - `docs/references/dependency-bundle/deps/aho-corasick.md`
  - `docs/references/dependency-bundle/deps/chardet.md`
  - `docs/references/dependency-bundle/deps/fflate.md`
  - `docs/references/dependency-bundle/deps/file-type.md`
  - `docs/references/dependency-bundle/deps/graphology.md`
  - `docs/references/dependency-bundle/deps/greedy-number-partitioning.md`
  - `docs/references/dependency-bundle/deps/hdr-histogram-js.md`
  - `docs/references/dependency-bundle/deps/hnswlib-node.md`
  - `docs/references/dependency-bundle/deps/iconv-lite.md`
  - `docs/references/dependency-bundle/deps/istextorbinary.md`
  - `docs/references/dependency-bundle/deps/linguist-languages.md`
  - `docs/references/dependency-bundle/deps/onnxruntime-node.md`
  - `docs/references/dependency-bundle/deps/pyright.md`
  - `docs/references/dependency-bundle/deps/re2js.md`

## 14.3 Fixtures and regression benchmarks
- [x] Add at least one representative test fixture and a regression benchmark for:
  - `docs/references/dependency-bundle/deps/aho-corasick.md`
  - `docs/references/dependency-bundle/deps/chardet.md`
  - `docs/references/dependency-bundle/deps/fflate.md`
  - `docs/references/dependency-bundle/deps/file-type.md`
  - `docs/references/dependency-bundle/deps/graphology.md`
  - `docs/references/dependency-bundle/deps/greedy-number-partitioning.md`
  - `docs/references/dependency-bundle/deps/hdr-histogram-js.md`
  - `docs/references/dependency-bundle/deps/hnswlib-node.md`
  - `docs/references/dependency-bundle/deps/iconv-lite.md`
  - `docs/references/dependency-bundle/deps/istextorbinary.md`
  - `docs/references/dependency-bundle/deps/linguist-languages.md`
  - `docs/references/dependency-bundle/deps/onnxruntime-node.md`
  - `docs/references/dependency-bundle/deps/pyright.md`
  - `docs/references/dependency-bundle/deps/re2js.md`

**Deliverables**
- Phase 11 dependency sheets updated with API entrypoints, config knobs, and fixture/benchmark references.

**Exit criteria**
- All Phase 11 unchecked checklist items in `TEMP_DEPENDENCY_CHECKLISTS.md` are resolved.

---

# Phase 15 — Storage/Determinism Checklist Items (Detailed)

**Objective:** Complete the storage/determinism checklists captured in `TEMP_DEPENDENCY_CHECKLISTS.md` for Phase 12 dependencies.

## 15.1 Artifact format/versioning documentation
- [x] Define artifact formats and version them (schema/version header + migration plan) for:
  - `docs/references/dependency-bundle/deps/better-sqlite3.md`
  - `docs/references/dependency-bundle/deps/lmdb.md`
  - `docs/references/dependency-bundle/deps/msgpackr.md`
  - `docs/references/dependency-bundle/deps/roaring-wasm.md`
  - `docs/references/dependency-bundle/deps/xxhash-wasm.md`

## 15.2 Deterministic output requirements
- [x] Ensure determinism: stable ordering, stable encodings, stable hashing inputs for:
  - `docs/references/dependency-bundle/deps/better-sqlite3.md`
  - `docs/references/dependency-bundle/deps/lmdb.md`
  - `docs/references/dependency-bundle/deps/msgpackr.md`
  - `docs/references/dependency-bundle/deps/roaring-wasm.md`
  - `docs/references/dependency-bundle/deps/xxhash-wasm.md`

## 15.3 Throughput/size measurements
- [x] Measure: write/read throughput and artifact size; record p95/p99 for bulk load for:
  - `docs/references/dependency-bundle/deps/better-sqlite3.md`
  - `docs/references/dependency-bundle/deps/lmdb.md`
  - `docs/references/dependency-bundle/deps/msgpackr.md`
  - `docs/references/dependency-bundle/deps/roaring-wasm.md`
  - `docs/references/dependency-bundle/deps/xxhash-wasm.md`

## 15.4 Corruption detection and partial rebuild safety
- [x] Plan for corruption detection (hashes) and safe partial rebuilds for:
  - `docs/references/dependency-bundle/deps/better-sqlite3.md`
  - `docs/references/dependency-bundle/deps/lmdb.md`
  - `docs/references/dependency-bundle/deps/msgpackr.md`
  - `docs/references/dependency-bundle/deps/roaring-wasm.md`
  - `docs/references/dependency-bundle/deps/xxhash-wasm.md`

**Deliverables**
- Phase 12 dependency sheets updated with artifact/determinism notes and measurement guidance.

**Exit criteria**
- All Phase 12 unchecked checklist items in `TEMP_DEPENDENCY_CHECKLISTS.md` are resolved.

---

# Phase 16 — Metrics/Concurrency Checklist Items (Detailed)

**Objective:** Complete the metrics/logging and concurrency checklists captured in `TEMP_DEPENDENCY_CHECKLISTS.md` for Phase 13 dependencies.

## 16.1 Metrics vocabulary and logging hygiene
- [x] Define a minimal metrics vocabulary (names, labels) and keep label cardinality bounded for:
  - `docs/references/dependency-bundle/deps/pino.md`
  - `docs/references/dependency-bundle/deps/prom-client.md`
  - `docs/references/dependency-bundle/deps/tinybench.md`
- [x] Capture latency distributions, not just averages (p50/p95/p99) for:
  - `docs/references/dependency-bundle/deps/pino.md`
  - `docs/references/dependency-bundle/deps/prom-client.md`
  - `docs/references/dependency-bundle/deps/tinybench.md`
- [x] Make logs structured and redact secrets; add run/repo correlation fields for:
  - `docs/references/dependency-bundle/deps/pino.md`
  - `docs/references/dependency-bundle/deps/prom-client.md`
  - `docs/references/dependency-bundle/deps/tinybench.md`
- [x] Keep benchmarking reproducible (fixed inputs, warmups, pinned configs) for:
  - `docs/references/dependency-bundle/deps/pino.md`
  - `docs/references/dependency-bundle/deps/prom-client.md`
  - `docs/references/dependency-bundle/deps/tinybench.md`

## 16.2 Concurrency and rebuild safety
- [x] Define units of work and weights (bytes or historical parse time) for load balancing for:
  - `docs/references/dependency-bundle/deps/chokidar.md`
  - `docs/references/dependency-bundle/deps/piscina.md`
- [x] Set resource limits and failure policy (skip, retry, quarantine) for:
  - `docs/references/dependency-bundle/deps/chokidar.md`
  - `docs/references/dependency-bundle/deps/piscina.md`
- [x] Instrument per-worker timings and queue depth for:
  - `docs/references/dependency-bundle/deps/chokidar.md`
  - `docs/references/dependency-bundle/deps/piscina.md`
- [x] Ensure incremental rebuild logic is correct under bursts of file events for:
  - `docs/references/dependency-bundle/deps/chokidar.md`
  - `docs/references/dependency-bundle/deps/piscina.md`

**Deliverables**
- Phase 13 dependency sheets updated with concrete metrics/logging and concurrency notes.

**Exit criteria**
- All Phase 13 unchecked checklist items in `TEMP_DEPENDENCY_CHECKLISTS.md` are resolved.

---

# Phase 17 — File Identification, Encoding, and Language Mapping

**Objective:** Implement the file-type, binary detection, and encoding fallback pipeline so discovery and parsing handle non-UTF8 and binary inputs correctly.

## 17.1 File type and binary detection
- [x] Integrate `file-type` magic-byte detection before parsing; fall back to `istextorbinary` heuristics.
- [x] Add binary fixtures (`tests/fixtures/binary`) and wire them into discovery tests.

## 17.2 Encoding fallback
- [x] When UTF-8 decode fails, run `chardet` and decode via `iconv-lite` while preserving byte offsets.
- [x] Add encoding fixtures (`tests/fixtures/encoding`) and coverage in `tools/bench-language-repos.js`.

## 17.3 Language mapping
- [x] Load `linguist-languages` mappings with override precedence; validate in `tests/language-fidelity.js`.

**Deliverables**
- File discovery pipeline with binary + encoding fallback handling.
- Fixtures + tests for binary and non-UTF8 content.

**Exit criteria**
- Mixed binary/encoding fixtures pass and language fidelity stays green.

---

# Phase 18 — Pattern Matching Engines (Aho-Corasick, Re2js)

**Objective:** Implement safe, fast pattern matching for dictionary segmentation and risk/search filters.

## 18.1 Multi-pattern dictionary scans
- [x] Integrate `aho-corasick` for multi-pattern matching and persist term lists/automata for reuse.
- [x] Add fixtures under `tests/fixtures/dict-scan` and extend `tools/bench-dict-seg.js`.

## 18.2 Safe regex execution
- [x] Use `re2js` for risk rules and search filters; expose config knobs (timeout/flags/max size).
- [x] Add regression coverage in `tests/language-fidelity.js` and `tests/bench.js`.

**Deliverables**
- Multi-pattern matching pipeline + fixtures/benchmarks.
- Safe regex engine path for risk/search filters.

**Exit criteria**
- Dictionary segmentation and regex fixtures pass with bounded execution time.

---

# Phase 19 — Graph and Shard Balancing (Graphology, Greedy Partitioning)

**Objective:** Implement graph-backed relations and weight-based shard balancing.

## 19.1 Graph-backed relations
- [x] Use `graphology` to capture call/flow graphs and persist adjacency lists.
- [x] Add fixtures under `tests/fixtures/graphs` and extend `tests/type-inference-crossfile.js`.

## 19.2 Shard balancing
- [x] Use `greedy-number-partitioning` to balance shard weights and queue batches.
- [x] Add coverage in `tools/shard-census.js` and `tests/thread-limits.js`.

**Deliverables**
- Graph relation storage with fixtures.
- Weighted shard balancing with regression tests.

**Exit criteria**
- Cross-file graph tests pass and shard balance metrics stabilize.

---

# Phase 20 — Embeddings and ANN (ONNX Runtime, HNSW)

**Objective:** Add real embedding inference and ANN indexing.

## 20.1 ONNX embeddings
- [x] Integrate `onnxruntime-node` inference path with config knobs (executionProviders, thread counts).
- [x] Add fixture coverage in `tests/bench.js` and repo-scale runs in `tools/bench-language-repos.js`.

## 20.2 HNSW ANN index
- [x] Integrate `hnswlib-node` for vector ANN search with persistence and rebuild hooks.
- [x] Add coverage in `tests/sqlite-ann-extension.js` or a dedicated ANN test.

**Deliverables**
- ONNX embedding pipeline with configurable execution providers.
- HNSW ANN indexing + tests/benchmarks.

**Exit criteria**
- Embedding + ANN runs complete on bench repos with reproducible metrics.

---

# Phase 22 — Metrics, Benchmarking, and Logging (Prom-client, HDR Histogram, Tinybench, Pino)

**Objective:** Provide consistent metrics, latency distributions, and reproducible benchmarking.

## 22.1 Metrics + distributions
- [x] Wire `prom-client` metrics with a minimal vocabulary and bounded labels.
- [x] Capture p50/p95/p99 latencies using `hdr-histogram-js` or Prometheus histograms.

## 22.2 Bench tooling and logging hygiene
- [x] Add `tinybench`-based microbench harness and store reproducible baselines.
- [x] Configure `pino` redaction and propagate run/repo correlation fields consistently.

**Deliverables**
- Metrics endpoint + latency distributions.
- Microbench suite with reproducible outputs.

**Exit criteria**
- Metrics and benchmark outputs are stable across repeated runs.

---

# Phase 23 — Worker and Watch Observability (Piscina, Chokidar)

**Objective:** Instrument worker pools and file watch flows with clear, actionable telemetry.

## 23.1 Worker pool telemetry
- [x] Emit per-worker timings, queue depth, and retry counts for `piscina` pools.

## 23.2 Watch telemetry
- [x] Surface watch backlog, debounce stats, and burst handling metrics in `src/index/build/watch.js`.

**Deliverables**
- Worker and watch telemetry surfaced in logs/metrics.

**Exit criteria**
- Worker/watch telemetry consistently reports queue depth and durations under load.

---

# Phase 24 — Python Type Tooling (Pyright)

**Objective:** Implement Python type inference using Pyright.

## 24.1 Pyright integration
- [x] Integrate `pyright` analysis for Python files and capture diagnostics/types.
- [x] Add fixtures and cross-file inference tests for Python.

**Deliverables**
- Pyright-backed Python type metadata with fixtures and tests.

**Exit criteria**
- Python type inference fixtures pass with stable outputs.


## Phase 6: Throughput engineering and incremental correctness

### 6.1 Metric-driven sharding and performance profiles

**Audit**

- Sharding planner exists with a cost model:
  - `src/index/build/shards.js`
  - `src/index/build/perf-profile.js`
- Index builds write metrics and perf profiles:
  - `src/index/build/artifacts.js` (writes to `repometrics/`)

**Remaining work**

- [x] Implemented.

### 6.2 Worker pool tuning and OS gates

**Audit**

- Worker pool exists and can be gated/disabled:
  - `src/index/build/worker-pool.js`
  - `src/index/build/runtime.js` contains platform gating and pool sizing logic

**Remaining work**

- [x] Implemented.

### 6.3 Incremental indexing: correctness and reuse

**Audit**

- Incremental manifest, bundle caching, pruning exist:
  - `src/index/build/incremental.js`
- Tests cover reuse and manifest behaviors:
  - `tests/incremental-reuse.js`
  - `tests/incremental-manifest.js`
  - `tests/incremental-tokenization-cache.js`

**Resolved correctness defect**

- **File deletions are now considered in the “reuse whole index” check** (manifest key set must match current entries).

**Remaining work**

- [x] Fix `shouldReuseIncrementalIndex(...)` to detect deletions (manifest key set check).
- [x] Add deletion coverage to `tests/incremental-reuse.js` (manifest extra entry rejects reuse).

---

## Phase A (P0): Correctness and “don’t lie” invariants

- [x] Fix incremental reuse deletion bug (`src/index/build/incremental.js`).
- [x] Add deletion coverage for incremental reuse (`tests/incremental-reuse.js`).
- [x] Remove all `process.exit(...)` paths from reusable library modules (notably sqlite backend creation in `src/retrieval/cli-sqlite.js`); convert to errors honoring `exitOnError` and “forced backend” semantics.
- [x] Make stage3 embeddings update `index_state.json` atomically and run `index-validate` after writing embeddings artifacts.

## Phase C (P2): Mode surface cleanup (extracted-prose)

- [x] Decide: keep extracted-prose.
- [x] If keep: expose it in `bin/pairofcleats.js` mode choices (build and search), document it in the truth table, and add tests.

---

## Phase 4: High-signal metadata and rich filters

### 4.1 Metadata v2 wiring

**Audit**

- Meta v2 exists and is written with chunks:
  - `src/index/metadata-v2.js`
  - `src/index/build/file-processor.js`

**Remaining work**

- [x] Implemented.

### 4.2 Risk analysis

**Audit**

- Risk analyzer exists: `src/index/risk.js`.
- Risk metadata is incorporated into doc/chunk metadata and is filterable in retrieval (see retrieval output/filter logic).

**Remaining work**

- [x] Implemented; heuristic quality improvements can be iterative.

### 4.3 Type inference

**Audit**

- Type inference exists: `src/index/type-inference.js`.
- Integrated into metadata generation.

**Remaining work**

- [x] Implemented; heuristic quality improvements can be iterative.

### 4.4 Filters (lang/ext/kind/risk/type/imports/structural)

**Audit**

- The retrieval CLI supports a large filter surface; the implementation uses:   
  - `src/retrieval/filters.js` (core filter parsing/matching)
  - `src/retrieval/output.js` (post-filtering and output gating)
  - `src/retrieval/structural-*.js` (structural filtering/search)

**Gaps / issues**

- Some advanced filters are “post-filter” style (scan chunk meta) rather than being backed by an accelerated index structure. This is functionally correct but may be slower on very large corpora.
- The roadmap mentions `roaring-wasm` for bitmap acceleration; it is now used for filter intersections.

**Remaining work**

- [x] implement bitmap-accelerated filter evaluation (roaring-wasm-backed bitmaps for filter intersections)

---

# Phase HS — High-severity issues found (must fix)

**Objective:** Close the top correctness and operational gaps identified in code review.

- [x] Incremental reuse detects deletions by verifying manifest keys match the current file set (`src/index/build/incremental.js`) and is covered by `tests/incremental-reuse.js`.
- [x] SQLite backend creation no longer calls `process.exit(1)`; forced mode throws, optional mode warns and falls back (`src/retrieval/cli-sqlite.js`).
- [x] Stage3 embeddings writes `index_state.json` atomically, validates after write, and readers gate embeddings readiness via `index_state` (`tools/build-embeddings.js` + readers).
- [x] Observability/acceleration dependencies are implemented: `xxhash-wasm` for checksums, `roaring-wasm` for bitmap acceleration, and `prom-client` + `hdr-histogram-js` wired into metrics/bench tooling.
- [x] Extracted-prose mode is first-class: CLI exposure and dedicated tests via `tests/extracted-prose.js`.

---

## Roadmap closeout (2026-01-10)

### 2.3 Atomic build directories + “current” pointer

**Audit**

- Build roots and promotion exist:
  - `src/index/build/promotion.js` (writes/reads `current.json`)
  - `src/integrations/core/index.js` builds to `builds/<buildId>` and promotes after validation

**Gaps / issues**

- None noted; stage3/stage4 enrichment runs in-place but is gated by `index_state` readiness.

**Remaining work**

- [x] Define and enforce a clear atomicity rule for stage3/stage4 (in-place gated by `index_state` readiness flags).
- [x] Add post-stage validation for stage3 outputs (run `tools/index-validate.js` or call `validateIndexArtifacts(...)`).

### 2.4 Durable build state machine (heartbeat/stale/retry)

**Audit**

- Build state tracking exists:
  - `src/index/build/build-state.js` (phase transitions, checkpointing, heartbeat)
- Service job queue includes stale requeue + bounded retries:
  - `tools/service/queue.js`
  - `tools/indexer-service.js`

**Gaps / issues**

- None noted; build-state writes are atomic and fire-and-forget updates catch errors.

**Remaining work**

- [x] Make build-state writes robust (await critical updates or catch fire-and-forget writes).
- [x] Extend durability semantics to stage3/stage4 consistently (stage3 build-embeddings, stage4 build-sqlite-index).

### 5.3 Benchmark query suite generation

**Audit**

- Deterministic bench query generator exists:
  - `tools/bench-query-generator.js` (uses `seedrandom`)
- Bench runner tests exist:
  - `tests/bench.js`

**Gaps / issues**

- None noted; bench tooling references now point at `tools/bench-query-generator.js` and `tests/bench.js`.

**Remaining work**

- [x] Update documentation/roadmap references to reflect the actual bench tooling entry points (`tools/bench-query-generator.js`, `tests/bench.js`, docs under `docs/bench/`).

### 7.1 Structured logging and crash diagnostics

**Audit**

- Structured logging via pino exists:
  - `src/shared/progress.js`
- Crash log capturing exists:
  - `src/index/build/crash-log.js`
- Failure taxonomy exists:
  - `src/index/build/failure-taxonomy.js`

**Gaps / issues**

- None noted; crash/build-state writes are guarded against unhandled rejections.

**Remaining work**

- [x] Make crash/build-state writes robust against unhandled rejections (catch or await).
- [x] Make stage3 index_state updates atomic and add post-stage validation (`tools/build-embeddings.js`).

### 8.1 Documentation alignment

**Audit**

- There is extensive documentation in `docs/`.
- Some doc references in `COMPLETED_PHASES.md` point to files/dirs that no longer exist (likely due to refactors).

**Remaining work**

- [x] Update docs to reflect current entry points and filenames (see “Doc/reference drift” appendix below).
- [x] Ensure the public CLI help (`bin/pairofcleats.js`) reflects supported modes (including extracted-prose if kept).

## Phase B (P1): Atomicity and staged enrichment clarity

- [x] Decide stage3/stage4 atomic strategy: in-place gated by index_state readiness.
- [x] If in-place: ensure readers never treat partial outputs as ready (strict gating).
- [x] Document decision: keep stage3/4 in-place (gated by index_state readiness); promote-style builds not planned.

## Phase D (P3): Docs + dependency alignment

- [x] Update doc references that no longer match repo layout.
- [x] Either remove unused deps or wire them in (metrics/histograms/xxhash/roaring).

---

## Phase 4 (NEW_ROADMAP) — Retrieval pipeline semantics

### 4.2 Determinism guarantees

**Audit**

- Tie-break ordering is enforced in:
  - `src/retrieval/rankers.js`
  - `src/retrieval/pipeline.js`
  - `src/retrieval/sqlite-helpers.js`
- Determinism coverage:
  - `tests/search-determinism.js` (stub embeddings; asserts identical hits + explain output)
  - `tests/sqlite-vec-candidate-set.js` (ANN ordering uses `ORDER BY distance, rowid`)

**Remaining work**

- [x] Implemented and test-backed.

### 4.3 Advanced type inference (local + cross-file + tooling)

**Audit**

- Local inference and normalization:
  - `src/index/type-inference.js`
- Cross-file inference and tooling enrichment:
  - `src/index/type-inference-crossfile.js`
  - `src/index/tooling/typescript-provider.js`
  - `src/index/tooling/pyright-provider.js`
  - `src/index/tooling/clangd-provider.js`
  - `src/index/tooling/sourcekit-provider.js`
- Tests:
  - `tests/type-inference-crossfile.js`
  - `tests/type-inference-crossfile-go.js`
  - `tests/type-inference-lsp-enrichment.js`

**Remaining work**

- [x] Implemented and test-backed.

---

## Phase 1 (NEW_ROADMAP) — Roadmap executable and falsifiable

### 1.3 Tool invocation correctness: install-root vs repo-root

**Audit**

- Root resolution utilities:
  - `tools/dict-utils.js` (`resolveRepoRoot`, `resolveToolRoot`)
  - `tools/path-utils.js`
- Tests:
  - `tests/tool-root.js`
  - `tests/repo-root.js`

**Remaining work**

- [x] Implemented and test-backed.

### 1.4 Determinism + reproducibility baseline

**Audit**

- Deterministic chunk IDs and metadata:
  - `src/index/metadata-v2.js`
- Artifact determinism and validation:
  - `src/index/build/artifacts.js`
  - `src/index/validate.js`
  - `src/shared/hash.js` (xxhash/sha1)
- Tests:
  - `tests/incremental-reuse.js`
  - `tests/incremental-manifest.js`
  - `tests/metadata-v2.js`

**Remaining work**

- [x] Implemented and test-backed.

---

## Phase 2 (NEW_ROADMAP) — Artifact contract and metadata schema

### 2.1 Artifact contract + index-validate tool

**Audit**

- Contract and schema:
  - `docs/artifact-contract.md`
  - `src/shared/artifact-schemas.js`
- Validation tooling:
  - `src/index/validate.js`
  - `tools/index-validate.js`
- Tests:
  - `tests/index-validate.js`
  - `tests/artifact-formats.js`
  - `tests/artifact-size-guardrails.js`

**Remaining work**

- [x] Implemented and in active use.

### 2.2 Metadata schema v2

**Audit**

- Schema and wiring:
  - `src/index/metadata-v2.js`
  - `src/index/build/file-processor.js`
  - `src/index/build/artifacts.js`
- Tests:
  - `tests/metadata-v2.js`
  - `tests/graph-chunk-id.js`
  - `tests/sqlite-chunk-id.js`

**Remaining work**

- [x] Implemented and integrated.

---

## Phase 3 (NEW_ROADMAP) — Segment-aware chunking, mixed-file support, and prose

### 3.1 Segmented document pipeline

**Audit**

- Segment discovery and chunking:
  - `src/index/segments.js` (`discoverSegments`, `chunkSegments`)
- Tests:
  - `tests/segment-pipeline.js`

**Remaining work**

- [x] Implemented and tested.

### 3.2 Mixed-file support (Markdown/Vue/Svelte/Astro, embedded blocks)

**Audit**

- Mixed-format segmentation:
  - `src/index/segments.js`
- Tests:
  - `tests/segment-pipeline.js`

**Remaining work**

- [x] Implemented and tested.

### 3.3 Comment extraction and config blocks inside comments

**Audit**

- Comment parsing and wiring:
  - `src/index/comments.js`
  - `src/index/build/file-processor.js`
- Tests:
  - `tests/segment-pipeline.js`

**Remaining work**

- [x] Implemented and tested.

### 3.4 Prose-index strategy (Option A vs Option B)

**Audit**

- Comment-as-field mode (Option B) and extracted-prose support:
  - `src/index/build/file-processor.js`
  - `src/index/segments.js`
- Tests:
  - `tests/extracted-prose.js`

**Remaining work**

- [x] Implemented and documented.

---

## Phase 5 (NEW_ROADMAP) — Retrieval correctness, parity, and benchmark harness

### 5.1 Search contract and explainability

**Audit**

- Search contract:
  - `docs/search-contract.md`
- Explain output:
  - `src/retrieval/output/explain.js`
- Tests:
  - `tests/search-explain.js`

**Remaining work**

- [x] Implemented and tested.

### 5.2 Parity harness (file-backed vs sqlite)

**Audit**

- Parity harness:
  - `tests/parity.js`
  - `tests/fixture-parity.js`
- Backend selection checks:
  - `tests/sqlite-auto-backend.js`
  - `tests/sqlite-missing-dep.js`

**Remaining work**

- [x] Implemented and tested.

---

## Phase 7 (NEW_ROADMAP) — Operational hardening, observability, and service surfaces

### 7.2 Metrics endpoint and telemetry (prom-client)

**Audit**

- Metrics registry and endpoint:
  - `src/shared/metrics.js`
  - `tools/api-server.js`
- Tests:
  - `tests/api-server.js`

**Remaining work**

- [x] Implemented and exposed.

### 7.3 Service-mode indexer and queue semantics

**Audit**

- Service queue:
  - `tools/indexer-service.js`
  - `tools/service/queue.js`
- Tests:
  - `tests/indexer-service.js`
  - `tests/two-stage-state.js`

**Remaining work**

- [x] Implemented and tested.

### 7.4 API server and MCP server

**Audit**

- Service entrypoints:
  - `tools/api-server.js`
  - `tools/mcp-server.js`
- Tests:
  - `tests/api-server.js`
  - `tests/mcp-smoke.js`

**Remaining work**

- [x] Implemented and tested.



---

# NEW_ROADMAP Completed Phases

# Phase 0 — Roadmap hygiene, baseline gates, and “tests must be truthful”

**Objective:** establish a reliable baseline so subsequent changes are validated quickly and deterministically.

## 0.1 Remove/retire docs-consistency-test (locked decision)
- [x] Remove `docs-consistency-test` entry from `package.json` (or repoint to an existing test if you prefer to keep the script name as a no-op wrapper).
- [x] Update `tests/script-coverage.js` so it does not expect `docs-consistency-test` to run.
- [x] Update any docs referencing the script (if present).

**Exit criteria**
- [x] `npm run script-coverage-test` passes without missing-script references.

## 0.2 Establish “fast smoke lanes” per major surface
Create deterministic, cache-isolated smoke entrypoints:
- [x] **Indexing smoke** (Section 1): core API + minimal index build + API server basic route test
- [x] **Retrieval smoke** (Section 2): search help + search filters + search explain + RRF/blend sanity
- [x] **Services smoke** (Section 3): MCP server basic tool call + JSON-RPC framing sanity
- [x] **Worker/meta smoke** (Section 4): worker pool split teardown + language fidelity baseline
- [x] **Embeddings smoke** (Section 5): cache reuse + dims mismatch failure case
- [x] **SQLite smoke** (Section 6): build + incremental + sqlite ANN extension missing fallback

**Deliverables**
- [x] `npm run smoke:section1`
- [x] `npm run smoke:retrieval`
- [x] `npm run smoke:services`
- [x] `npm run smoke:workers`
- [x] `npm run smoke:embeddings`
- [x] `npm run smoke:sqlite`

**Exit criteria**
- [x] Each smoke lane runs deterministically with an isolated `PAIROFCLEATS_CACHE_ROOT` and cleans up after itself.

## 0.3 Contract capture + coverage ledger (repo-wide)
- [x] Create/update `docs/contracts/` so each major surface has a short contract:
  - indexing stages/modes and artifacts
  - chunk identity and sizing
  - search flags and outputs
  - retrieval ranking/explain semantics
  - sqlite schema/incremental/ANN semantics
  - API server and MCP server request/response/error contracts
- [x] Create a “entrypoint → tests” coverage ledger (what is asserted vs assumed).

**Exit criteria**
- [x] Every public entrypoint has at least one content-asserting test (not just “exits 0”) or a documented gap.

---

# Phase 1 — Stop-the-bleeding P0 fixes (hangs, crashers, leaks)

**Objective:** eliminate known hangs, orphan processes, and common crash paths before feature/semantics work.

## 1.1 Runtime lifecycle teardown (watch mode, worker pools, long-lived resources)
- [x] Persist combined worker pools on runtime creation (e.g., `runtime.workerPools = { tokenizePool, quantizePool, destroy }`).
- [x] Ensure teardown destroys both tokenize and quantize pools (and any other long-lived resources).
- [x] Wrap watch mode in `try/finally` so teardown runs on shutdown/signals.

**Exit criteria**
- [x] `build_index.js --watch ...` exits cleanly on SIGINT/SIGTERM with split pools enabled.
- [x] No lingering worker threads keep the Node event loop alive.

## 1.2 Search CLI crashers / hard failures
- [x] Guard `--stats` so it cannot dereference null indexes when a mode is disabled.
- [x] Make telemetry writes best-effort so read-only cache roots do not fail searches.
- [x] Make human-output highlighting safe (escape tokens; avoid unsafe regex compilation).

**Exit criteria**
- [x] Punctuation-heavy queries do not crash human output mode.
- [x] `search --stats` works across modes.

## 1.3 Bench and test harness correctness hazards
- [x] Fix bench runner acceptance so missing timing stats cannot be recorded as `0ms`.
- [x] Fix `tests/language-fidelity.js` `failures` scoping error and make token postings validation resilient to sharded formats.
- [x] Fix bench harness line normalization to avoid `
 → \n\n` artifacts.

**Exit criteria**
- [x] Bench fails loudly when it cannot measure.
- [x] Language fidelity fails only on real fidelity problems (not reference errors).
- [x] Bench output parsing remains stable on Windows and non-TTY.

## 1.4 File processor observability
- [x] Record skip reason on read failure (do not silently drop files from indexing).

**Exit criteria**
- [x] Read failures are surfaced in metrics/skipped lists and covered by a test.

## 1.5 Python AST pool: prevent orphans
- [x] On timeout/write error, explicitly kill the Python worker process.
- [x] Add crash-loop guard/backoff; fall back to heuristic chunking.
- [x] Add optional queue backpressure.

**Exit criteria**
- [x] A timeout cannot leave orphan Python processes running.

---

# Phase 2 — Retrieval CLI contract alignment (flags, UX, and help truthfulness)

**Objective:** ensure CLI behavior matches help/docs and eliminate dead/ambiguous flags.

## 2.1 Remove dead/ambiguous flags (locked decision)
- [x] Remove `--human` and `--headline` from:
  - `src/retrieval/cli-args.js` (parser)
  - help/usage text
  - README/docs that mention them
- [x] Add/adjust tests to ensure the flags are not accepted and that the error is actionable.

**Exit criteria**
- [x] Help output no longer advertises removed flags.
- [x] Passing removed flags returns a clean error (non-zero exit) with remediation.

## 2.2 Flag typing and “missing value is an error” (locked decision)
- [x] Declare `--type`, `--author`, `--import` as **string** options in yargs.
- [x] If any of these flags are passed without a value, fail with:
  - a non-zero exit code
  - a clear message: which flag is missing a value and an example of correct usage

**Exit criteria**
- [x] Regression tests prove correct parsing and error behavior.

## 2.3 Windows path normalization for file/path filters
- [x] Normalize candidate file paths and filter substrings to a shared representation (recommended: POSIX `/` separators + lowercasing).

**Exit criteria**
- [x] Windows-style `--file src\nested\util.ts` matches expected results.

## 2.4 Explain output fidelity
- [x] Ensure explain output includes all applied boosts and scoring components (including symbol boost data).
- [x] Ensure `--why` and `--explain` are identical in content.

**Exit criteria**
- [x] Explain output is “reconcilable” with actual scoring logic and is test-backed.

---

# Phase 3 — Chunking correctness, deterministic sizing, and stable chunk identity

**Objective:** stabilize chunk identity across builds and prevent pathological chunk sizes.

## 3.1 Chunk identity contract (locked decision)
- [x] Treat `chunk.metaV2.chunkId` as the **stable external identifier** across:
  - JSON outputs
  - SQLite records (where applicable)
  - incremental mapping/reuse logic
- [x] Document the distinction:
  - `chunk.id` = index-local numeric id (unstable across builds)
  - `metaV2.chunkId` = stable id (content/structure-derived)

**Exit criteria**
- [x] External outputs clearly expose `metaV2.chunkId` and tests assert stability expectations.

## 3.2 Deterministic chunk splitting (locked decision)
- [x] Add config for deterministic size limits at the chunking layer:
  - max bytes and/or max lines per chunk (choose one primary; support both if needed)
- [x] Ensure the split logic is deterministic (no dependence on iteration order/concurrency).
- [x] Add regression tests for oversize inputs.

**Exit criteria**
- [x] With a fixed config, repeated runs produce identical chunk boundaries and IDs.
- [x] No chunk exceeds configured limits.

---

# Phase 4 — Retrieval pipeline semantics (early filtering, top-N fulfillment, determinism)

**Objective:** ensure `--top N` means what it says, and results are predictable.

## 4.1 Apply filters earlier (locked decision; architecture supports it)
The current pipeline computes `allowedIdx` early but applies it late (after ranking). This causes under-filled results when filters are restrictive.

Implement pre-filtering without rewriting the rankers:
- [x] Introduce `allowedIdx` into sparse ranking:
  - Option A: modify `rankBM25` / `rankBM25Fields` to accept `allowedIdx` and skip scoring docs not in the allowed set.
  - Option B: apply an early intersection step to postings iteration (equivalent effect, lower overhead).
- [x] For sqlite FTS mode, push down allowed sets where feasible:
  - for small allowed sets: `rowid IN (...)`
  - for large allowed sets: best-effort (documented) or use a temp table strategy if warranted
- [x] Intersect ANN candidate sets with `allowedIdx` so ANN work is not wasted.

**Exit criteria**
- [x] `--top N` returns N results whenever at least N chunks satisfy the filter constraints.
- [x] Regression tests cover restrictive filters and prove top-N fulfillment.

---

# Phase 5 — Artifact durability and atomicity (with `.bak` retention)

**Objective:** eliminate partial/corrupt writes and ensure crash recovery is possible.

## 5.1 Safer atomic replace with `.bak` retention (locked decision)
- [x] Implement safer `replaceFile()`:
  - write `*.tmp-*` in same directory
  - rename existing destination to `*.bak` (best-effort)
  - rename temp to destination
  - keep `.bak` until the next successful read/validate cycle, then best-effort delete
- [x] Update critical readers (where practical) to fall back to `.bak` if the primary is missing/corrupt.

**Exit criteria**
- [x] A crash during write never removes both old and new files.
- [x] Recovery behavior is documented and tested.

## 5.2 Setup idempotency across all artifact formats
- [x] Replace “index exists” detection to recognize:
  - `chunk_meta.json`
  - `chunk_meta.jsonl`
  - `chunk_meta.meta.json` + `chunk_meta.parts/`
- [x] Add tests covering partial installs and re-run behavior.

**Exit criteria**
- [x] Re-running setup is a no-op when artifacts are already present and valid.

## 5.3 HNSW build output atomicity
- [x] Write HNSW `.bin` to a temp path and atomically replace the final.
- [x] Store actual inserted vector count and validate it matches expectations.

**Exit criteria**
- [x] HNSW artifacts are never half-written and failures preserve prior working indexes.

---

# Phase 6 — Embeddings tooling correctness (cache integrity, decoding alignment, dims validation)

**Objective:** ensure embeddings are correct, deterministic, and not reused across incompatible configs.

## 6.1 Cache key correctness
- [x] Include in embeddings cache keys:
  - model identity (`modelId`)
  - effective dims
  - quantization scale
  - stub vs real mode (and provider)
- [x] Store cache metadata for diagnostics.

**Exit criteria**
- [x] Changing model/dims/scale changes cache key and triggers recompute.

## 6.2 Hashing and decoding consistency
- [x] Compute file hash from raw bytes (buffer), not decoded text.
- [x] Decode text for slicing using the same decode logic as indexing (shared helper).
- [x] Add shared helper `readTextFileWithHash()` used by both indexer and embeddings tool.

**Exit criteria**
- [x] Embeddings slicing is consistent with chunk offsets produced by indexing for non-UTF8 inputs.

## 6.3 Dims mismatch policy (locked decision)
- [x] Detect actual embedding dims from computed vectors.
- [x] If configured dims mismatch actual dims: **fail hard** with an actionable error message.

**Exit criteria**
- [x] Dims mismatch cannot silently truncate vectors.

---

# Phase 7 — SQLite builder integrity, ANN semantics, and hardening

**Objective:** make SQLite build/update safe, deterministic, and injection-resistant.

## 7.1 Transaction boundaries and fail-closed state
- [x] Wrap incremental update in transaction boundaries that prevent partial state from being promoted.
- [x] Ensure `index_state.json` is fail-closed:
  - set pending before work
  - only mark ready after successful replacement/validation

**Exit criteria**
- [x] Failure mid-update does not leave the DB promoted as “ready”.

## 7.2 Bundle-backed rebuild completeness (locked decision)
- [x] Treat missing/invalid bundles as **fatal** for bundle-backed rebuild:
  - either fail closed, or
  - fall back to artifact-backed rebuild (but never produce a silently partial DB)
- [x] Add tests with missing bundle references.

**Exit criteria**
- [x] Bundle-backed rebuild cannot silently drop files.

## 7.3 SQLite replacement hygiene (WAL/-shm)
- [x] Implement `replaceSqliteDatabase(tempDbPath, finalDbPath)` that also manages `-wal`/`-shm` sidecars.
- [x] Use this helper in build and compact tools.
- [x] Add regression test for stale WAL sidecars.

**Exit criteria**
- [x] Stale WAL/shm sidecars do not break rebuilt/compacted DBs.

## 7.4 Injection-safe dynamic SQL
- [x] Validate identifiers (table/column/module names) via allowlist regex.
- [x] Replace raw `options` concatenation with structured config or strict allowlist parsing.
- [x] If validation fails: disable extension mode and warn (do not execute unsafe SQL).

**Exit criteria**
- [x] No config-driven SQL injection primitives remain.

## 7.5 sqlite-vec candidate-set semantics (locked decision)
- [x] Implement candidate pushdown for small candidate sets (exact within candidate set).
- [x] For large candidate sets: best-effort fallback is allowed but must be documented and observable.
- [x] Ensure deterministic ANN ordering (`ORDER BY distance, rowid`).

**Exit criteria**
- [x] Candidate-set correctness is guaranteed for small candidate sets and test-backed.

## 7.6 Extension download/extraction hardening
- [x] Prevent zip-slip/tar traversal and symlink tricks.
- [x] Add malicious archive fixtures and assert extraction never writes outside destination.

**Exit criteria**
- [x] Extension extraction is path-safe and test-backed.

---

# Phase 8 — Service surfaces (API server + MCP server) hardening

**Objective:** make service mode reliable under concurrency, cancellation, and malformed inputs.

## 8.1 API server request validation + error contract (locked decisions)
- [x] Add request schema validation for `/search` and `/search/stream`:
  - reject unknown fields (`additionalProperties: false`)
  - validate types/ranges/enums
- [x] Implement stable error payloads:
  - `NO_INDEX` returns **409**
  - invalid request returns 400
  - internal errors return 500 with `{ ok:false, code:'INTERNAL', ... }`

**Exit criteria**
- [x] API error responses are predictable and machine-parseable.

## 8.2 API server streaming robustness
- [x] Handle client disconnects and propagate cancellation where feasible.
- [x] Respect backpressure (`drain`) and avoid writes-after-close.
- [x] Add tests for aborted streaming requests.

**Exit criteria**
- [x] Streaming endpoints do not leak work or crash on slow/aborting clients.

## 8.3 JSON-RPC framing safety (MCP + LSP)
- [x] Replace per-message writer creation with per-stream writer + serialization queue.
- [x] Provide close semantics to prevent writes-after-close.
- [x] Fix LSP shutdown ordering issues (`ERR_STREAM_DESTROYED`) and add regression tests.

**Exit criteria**
- [x] No frame corruption under concurrent sends.
- [x] Shutdown is deterministic and does not emit stream-destroyed errors.

## 8.4 MCP server backpressure and timeouts (locked decision)
- [x] Implement queue cap with clear error code on overload.
- [x] Implement per-tool timeouts with conservative defaults (overrideable via config).
- [x] Add schema snapshot tests for MCP tool definitions and representative responses.

**Exit criteria**
- [x] MCP cannot hang indefinitely without an explicit long timeout.
- [x] Tool schema changes are intentional and test-detectable.

---

# Phase 9 — Un-gate flaky tests and strengthen CI signals

**Objective:** reduce “safety tape” (skips/gates) and ensure CI failures indicate real regressions.

## 9.1 Un-gate currently skipped/unstable tests
- [x] Fix Windows `fixture-parity` crash (exit 3221226505) with diagnostics and regression.
- [x] Fix `type-inference-crossfile-test` hang with timeouts + deterministic cleanup.
- [x] Fix `type-inference-lsp-enrichment-test` stream shutdown ordering.

**Exit criteria**
- [x] Previously gated tests run deterministically (or are explicitly retired with rationale and cleanup).

## 9.2 Script coverage ≠ correctness
- [x] Split test coverage into:
  - Tier A: surface coverage (command runs/usage/exit codes)
  - Tier B: behavioral correctness (artifact invariants, output invariants, negative tests)
- [x] Require Tier B for artifact-producing scripts.

**Exit criteria**
- [x] Script coverage failures point to missing *meaningful* tests, not only missing invocations.

## 9.3 Add minimal platform matrix
- [x] Add a Windows CI lane running a reduced but meaningful suite:
  - worker pool teardown regression
  - path normalization tests
  - fixture parity (reduced fixture)
- [x] Keep Linux lane as the primary full suite.

**Exit criteria**
- [x] Windows regressions are caught continuously.

---

# Phase 10 — Modularization (refactor-only; behavior frozen by tests)

**Objective:** reduce defect surface area by splitting mega-files only after correctness is stabilized.

## 10.1 Retrieval
- [x] Split `src/retrieval/cli.js` into cohesive modules (normalize options, load indexes, run search, render output, telemetry, highlight).
- [x] Split `src/retrieval/output.js` (filters, explain formatting, context cleaning, caching).

## 10.2 Indexing + language
- [x] Split `src/index/build/file-processor.js` into read/chunk/relations/meta/embeddings/incremental modules.
- [x] Split TypeScript and Tree-sitter integration modules as planned in the Section roadmaps.

## 10.3 Services
- [x] Split `tools/mcp-server.js` into transport/repo/runner/tools modules.     
- [x] Split `tools/api-server.js` into router/validation/sse/response modules.  

**Exit criteria**
- [x] Refactors introduce no behavior change without tests updated accordingly. 
- [x] Modules are cohesive and significantly smaller (soft target: ≤ ~300 LOC). 

---

# Phase 11 — Documentation parity and migration notes

**Objective:** ensure docs/help match actual behavior; document breaking changes introduced by locked decisions.

## 11.1 Retrieval docs and help
- [x] Remove references to removed flags (`--human`, `--headline`) and update examples.
- [x] Document:
  - stable chunk id (`metaV2.chunkId`)
  - filter ordering semantics and `--top` fulfillment expectations
  - explain output components

## 11.2 API server docs
- [x] Align docs with actual SSE event types and routes.
- [x] Document `/metrics`.
- [x] Document the `409 NO_INDEX` behavior and error schema.

## 11.3 SQLite + embeddings docs
- [x] Document bundle-backed rebuild failure behavior.
- [x] Document candidate-set ANN semantics (exact small / best-effort large).
- [x] Document dims mismatch hard-failure behavior and remediation steps.

**Exit criteria**
- [x] Docs and CLI help no longer contradict implementation.

---

# Phase 12 — Additional phases (gaps not fully covered by the source roadmaps)

These phases are recommended additions based on codebase risk profile.

## 12.1 Security posture and supply-chain hardening
- [x] Add archive extraction hardening beyond traversal:
  - size limits (zip bombs)
  - safe symlink handling
  - permission normalization
- [x] Add download verification policy for external artifacts (hash allowlists or signed manifests where feasible).
- [x] Add “untrusted repo indexing” guardrails (file size caps, recursion limits, degenerate input protection).

## 12.2 Cross-surface error taxonomy + observability consistency
- [x] Define a shared error code taxonomy used by:
  - CLI
  - API server
  - MCP server
- [x] Standardize structured logging (especially for service modes).
- [x] Align metrics labels and ensure key counters exist (timeouts, fallbacks, cache hits/misses).

## 12.3 Release readiness discipline
- [x] Define versioning rules for:
  - output schema changes
  - artifact schema changes
  - CLI flag removals/renames
- [x] Add a concise changelog process that is enforced for breaking changes.

---

## Appendix — Dependency-optimized execution order (recommended)

1) Phase 0 (baseline truth + remove broken docs-consistency script)  
2) Phase 1 (stop-the-bleeding P0 fixes)  
3) Phase 2–4 (retrieval CLI + chunking + early filtering semantics)  
4) Phase 5–7 (artifact durability + embeddings + SQLite integrity)  
5) Phase 8–9 (services hardening + un-gating tests + CI matrix)  
6) Phase 10–12 (modularization, docs parity, security/observability/release discipline)


# Phase 21 — Storage, Compression, and Determinism (Fflate, Msgpackr, Roaring, XXHash, LMDB)

**Objective:** Implement durable, efficient artifact storage with deterministic formats and checksums.

## 21.1 Compression and serialization
- [x] Use `fflate` streaming compression for large artifacts; update `docs/artifact-contract.md`.
- [x] Add `msgpackr` envelope format for bundles with deterministic encoding and checksums.

## 21.2 Postings storage and hashing
- [x] Use `roaring-wasm` for bitmap-accelerated filter evaluation now that it is implemented.
- [x] Use `xxhash-wasm` for checksums; keep sha1 for legacy identifiers where required.

## 21.3 Alternative storage backend
- [x] Implement optional LMDB backend (`lmdb`) with keyspace schema + migration rules.
- [x] Add throughput and corruption checks in `tools/report-artifacts.js` and bench runs.

**Deliverables**
- Compressed, deterministic artifact formats with checksum validation.
- Optional LMDB backend with benchmarks.

**Exit criteria**
- Artifacts validate deterministically and storage backends pass integrity checks.

---


## 4.2 Advanced **risk analysis**: sources / sinks / sanitizers / flows

### Dependency guidance (best choices)
- `@ast-grep/napi` — implement rule packs for sources/sinks/sanitizers using structural patterns (AST-level matching).
  - Use the JS API for integration; keep rule packs versioned and testable.
- `re2js` — use for user-supplied or configurable regex rules to avoid ReDoS in large repos.
- `aho-corasick` — accelerate “dictionary style” scanning (many fixed tokens like sink names, env var keys, SQL APIs) before expensive AST passes.
- `graphology` — represent flows as graphs (nodes = symbols/expressions/files; edges = dataflow/callflow/import).
  - Use traversal + shortest-path utilities for explainable flow paths.
- `roaring-wasm` — represent taint sets and reachability sets efficiently; union/intersection are hot-path ops for flows.

The current regex-based “sources × sinks” cartesian product is a useful baseline, but not advanced.

## Phase 1: Make the roadmap executable and falsifiable

### 1.1 Truth table: behavioral ledger of user-visible invariants

**Audit (code evidence)**

- A truth-table document exists: `docs/truth-table.md`.
- Additional “contract” style docs exist and help (even if not named “truth table”):
  - `docs/artifact-contract.md`
  - `docs/search-contract.md`

**Gaps / issues**

- None noted; truth table now maps behavior to implementation, config, and tests.

**Remaining work**

- [x] Expand `docs/truth-table.md` into a complete “behavioral ledger” for:
  - build modes/stages (stage1–stage4),
  - all public `--mode` values (including any supported “extracted-prose” semantics),
  - backend selection rules (file-backed vs sqlite; auto/fallback vs forced),
  - key indexing invariants (chunk IDs, artifact names, sharding formats),
  - search semantics (filters, ranking, explain output),
  - service/API/MCP behavior (job queueing, timeouts/retries).
- [x] For each truth-table claim, add:
  - “Implementation pointers” (file paths + function names),
  - “Config knobs” (profile/env keys),
  - “Proving tests” (tests that would fail if the claim breaks).

### 1.2 Acceptance fixtures + golden expectations

**Audit**

- Multiple fixture repos exist:
  - `tests/fixtures/sample`
  - `tests/fixtures/mixed`
  - `tests/fixtures/medium` generator (`generate-medium-fixture.cjs`)
- There are strong integration tests around fixtures and parity:
  - `tests/fixture-smoke.js`
  - `tests/fixture-parity.js` / `tests/parity.js`

**Gaps / issues**

- There is no “golden must-hit” query pack that asserts specific retrieval expectations for:
  - comment-derived matches vs code matches,
  - risk/type filters,
  - extracted-prose behavior (if supported).

**Remaining work**

- [ ] Add a small “golden query suite” for `tests/fixtures/mixed` with assertions like:
  - query → expected file(s)/chunk(s) appear in top-N
  - filters change results in predictable ways
- [x] Add a dedicated extracted-prose fixture/query (`tests/extracted-prose.js`).
- [x] Add deletion coverage to incremental reuse tests (manifest extra entry now forces reuse rejection).

---

## Phase 2: Artifact contract, metadata contract, and durability

---

## Phase 3: Segment-aware chunking, mixed-file support, and prose
### 3.5 Correctness tests for segmentation + prose

**Remaining work**

- [x] Add extracted-prose build/search integration tests (`tests/extracted-prose.js`).
- [ ] Add a golden-query test proving comment-field vs code-field behavior (e.g., query that matches only a comment should still retrieve the owning code chunk).

---

---

# Appendix A: COMPLETED_PHASES.md cross-check (dedupe + drift notes)

This repository contains a historical “completed phases” ledger in `COMPLETED_PHASES.md`. The ledger includes multiple phase-number series and several references that appear to be from older layouts. Where the completed phases describe an older approach that has been superseded by a newer design, this audit treats the older approach as **(DEPRECATED/REPLACED)** and focuses on verifying the best/latest implementation.

## A.1 Doc/reference drift (files/dirs referenced but not present)

The following references are still missing from the current repository layout:

- `scripts/config`
- `scripts/styles`
- `scripts/tools`
- `docs/config` (directory)
- `docs/tests` (directory)
- `tests/fixtures/docs`
- `tests/fixtures/external-docs`

Previously noted drift entries now have clear replacements or are present:

- `tools/index-bench-suite.js` -> `tools/bench-query-generator.js` + `tests/bench.js`
- `docs/phase3-parity-report.json` exists in `docs/`
- `tools/bench-compare-models.js` -> `tools/compare-models.js`
- `tools/mergeNoResultQueries.js` -> `tools/merge-no-results.sh`
- `tools/mergeSearchHistory.js` -> `tools/merge-history.sh`
- `tools/search-sqlite.js` -> `search.js --backend sqlite`

## A.2 High-confidence verification of major “completed” subsystems

The following completed-phase feature clusters are clearly implemented in code and generally covered by tests:

- Cache layout and repo/build root resolution:
  - `tools/dict-utils.js`, tests `tests/tool-root.js`, `tests/repo-root.js`
- Tooling detect/install + language servers:
  - `tools/tooling-detect.js`, `tools/tooling-install.js`, and providers under `src/index/tooling/`
- Structural search surface:
  - `bin/pairofcleats.js` structural commands, structural matching under `src/retrieval/structural-*.js`, tests `tests/structural-search.js`
- Ingest tools (ctags/gtags/lsif/scip):
  - `tools/ctags-ingest.js`, `tools/gtags-ingest.js`, `tools/lsif-ingest.js`, `tools/scip-ingest.js`
- Service-mode indexing:
  - `tools/indexer-service.js`, `tools/service/queue.js`, tests `tests/indexer-service.js`, `tests/two-stage-state.js`
- API and MCP:
  - `tools/api-server.js`, `tools/mcp-server.js`, tests `tests/api-server.js`, `tests/mcp-smoke.js`

### Previously noted cross-cutting issues (now resolved)

Even where the phase is “complete,” the following issues were addressed (they affected completed functionality too):

- Incremental reuse deletion correctness (fixed in `src/index/build/incremental.js` + `tests/incremental-reuse.js`)
- Library-unsafe process exit in sqlite backend creation (fixed in `src/retrieval/cli-sqlite.js`)
- Stage3 durability/atomicity inconsistencies (fixed in `tools/build-embeddings.js` + index_state gating)

---

## Appendix B: Suggested new tests (concrete proposals)

These are intentionally specific and can be added quickly.

1. **Incremental deletion reuse test**
   - Build code index for a small fixture
   - Assert file `X` produces at least one chunk
   - Delete file `X`
   - Re-run build with reuse enabled
   - Assert `chunk_meta` contains no entries for `X` and searching a unique token from `X` yields no hits
   - Status: manifest-level deletion coverage added in `tests/incremental-reuse.js`; full fixture/search variant still optional.

2. **Extracted-prose integration test (if supported)**
   - Build `--mode extracted-prose` for a fixture containing doc-comments and config blocks
   - Search for a phrase that appears only in comments and verify results appear from extracted-prose index
   - Status: implemented in `tests/extracted-prose.js`.

3. **SQLite backend non-fatal missing dependency test**
   - Simulate `better-sqlite3` import failure (dependency injection or env guard)
   - In backend “auto,” verify search falls back to file-backed
   - In backend “forced sqlite,” verify a structured error is returned/thrown (no process exit)
   - Status: implemented in `tests/sqlite-missing-dep.js` (env guard via `PAIROFCLEATS_SQLITE_DISABLED`).

4. **Stage3 embeddings validation test**
   - Run stage2 build with embedding service disabled (or stubbed)
   - Run `tools/build-embeddings.js`
   - Run `tools/index-validate.js` and assert pass
   - Verify `index_state.json` updated atomically (e.g., checksum of file valid, schema valid)
   - Status: implemented in `tests/embeddings-validate.js` (build + embeddings + validate, index_state flags checked).

---

# Phase 23.4 — Language module modularization (barrel + submodules)

**Objective:** convert the two largest language “mega-files” into a `typescript/`-style layout (directory of cohesive modules + a stable barrel file), without changing behavior.

## 23.4.1 `src/lang/python.js` → `src/lang/python/*` (keep `src/lang/python.js` as the barrel)

* [x] Create `src/lang/python/` directory.
* [x] Move the embedded script into a dedicated module:

  * [x] `src/lang/python/ast-script.js`: export `PYTHON_AST_SCRIPT` (string) and any script-version constants.
  * [x] Keep the spawn path unchanged (`python -u -c <script>`); do **not** introduce runtime file reads unless packaging guarantees exist.
* [x] Split process/pool responsibilities:

  * [x] `src/lang/python/executable.js`: detection + validation of `python` binary (currently the “probe” spawn logic).
  * [x] `src/lang/python/pool.js`: pool lifecycle (spawn, health, request/response framing, backpressure, shutdown).
  * [x] `src/lang/python/ast.js`: `getPythonAst()` wrapper (pure API surface; delegates to pool).
* [x] Split transformation logic (pure, unit-testable):

  * [x] `src/lang/python/chunks-from-ast.js`: `buildPythonChunksFromAst()`.
  * [x] `src/lang/python/chunks-heuristic.js`: `buildPythonHeuristicChunks()`.
  * [x] `src/lang/python/imports.js`: `collectPythonImports()`.
  * [x] `src/lang/python/relations.js`: `buildPythonRelations()`.
  * [x] `src/lang/python/docmeta.js`: `extractPythonDocMeta()`.
  * [x] `src/lang/python/normalize.js`: shared normalizers/utilities used across the above (offset mapping, safe slicing, etc.).
* [x] Convert `src/lang/python.js` into a barrel:

  * [x] Re-export the existing public API (same names, same signatures):        
    `shutdownPythonAstPool`, `getPythonAst`, `buildPythonChunksFromAst`, `buildPythonHeuristicChunks`, `collectPythonImports`, `buildPythonRelations`, `extractPythonDocMeta`.
* [x] Add tests that become easy only after this split:

  * [x] `tests/lang/python-heuristic-chunking.test.js`: deterministic chunk boundaries for representative Python fixtures.
  * [x] `tests/lang/python-imports.test.js`: imports edge cases (relative, `from x import y`, multiline, conditional).
  * [x] `tests/lang/python-pool.test.js`: pool shutdown/idempotency; “python missing” path is handled predictably.

**Deliverables**

* `src/lang/python/*` module set + barrel `src/lang/python.js`
* Focused unit tests for chunking/imports/pool behavior

**Exit criteria**

* No change in chunk counts/ranges for existing fixtures (or goldens updated with explicit justification).
* `src/lang/python.js` drops to a thin re-export + minimal wiring (soft target: ≤ ~80 LOC).

---

## 23.4.2 `src/lang/javascript.js` → `src/lang/javascript/*` (keep `src/lang/javascript.js` as the barrel)

* [x] Create `src/lang/javascript/` directory.
* [x] Split parsing vs. downstream consumers:

  * [x] `src/lang/javascript/parse.js`: `parseJavaScriptAst()` and parser selection options.
  * [x] `src/lang/javascript/ast-utils.js`: node range helpers, safe traversal, normalization utilities.
* [x] Split chunking vs. relations vs. docmeta:

  * [x] `src/lang/javascript/chunks.js`: `buildJsChunks()`.
  * [x] `src/lang/javascript/imports.js`: `collectImportsFromAst()` and `collectImports()`.
  * [x] `src/lang/javascript/relations.js`: `buildCodeRelations()` (and any call/usages extraction helpers).
  * [x] `src/lang/javascript/docmeta.js`: `extractDocMeta()`.
* [x] Convert `src/lang/javascript.js` into a barrel that re-exports the same API.
* [x] Add tests:

  * [x] `tests/lang/js-imports.test.js`: ESM/CJS/dynamic imports; re-exports; `require()` parsing.
  * [x] `tests/lang/js-chunking.test.js`: functions/classes/exports chunk boundaries.
  * [x] `tests/lang/js-relations.test.js`: calls/usages extraction stability.

**Deliverables**

* `src/lang/javascript/*` module set + barrel `src/lang/javascript.js`

**Exit criteria**

* `language-registry` and `chunking` still import the same public functions with no behavior drift.
* `src/lang/javascript.js` becomes a thin barrel (soft target ≤ ~80 LOC).

---

# Phase 23.5 — Index chunking + language registry modularization

**Objective:** split two “hub” modules into cohesive submodules so they become readable, testable, and easier to extend.

## 23.5.1 `src/index/chunking.js` → `src/index/chunking/*`

* [x] Create `src/index/chunking/` directory and convert `src/index/chunking.js` into:

  * [x] a small barrel exporting `smartChunk` and the public format chunkers (Markdown/JSON/YAML/etc) exactly as today.
* [x] Split by responsibility:

  * [x] `src/index/chunking/limits.js`: `resolveChunkingLimits`, `applyChunkingLimits`, `splitChunkByLines`, `splitChunkByBytes`, boundary safety.
  * [x] `src/index/chunking/dispatch.js`: `resolveChunker`, CODE_CHUNKERS / PROSE_CHUNKERS / CODE_FORMAT_CHUNKERS tables, and the `smartChunk()` orchestration.
  * [x] `src/index/chunking/tree-sitter.js`: `getTreeSitterOptions(context)` and any tree-sitter gating rules used by multiple formats.
* [x] Split format chunkers into files (pure logic, easy fixtures):

  * [x] `src/index/chunking/formats/markdown.js`: `chunkMarkdown` (+ fallback heading matcher).
  * [x] `src/index/chunking/formats/json.js`: `chunkJson` (+ string scanning helpers).
  * [x] `src/index/chunking/formats/yaml.js`: `chunkYaml` (and YAML “top-level” mode logic).
  * [x] `src/index/chunking/formats/ini-toml.js`: `chunkIniToml`.
  * [x] `src/index/chunking/formats/xml.js`: `chunkXml`.
  * [x] `src/index/chunking/formats/rst-asciidoc.js`: `chunkRst`, `chunkAsciiDoc`.
* [x] Add tests (these are currently hard to isolate while everything lives in one file):

  * [x] `tests/chunking/limits.test.js`: maxLines/maxBytes splitting invariants.
  * [x] `tests/chunking/yaml.test.js`: root vs top-level behavior; nested documents; anchors.
  * [x] `tests/chunking/json.test.js`: large JSON objects; escaped strings; invalid JSON returns null.

**Deliverables**

* `src/index/chunking/*` directory split with stable exports
* Dedicated chunking format + limit tests

**Exit criteria**

* `smartChunk()` output is identical for a fixed set of fixtures (or changes are intentional + documented).
* `src/index/chunking.js` drops to a barrel + `smartChunk()` wiring only (soft target ≤ ~150 LOC).

---

## 23.5.2 `src/index/language-registry.js` → `src/index/language-registry/*`

* [x] Create `src/index/language-registry/` directory; convert `src/index/language-registry.js` into a barrel re-exporting:

  * [x] `getLanguageForFile`
  * [x] `collectLanguageImports`
  * [x] `buildLanguageContext`
  * [x] `buildChunkRelations`
* [x] Split “registry” (configuration) from “collectors” (parsers):

  * [x] `src/index/language-registry/registry.js`: the language table; selection rules; linguist mapping.
  * [x] `src/index/language-registry/control-flow.js`: `JS_CONTROL_FLOW`, `PY_CONTROL_FLOW`, `buildControlFlowOnly`.
  * [x] `src/index/language-registry/simple-relations.js`: `buildSimpleRelations`, token normalization helpers.
* [x] Move the many one-off import collectors into their own directory:

  * [x] `src/index/language-registry/import-collectors/dockerfile.js`
  * [x] `.../makefile.js`
  * [x] `.../proto.js`
  * [x] `.../graphql.js`
  * [x] `.../cmake.js`
  * [x] `.../starlark.js`
  * [x] `.../nix.js`
  * [x] `.../dart.js`
  * [x] `.../scala.js`
  * [x] `.../groovy.js`
  * [x] `.../r.js`
  * [x] `.../julia.js`
  * [x] `.../handlebars.js`
  * [x] `.../mustache.js`
  * [x] (and the remaining template/DSL collectors)
* [x] Make `registry.js` depend on collectors, not the other way around (prevents circular growth).
* [x] Add tests:

  * [x] `tests/language-registry/collectors.test.js`: fixtures for each collector (small, explicit, easy to extend).
  * [x] `tests/language-registry/selection.test.js`: extension + relPath → language selection invariants.

**Deliverables**

* `src/index/language-registry/*` split + tests for collectors/selection

**Exit criteria**

* A new import collector can be added by creating one file + adding one line to `registry.js` (no edits to unrelated code).
* `src/index/language-registry.js` becomes a barrel (soft target ≤ ~80 LOC).

---

# Phase 23.6 — Cross-file type inference modularization

**Objective:** break `type-inference-crossfile.js` into explicit stages (index → infer → apply → tooling), so bugs become localized and tests become targeted.

## 23.6.1 `src/index/type-inference-crossfile.js` → `src/index/type-inference-crossfile/*`

* [x] Create `src/index/type-inference-crossfile/` directory; keep `src/index/type-inference-crossfile.js` as the barrel exporting `applyCrossFileInference`.
* [x] Split into modules aligned to the algorithm:

  * [x] `constants.js`: sources, confidence defaults, regexes (`RETURN_CALL_RX`, etc.).
  * [x] `symbols.js`: symbol index build (`addSymbol`, `resolveUniqueSymbol`, `leafName`, type-declaration detection).
  * [x] `extract.js`: extract return/param types from chunk docmeta; extract return call sites from chunk text; arg-type inference.
  * [x] `tooling.js`: provider orchestration (`clangd`, `pyright`, `sourcekit`, `typescript`) + logging + retry/breaker normalization.
  * [x] `apply.js`: “write-back” helpers (`addInferredReturn`, `addInferredParam`, diagnostics merge).
  * [x] `pipeline.js`: `applyCrossFileInference()` orchestrator that calls the above in order.
* [x] Add tests by stage:

  * [x] `tests/type-inference-crossfile/symbols.test.js`
  * [x] `tests/type-inference-crossfile/extract.test.js`
  * [x] `tests/type-inference-crossfile/apply.test.js` (idempotency + dedupe invariants)

**Deliverables**

* `src/index/type-inference-crossfile/*` split + focused tests

**Exit criteria**

* `applyCrossFileInference()` remains the only public entrypoint and stays behavior-identical for fixture repos.
* Each stage module is ≤ ~250–300 LOC and testable without filesystem/tooling dependencies.

---

# Phase 23.7 — Index build pipeline modularization (runtime/indexer/artifacts/file-processor)

**Objective:** split “build_index core” into explicit subsystems: runtime config, orchestration, per-file processing, and artifact emission.

## 23.7.1 `src/index/build/runtime.js` → `src/index/build/runtime/*`

* [x] Create `src/index/build/runtime/` and keep `runtime.js` as the public entrypoint exporting `createBuildRuntime`.
* [x] Split into cohesive normalizers:

  * [x] `stage.js`: `normalizeStage`, `buildStageOverrides`.
  * [x] `hash.js`: `normalizeContentConfig`, `buildContentConfigHash`.
  * [x] `logging.js`: `configureLogger` wiring + log-level/format normalization.
  * [x] `caps.js`: guardrails + file caps normalization.
  * [x] `embeddings.js`: embedding-mode resolution + `createEmbedder` wiring.
  * [x] `tree-sitter.js`: enabled-languages resolution + preload policy.
  * [x] `workers.js`: thread limits + worker-pool config resolution and creation.
  * [x] `runtime.js`: final assembly of the runtime object (thin).
* [x] Add tests for config normalization invariants:

  * [x] `tests/build-runtime/stage-overrides.test.js`
  * [x] `tests/build-runtime/content-hash.test.js` (stable stringify inputs)

**Exit criteria**

* No behavioral change in resolved runtime fields for a matrix of configs/env inputs.

---

## 23.7.2 `src/index/build/indexer.js` → `src/index/build/indexer/*`

* [x] Create `src/index/build/indexer/` and keep `indexer.js` exporting `buildIndexForMode`.
* [x] Extract the three top-level “mega-responsibilities”:

  * [x] `signatures.js`: `buildTokenizationKey`, `buildIncrementalSignature`.
  * [x] `embedding-queue.js`: `enqueueEmbeddingJob`.
  * [x] `pipeline.js`: `buildIndexForMode()` orchestrator (should read like: discover → incremental plan → process → postings → artifacts → checkpoint).
* [x] Extract inner pipeline steps so they become independently testable:

  * [x] `steps/discover.js`: discovery reuse/sort/orderIndex assignment.
  * [x] `steps/incremental.js`: reuse decision + manifest pruning + bundle updates (wrapping the existing `./incremental.js` helpers).
  * [x] `steps/process-files.js`: queue/concurrency orchestration over `createFileProcessor`.
  * [x] `steps/postings.js`: wrapping `buildPostings` + token retention.
  * [x] `steps/relations.js`: import scan + relation graph build + cross-file inference gating.
  * [x] `steps/write.js`: `writeIndexArtifacts` + perf profile finalization + “current pointer” updates/checkpoints.
* [x] Add tests:

  * [x] `tests/indexer/signatures.test.js` (hash stability and input sensitivity).
  * [x] `tests/indexer/incremental-plan.test.js` (reuse/skip decisions for synthetic manifests).

**Exit criteria**

* `buildIndexForMode()` becomes ~200–300 LOC and reads as orchestration only.

---

## 23.7.3 `src/index/build/file-processor.js` (finish the split it already started)

This file already delegates to `./file-processor/*`, but still contains multiple concerns that can be separated cleanly.

* [x] Add additional modules under `src/index/build/file-processor/` and move logic out of the parent:

  * [x] `skip.js`: oversize/minified/binary detection policy + consistent skip reasons.
  * [x] `cached-bundle.js`: cached bundle validation + “rehydration” of fileRelations/importLinks/metaV2 defaults.
  * [x] `timings.js`: file timing accounting + perf hooks (`recordFileMetric` call site coordination).
  * [x] `assemble.js`: final chunk object assembly (weights, headlines, external docs, fields).
* [x] Keep `createFileProcessor()` as the only exported factory, but make it mostly “wire dependencies + return processFile”.
* [x] Add tests:

  * [x] `tests/file-processor/skip.test.js`: skip reason invariants (minified name, binary sample, caps).
  * [x] `tests/file-processor/cached-bundle.test.js`: cached bundle reuse doesn’t silently drop required fields.

**Exit criteria**

* Parent `file-processor.js` becomes a wiring module; most logic sits in `file-processor/*`.

---

## 23.7.4 `src/index/build/artifacts.js` → `src/index/build/artifacts/*`

* [x] Create `src/index/build/artifacts/` and keep `artifacts.js` exporting `writeIndexArtifacts`.
* [x] Split artifact emission by domain:

  * [x] `token-mode.js`: token retention decision (`auto/full/sample/none`) + budgeting.
  * [x] `file-meta.js`: `fileMeta` + `fileIdByPath` construction and invariants.
  * [x] `writers/chunk-meta.js`: chunk meta sharding + JSON/JSONL selection.
  * [x] `writers/repo-map.js`: repo map generation + export flags.
  * [x] `writers/file-relations.js`: relations serialization.
  * [x] `filter-index.js`: build + serialize filter index (thin wrapper around existing retrieval module).
  * [x] `compression.js`: compressible artifact set + gzip policy + keepRaw rules.
  * [x] `checksums.js`: checksum collection and embedding into manifests/metrics.
  * [x] `metrics.js`: write metrics payload and perf profile outputs.
* [x] Add tests:

  * [x] `tests/artifacts/token-mode.test.js`
  * [x] `tests/artifacts/file-meta.test.js` (stable fileId assignment, no duplicates)

**Exit criteria**

* Each writer is independently testable with synthetic `state` objects.
* `writeIndexArtifacts()` becomes orchestration-only.

---

# Phase 23.8 — SQLite builder modularization

**Objective:** turn `tools/build-sqlite-index.js` into a thin CLI wrapper over a reusable builder library (and isolate incremental update logic).

## 23.8.1 `tools/build-sqlite-index.js` → `tools/build-sqlite-index/*` + `src/storage/sqlite/build/*`

* [x] Create `tools/build-sqlite-index/`:

  * [x] `cli.js`: argv parsing + normalization + defaults (pure).
  * [x] `run.js`: per-mode orchestration (`runMode`), heartbeats, state updates.
  * [x] `index-state.js`: `updateSqliteState` + `updateIndexStateManifest` (also reused by `build-embeddings`).
  * [x] `temp-path.js`: `createTempPath` (shared with embeddings).
* [x] Create `src/storage/sqlite/build/` to hold the actual logic:

  * [x] `pragmas.js`: `applyBuildPragmas`.
  * [x] `validate.js`: `getSchemaVersion`, `validateSqliteDatabase`.
  * [x] `manifest.js`: `getFileManifest`, `normalizeManifestFiles`, `diffFileManifests`, `isManifestMatch`.
  * [x] `vocab.js`: `getVocabCount`, `fetchVocabRows`, `ensureVocabIds`.
  * [x] `delete.js`: `deleteDocIds`, `updateTokenStats`.
  * [x] `from-artifacts.js`: current `buildDatabase(...)` (fresh build).
  * [x] `from-bundles.js`: current `buildDatabaseFromBundles(...)` (bundle-backed rebuild).
  * [x] `incremental-update.js`: current `incrementalUpdateDatabase(...)` (move whole function first, then split).
  * [x] `statements.js`: prepared statement factory shared across the three build modes (fresh/bundle/incremental).
  * [x] `bundle-loader.js`: Piscina worker wiring + fallback non-worker bundle reads.
* [x] Ensure the tool script becomes:

  1. parse args
  2. resolve paths/config
  3. call `buildSqliteIndex({ mode, inputs, options })`
  4. update manifests/state
* [x] Add unit + integration tests:

  * [x] unit: manifest diff / vocab id creation / delete semantics
  * [x] integration: incremental update produces identical results for “no-change” runs

**Exit criteria**

* `tools/build-sqlite-index.js` shrinks to ~150–250 LOC of CLI wiring.
* Incremental logic becomes testable without invoking the entire CLI.

---

# Phase 23.9 — Embeddings builder modularization

**Objective:** isolate caching, HNSW, SQLite updates, and manifest/state updates into separate modules so each can be tested independently.

## 23.9.1 `tools/build-embeddings.js` → `tools/build-embeddings/*`

* [x] Create `tools/build-embeddings/`:

  * [x] `cli.js`: argv parsing + config resolution.
  * [x] `cache.js`: cache identity, cache-dir layout, signature validity checks.
  * [x] `chunks.js`: `buildChunksFromBundles` + chunk signature computation.
  * [x] `embed.js`: `runBatched`, vector normalization/quantization checks, dims validation helpers.
  * [x] `hnsw.js`: HNSW init/add/save/load meta logic (all `HierarchicalNSW` usage).
  * [x] `sqlite-dense.js`: `updateSqliteDense` and table presence detection.
  * [x] `manifest.js`: `updatePieceManifest` (and any manifest merge logic).
  * [x] `atomic.js`: `createTempPath` + `replaceFile` (then reuse from SQLite builder to remove duplication).
* [x] Convert `tools/build-embeddings.js` into a thin wrapper that calls `runBuildEmbeddings({ ... })`.
* [x] Add tests:

  * [x] cache invalidation when dims/model/provider changes
  * [x] dims mismatch behavior (hard-fail vs skip) remains exactly as designed
  * [x] SQLite dense update only executes when tables exist and mode is enabled

**Exit criteria**

* HNSW and SQLite update code can be tested with small synthetic vectors without reading bundle files.
* Tool script shrinks substantially (target ≤ ~250 LOC).

---

# Phase 23.10 — Bench harness modularization

**Objective:** make `tools/bench-language-repos.js` maintainable by isolating state, progress parsing, process management, and reporting.

## 23.23.1 `tools/bench-language-repos.js` → `tools/bench/language/*`

* [x] Create `tools/bench/language/`:

  * [x] `cli.js`: args parsing + normalization (backend list, lock mode, limits).
  * [x] `config.js`: `loadConfig()` and config schema validation (if any).
  * [x] `locks.js`: lock reading/age/process-alive checks (`checkIndexLock`, etc.).
  * [x] `repos.js`: clone tool detection, long paths support, repo dir resolution.
  * [x] `process.js`: `runProcess`, kill-tree, active-child lifecycle.
  * [x] `progress/state.js`: a single mutable progress model (instead of scattered globals).
  * [x] `progress/parse.js`: shard/file/import stats line parsing (pure functions).
  * [x] `progress/render.js`: log window rendering + formatting.
  * [x] `metrics.js`: LOC stats, heap recommendations, metric summary formatting.
  * [x] `report.js`: `summarizeResults`, `printSummary`, final JSON output.
* [x] Convert `tools/bench-language-repos.js` into a small wrapper that:

  * builds context
  * iterates repos
  * delegates to runner modules
* [x] Add tests:

  * [x] progress line parsing (golden input lines → parsed state)
  * [x] lock semantics (stale lock vs active pid)

**Exit criteria**

* Progress parsing is unit-testable (no subprocess required).
* Main script becomes orchestration only.

---

# Phase 23.11 — Retrieval CLI modularization (finish the split)

**Objective:** reduce `src/retrieval/cli.js` to an orchestrator and push details into `src/retrieval/cli/*` modules.

## 23.11.1 `src/retrieval/cli.js` → additional `src/retrieval/cli/*` extraction

(There are already `cli-*` modules; this is the “finish line”.)

* [x] Extract branch filter logic:

  * [x] `src/retrieval/cli/branch-filter.js`: `resolveRepoBranch` + branch match behavior + “emit empty payload” behavior.
* [x] Extract backend binding glue:

  * [x] `src/retrieval/cli/backend-context.js`: `getSqliteDb/getLmdbDb`, helper creation, backend labeling.
* [x] Extract terminal rendering primitives:

  * [x] `src/retrieval/cli/ansi.js`: the `color` helpers (or move to `src/shared/ansi.js` if reused elsewhere).
* [x] Extract “policy decisions” that currently live inline:

  * [x] `src/retrieval/cli/policy.js`: backendPolicy normalization + selection (sqlite/lmdb/memory).
  * [x] `src/retrieval/cli/model-ids.js`: resolve per-mode model IDs and fallback behaviors.
* [x] Tighten `cli.js` to:

  1. parse args
  2. build context (configs, backends, dictionary)
  3. run queries
  4. render output
* [x] Add tests:

  * [x] snapshot-style tests for help/usage text are already common; add targeted tests for:

    * [x] branch-filter “no results” payload shape
    * [x] backend selection invariants given a simulated availability matrix

**Exit criteria**

* `src/retrieval/cli.js` becomes a readable orchestration layer (target ≤ ~250–300 LOC).
* Backend selection and branch filtering are testable without running the full CLI.

---

# Phase 23.12 — Script coverage harness modularization

**Objective:** make the “scripts are covered by tests” harness maintainable by splitting actions/config, execution, and reporting.

## 23.12.1 `tests/script-coverage.js` → `tests/script-coverage/*`

* [x] Create `tests/script-coverage/`:

  * [x] `actions.js`: the `actions` array (and any tiering logic like `coversTierB`).
  * [x] `runner.js`: `run()`, retry logic, subprocess spawning, env handling.
  * [x] `report.js`: uncovered script detection, pretty printing, failure summarization.
  * [x] `paths.js`: repo root resolution, cache dir resolution.
* [x] Convert `tests/script-coverage.js` into:

  * [x] minimal “load actions → run actions → assert coverage → exit”.
* [x] Add a unit test for the harness itself (lightweight):

  * [x] verify that “unknown script name in covers” produces a clear failure
  * [x] verify that tier overrides work as intended

**Exit criteria**

* Adding a new script coverage rule requires touching `actions.js` only.
* The entrypoint file is short and free of complex logic.

---

## Global modularization guardrails (apply to every phase above)

* [ ] Soft target per module: **≤ ~300 LOC** (consistent with the repo’s Phase 23 exit criteria).
* [ ] Prefer **pure functions** + explicit context objects over hidden module globals.
* [ ] Introduce barrels only to preserve existing import paths (`<name>.js` remains stable, `<name>/...` is new).
* [ ] Every split comes with at least one new “tight” unit test for the extracted logic (not just integration coverage).

# Phase 22 — Verification gates (passed tests)

**Objective:** Consolidate passed Phase 22 verification tests from NEW_ROADMAP.md.

- [x] `tests/search-windows-path-filter.js`
- [x] `tests/search-explain-symbol.js`
- [x] `tests/chunking-limits.js`
- [x] `tests/graph-chunk-id.js`
- [x] `tests/sqlite-chunk-id.js`
- [x] `tests/search-topn-filters.js`
- [x] `tests/search-determinism.js`
- [x] `tests/artifact-bak-recovery.js`
- [x] `tests/setup-index-detection.js`
- [x] `tests/hnsw-atomic.js`
- [x] `tests/encoding-hash.js`
- [x] `tests/embeddings-cache-identity.js`
- [x] `tests/embeddings-dims-mismatch.js`
- [x] `tests/sqlite-index-state-fail-closed.js`
- [x] `tests/sqlite-bundle-missing.js`
- [x] `tests/sqlite-sidecar-cleanup.js`
- [x] `tests/vector-extension-sanitize.js`
- [x] `tests/sqlite-vec-candidate-set.js`
- [x] `tests/download-extensions.js`
- [x] `tests/api-server.js`
- [x] `tests/api-server-stream.js`
- [x] `tests/mcp-robustness.js`
- [x] `tests/lsp-shutdown.js`
- [x] `tests/fixture-parity.js`
- [x] `tests/type-inference-crossfile.js`
- [x] `tests/type-inference-lsp-enrichment.js`
- [x] `tests/worker-pool-windows.js`
- [x] `tests/search-windows-path-filter.js`
- [x] `tests/cli.js`
- [x] `tests/summary-report.js`
- [x] `tests/segment-pipeline.js`
- [x] `tests/ts-jsx-fixtures.js`
- [x] `tests/typescript-parser-selection.js`
- [x] `tests/tree-sitter-chunks.js`
- [x] `tests/mcp-server.js`
- [x] `tests/smoke-services.js`
- [x] `tests/api-server.js`
- [x] `tests/api-server-stream.js`
- [x] `tests/download-extensions.js`
- [x] `tests/download-dicts.js`
- [x] `tests/discover.js`
- [x] `tests/lmdb-report-artifacts.js`
- [x] `tests/lmdb-corruption.js`
- [x] `tests/truth-table.js`
- [x] `tests/artifacts/file-meta.test.js`
- [x] `tests/artifacts/token-mode.test.js`
- [x] `tests/bench-language-lock-semantics.js`
- [x] `tests/bench-language-progress-parse.js`
- [x] `tests/build-runtime/content-hash.test.js`
- [x] `tests/build-runtime/stage-overrides.test.js`
- [x] `tests/chunking/json.test.js`
- [x] `tests/chunking/limits.test.js`
- [x] `tests/chunking/yaml.test.js`
- [x] `tests/embeddings-cache-invalidation.js`
- [x] `tests/embeddings-dims-validation.js`
- [x] `tests/embeddings-sqlite-dense.js`
- [x] `tests/file-processor/cached-bundle.test.js`
- [x] `tests/indexer/incremental-plan.test.js`
- [x] `tests/indexer/signatures.test.js`
- [x] `tests/lang/js-imports.test.js`
- [x] `tests/lang/python-heuristic-chunking.test.js`
- [x] `tests/lang/python-imports.test.js`
- [x] `tests/lang/python-pool.test.js`
- [x] `tests/language-registry/selection.test.js`
- [x] `tests/retrieval-backend-policy.js`
- [x] `tests/retrieval-branch-filter.js`
- [x] `tests/script-coverage-harness.js`
- [x] `tests/script-coverage/actions.js`
- [x] `tests/script-coverage/paths.js`
- [x] `tests/script-coverage/report.js`
- [x] `tests/script-coverage/runner.js`
- [x] `tests/sqlite-build-delete.js`
- [x] `tests/sqlite-build-manifest.js`
- [x] `tests/sqlite-build-vocab.js`
- [x] `tests/type-inference-crossfile/apply.test.js`
- [x] `tests/type-inference-crossfile/extract.test.js`
- [x] `tests/type-inference-crossfile/symbols.test.js`
- [x] `tests/mcp-schema.js`
- [x] `tests/format-fidelity.js`
- [x] `tests/sqlite-incremental-no-change.js`
