# PairOfCleats Roadmap — Complete Integrated Draft (Correctness First, Then Performance + Durability)

- **Advanced rich metadata per chunk** (schema + extraction + indexing + query semantics)
- **Advanced risk analysis** (sources/sinks/sanitizers + flows + local + cross-file)
- **Advanced type inference** (per-language + cross-file + tooling/LSP + confidence/provenance)
- **Generalized hybrid chunking** for **mixed-language files** and **embedded blocks**
- **Comment extraction and prose indexing** (including an optional dedicated comments-prose index)
- **Metric-driven sharding** (folders/files/lines/languages + measured throughput) to equalize shard time
- **Worker pool + parallelism hardening**, with explicit **Windows reliability** gates
- **Pre-pass maximization** to improve throughput of heavier later passes
- **Logging/diagnostics completeness** and actionable failure capture
- **Index evaluation + benchmark query suite generator** (10–100+ searches, configurable, using flags)

Large architectural changes are explicitly permitted when they reduce defect surface area and/or materially improve throughput and durability.

---

## Guiding principles

1. **Correctness is a gate.** No large performance work until correctness gates are consistently green on fixtures and at least one real repo per tier.
2. **Contracts first.** Artifacts, metadata schema, query semantics, and tool APIs must be explicitly versioned and validated.
3. **One pipeline, many modes.** Code / prose / records / extracted-prose should share the same pipeline contracts and invariants.
4. **Provenance everywhere.** Any derived signal (types, risk, relations) must include source + confidence + version + tool provenance.
5. **Deterministic outputs.** Same inputs/config must produce byte-identical artifacts (within allowed non-determinism sections explicitly documented).
6. **Durability is part of correctness.** Atomic builds, crash-safe state, resumability, and migration correctness are not optional.

---

## Definitions

- **toolRoot**: installation directory of PairOfCleats (scripts/config defaults live here).
- **repoRoot**: target repository being indexed.
- **Segment**: contiguous byte range within a file labeled with `(segmentType, languageId, embeddingContext)`.
- **Chunk**: a unit of retrieval inside a segment with stable identity and metadata.
- **Chunk ID**: a stable identifier (derived from file identity + segment identity + chunk range + content hash rules).
- **Stage 1**: fast baseline index (chunks + lexical index + minimal metadata).
- **Stage 2**: enrichment (types, risk, relations, tooling-derived info, structural).
- **Stage 3**: embeddings / ANN + semantic indexing (optional by config).

---

## Phase gating model

Each phase contains:
- **Workstreams** (categories of engineering work)
- **Deliverables** (artifacts/docs/tools)
- **Exit criteria** (hard gates)

If exit criteria are not met, do not proceed to later phases except for narrowly-scoped dependency work.

---

# Phase 1 — Truth Alignment, Spec Freeze, and Correctness Harness

**Objective:** Establish the authoritative definition of “what the tool does,” then encode it into tests, validations, and reproducible fixtures so every subsequent phase is measurable.

## 1.1 Feature truth table (claims → evidence → tests → limitations)

### Dependency guidance (best choices)
- `ajv` — model the truth table itself as a JSON Schema and **validate it in CI** so the “claims → evidence → tests → limits” ledger can’t silently drift.
  - Compile schemas once at startup (`new Ajv({ strict: true, allErrors: true })`), not per file/run.
- `jsonc-parser` — if feature flags or config files are JSONC, use offset-aware parsing (`getLocation`, `parseTree`) so you can attach *precise* diagnostics to a feature claim.
- `semver` — version every claim bundle and feature gate using semver ranges rather than ad-hoc strings.

- [ ] Build `docs/truth-table.md` that covers:
  - [ ] Build modes: code / prose / records / mixed
  - [ ] Chunking rules (by language and file type)
  - [ ] Tokenization semantics (code vs prose)
  - [ ] Index artifact outputs (memory + sqlite + shard formats)
  - [ ] Search semantics (filters, scoring, explain)
  - [ ] Enrichment outputs (risk, types, relations, git)
  - [ ] Service/API/MCP behavior (contracts, stability expectations)
- [ ] For each claim:
  - [ ] link to implementation module(s)
  - [ ] list configuration toggles
  - [ ] list known limitations / failure modes
  - [ ] identify a fixture-based test that demonstrates it

## 1.2 Acceptance-test fixtures and golden expectations

### Dependency guidance (best choices)
- `seedrandom` — make all randomized fixture generation deterministic (seed = repo hash + test name), so flaky “random repos” never block correctness gates.
- `xxhash-wasm` — use fast, stable hashing to derive fixture IDs and to detect unintended fixture drift (hash raw inputs + normalized outputs).

- [ ] Add fixture repos representing:
  - [ ] small: <1k files mixed code/prose
  - [ ] medium: 5k–50k files with mixed languages
  - [ ] multi-language mixed-file repo (HTML+JS+CSS, markdown code fences, etc)
- [ ] Define “must-hit” retrieval assertions:
  - [ ] symbol lookup (name/kind)
  - [ ] structural filters (e.g., `--kind`, `--signature`, `--decorator`)
  - [ ] risk filter behavior (even if basic initially)
  - [ ] type inference visibility (even if minimal initially)

## 1.3 Tool invocation correctness (install-root vs repo-root)

### Dependency guidance (best choices)
- `execa` — standardize all subprocess calls (git, node, pnpm) with robust quoting, streaming output capture, timeouts, and non-throwing exit handling.
  - Prefer `reject: false` and check `exitCode` explicitly; capture `stdout`, `stderr`, and combined `all` output.
- `semver` — validate runtime/tool versions (Node, npm/pnpm, optional native deps) and emit actionable errors early.

- [ ] Implement and require a single resolver:
  - [ ] `resolveToolRoot()` (ESM-safe, based on `import.meta.url`)
  - [ ] `resolveRepoRoot()` (explicit > inferred; deterministic)
- [ ] Convert *all* scripts that spawn other scripts/tools to use toolRoot resolution.
- [ ] Add tests that run commands from a directory **outside** repoRoot.

## 1.4 Determinism and reproducibility baseline

### Dependency guidance (best choices)
- `seedrandom` — seed any randomized ordering (file traversal, shard selection, benchmark query generation).
- `xxhash-wasm` — deterministic hashing for chunk IDs and segment IDs; avoid crypto hashes unless explicitly required.
- `msgpackr` — if you snapshot intermediate artifacts for determinism tests, prefer MsgPack for speed and stable binary outputs.

- [ ] Ensure build artifacts include:
  - [ ] tool version, node version, OS, effective config hash
  - [ ] repo provenance (git commit + dirty flag when available)
- [ ] Establish a deterministic test mode:
  - [ ] deterministic embedding stub (by default in tests)
  - [ ] deterministic ordering everywhere (files, shards, chunk IDs)

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

- [ ] Define/refresh `docs/artifact-contract.md`:
  - [ ] every artifact file + format + version
  - [ ] required fields + optional fields
  - [ ] invariants (cross-artifact) and validation rules
- [ ] Strengthen `tools/index-validate`:
  - [ ] schema validation per artifact
  - [ ] cross checks: chunk IDs, file references, postings references, embedding references
  - [ ] human remediation hints for each failure class

## 2.2 **Metadata schema v2** (rich per-chunk metadata contract)

### Dependency guidance (best choices)
- `ajv` — treat **Metadata Schema v2** as the canonical contract.
  - Encode “required when …” rules as schema + additional runtime checks (Ajv can’t express every cross-field invariant cleanly).
- `semver` — version metadata schema independently from the index container version; negotiate reader compatibility.

This is the foundation for advanced rich metadata, risk flows, and type inference.

- [ ] Create `docs/metadata-schema-v2.md` defining:
  - [ ] stable core: `chunkId`, `file`, `segment`, `range`, `lang`, `ext`, `kind`, `name`
  - [ ] provenance: `generatedBy`, `tooling`, `parser`, versions
  - [ ] doc metadata: signature, docstring/doc-comments, annotations, decorators/attributes
  - [ ] control-flow summary: branches/loops/returns/throws/awaits/async/generator
  - [ ] dataflow summary: reads/writes/mutates/aliases (local first; later cross-file)
  - [ ] dependencies: imports, referenced modules, includes
  - [ ] risk metadata: sources/sinks/sanitizers/flows (+ confidence)
  - [ ] type metadata: declared/inferred/tooling (+ confidence)
  - [ ] embedded metadata: segment parent, embedded language, embedding context
- [ ] Define compatibility rules with existing `docmeta`:
  - [ ] migration mapping from current fields to v2 fields
  - [ ] deprecation schedule for legacy keys

## 2.3 Atomic build and “current” pointer

### Dependency guidance (best choices)
- `better-sqlite3` — implement “current pointer” and multi-stage build state updates as **atomic transactions**.
  - Use WAL journaling; keep write transactions short and bounded.
- `fflate` — if “current pointer” points at compressed shard bundles, stream compress/decompress rather than buffering whole bundles.

- [ ] Build to staging directory `builds/<buildId>/...` (default format: `YYYYMMDDTHHMMSSZ_<gitShortSha|nogit>_<configHash8>`)
- [ ] Validate staging artifacts before promoting to “current”
- [ ] Ensure readers never see partial outputs:
  - [ ] atomic rename/swap semantics
  - [ ] sqlite temp file + rename
  - [ ] shard manifest atomicity

## 2.4 Durable state machine for multi-stage builds

### Dependency guidance (best choices)
- `better-sqlite3` / `lmdb` — persist the build state machine (stage, shard progress, error ledger, tool versions, input manifest hashes) in a durable store.
  - Prefer append-only event logs + periodic snapshots rather than in-place mutation only.
- `pino` — log state transitions as structured events (runId, shardId, stage, timings, error category).
- `prom-client` — expose state machine counters/histograms for throughput and failure rates (per stage, per language).

- [ ] Create a build state model with explicit phases:
  - [ ] discovery → preprocessing → stage1 → stage2 → stage3 → validation → promote
- [ ] Ensure stage2/stage3 jobs cannot remain “running forever”:
  - [ ] heartbeat timestamps: persist `lastHeartbeatAt` every **30s** while a job is `running`
  - [ ] stale job detection: consider a job stale if `now - lastHeartbeatAt` exceeds:
    - [ ] **10 minutes** for stage2 (enrichment; mostly CPU + local IO)
    - [ ] **15 minutes** for stage3 (embeddings; can be longer-running, but heartbeat is independent of work duration)
  - [ ] recovery policy: mark stale jobs as `failed` and re-queue up to **2 retries** (default) with exponential backoff (**2m**, **10m**)
  - [ ] resumable checkpoints: persist progress at least every **1,000 files** or **120 seconds** (whichever comes first)

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

- [ ] Define a new internal representation:
  - [ ] `FileDocument { file, bytes, text, ext, langHint }`
  - [ ] `Segment { segmentId, type: code|prose|config|comment|embedded, languageId, start, end, parentSegmentId?, meta }`
  - [ ] `Chunk { chunkId, segmentId, start, end, name, kind, metaV2 }`
- [ ] Replace “single chunker per file” with:
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

- [ ] Markdown/RST/AsciiDoc:
  - [ ] heading segments (existing)
  - [ ] fenced code blocks (```lang) as **embedded code segments**
  - [ ] inline code spans as optional micro-segments (configurable; concrete defaults):
    - [ ] `indexing.segments.inlineCodeSpans = false` (default)
    - [ ] if enabled: only emit spans with **≥ 8** non-whitespace characters
    - [ ] per-file caps: **≤ 200** spans AND **≤ 64 KiB** total inline-code bytes (truncate beyond cap)
  - [ ] frontmatter blocks (YAML/TOML/JSON) as **config segments**
- [ ] Web components and template containers:
  - [ ] `.vue` (template/script/style)
  - [ ] `.svelte` (script/style/template)
  - [ ] `.astro` (frontmatter + template + style)
- [ ] “HTML inside other languages” baseline:
  - [ ] JSX/TSX: treat JSX regions as embedded markup segments (at least for metadata; chunk boundaries already exist)
- [ ] JSON/YAML embedded inside comments or strings (best-effort):
  - [ ] detect fenced blocks in comments/docstrings tagged `json`, `yaml`, `toml`
  - [ ] treat them as embedded config segments if parseable

## 3.3 Comment extraction as first-class segments

### Dependency guidance (best choices)
- `@es-joy/jsdoccomment` — parse JSDoc blocks into structured AST; preserve descriptions as prose segments and tags/types as metadata.
  - Use `commentParserToESTree` when you need type expressions and tags integrated into an ESTree-like form.
- `jsdoc-type-pratt-parser` — parse complex JSDoc type expressions into AST; store both raw and normalized forms.
- `@typescript-eslint/typescript-estree` — for JS/TS, enable comment/tokens output to reliably extract all comments with ranges.
  - Prefer a non-type-aware parse for comment extraction (fast path), and only enable type-aware mode in Phase 4 when needed.

- [ ] Implement a comment extraction layer per language:
  - [ ] doc comments (existing behavior) as `comment:doc`
  - [ ] inline comments (optional, configurable) as `comment:inline`
  - [ ] block comments as `comment:block`
  - [ ] license/header comments as `comment:license` (default: **extract but do not index**; searchable only when explicitly enabled)
- [ ] Each comment segment must record:
  - [ ] original language + comment style
  - [ ] byte range and line range
  - [ ] nearest symbol anchor (chunkId) when linkable
- [ ] Add config toggles (with concrete defaults):
  - [ ] `indexing.comments.extract = off|doc|all` (default: `doc`)
  - [ ] `indexing.comments.includeLicense = false` (default; when false, emit `comment:license` segments but exclude from term postings)
  - [ ] minimum length thresholds (defaults):
    - [ ] doc comments: **≥ 15** non-whitespace characters after stripping markers
    - [ ] inline/block comments: **≥ 30** non-whitespace characters after stripping markers
    - [ ] after normalization/tokenization: **≥ 5** prose tokens (otherwise drop)
  - [ ] skip patterns (defaults enabled; configurable allow/deny lists):
    - [ ] license/header detector: if a comment is within the first **200 lines** and matches `copyright|license|spdx|apache|mit|gpl|bsd`
    - [ ] generated detector: matches `generated by|do not edit|@generated|autogenerated`
    - [ ] linter-noise detector: matches `eslint-disable|prettier-ignore|noinspection`

## 3.4 Prose-index strategy for comments and extracted prose

### Dependency guidance (best choices)
- `micromark` — for comment-prose indexing, treat fenced blocks inside comments/docstrings similarly to markdown fenced blocks.
- `lru-cache` — cache comment-prose normalization and snippet generation (bounded by sizeCalculation + TTL).
- `msgpackr` — if you create a dedicated prose index, serialize it separately with a small, versioned envelope for fast load/unload.

Two supported options (choose one as default, keep the other as optional):

**Option A — Separate “extracted-prose” index (recommended for clarity)**
  - [ ] Build a distinct index mode: `mode=extracted-prose`
  - [ ] Store comment segments + extracted prose blocks (frontmatter, docstrings, etc.)
  - [ ] Use **prose tokenization** (stemming/stopwords) for these segments
  - [ ] Search tool can query `code`, `prose`, and `extracted-prose` and fuse (RRF)

**Option B — Fielded indexing inside code chunks (DEFAULT)**
- [ ] Keep a single code chunk and index comment-prose as a **separate field**:
  - [ ] add `fieldTokens.comment` (normalized prose tokens from extracted inline/block comments)
  - [ ] keep doc comments in `fieldTokens.doc` (existing behavior)
  - [ ] store raw comment snippets in `docmeta.comments[]` for explain/snippet (not tokenized)
- [ ] Default caps (configurable):
  - [ ] max **5** comment segments per chunk (nearest-to-symbol first)
  - [ ] max **8 KiB** total raw comment bytes per chunk (truncate + note `truncated=true`)
- [ ] Default scoring weights (BM25 field weights; overrideable via `search.fieldWeights`):
  - [ ] code intent: `comment=0.6`
  - [ ] prose intent: `comment=1.8`
  - [ ] mixed intent: `comment=1.2`
  - [ ] path intent: `comment=0.4`

## 3.5 Correctness tests for segmentation and hybrid chunking

### Dependency guidance (best choices)
- `seedrandom` — generate stress fixtures deterministically (random mixed-language embedding + comment fences).
- `ajv` — validate that segmentation outputs comply with `SegmentedDocument` + metadata v2 schema before indexing.

- [ ] Fixture files covering:
  - [ ] HTML with script/style blocks (existing) + nested code/pre
  - [ ] markdown with multiple fenced blocks + frontmatter
  - [ ] Vue/Svelte/Astro files
  - [ ] mixed json-in-comments (doc blocks)
- [ ] Assert:
  - [ ] segment boundaries correct (byte + line ranges)
  - [ ] chunk boundaries correct (no overlaps unless explicitly allowed)
  - [ ] embedded language detection correct enough (by tag/fence/lang attr)
  - [ ] comment segments extracted according to config

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

- [ ] For each supported language, implement metadata extraction producing v2 fields:
  - [ ] symbol identity: name/kind/namespace/class context
  - [ ] signature parsing (params, defaults, return annotations)
  - [ ] modifiers/visibility (public/private/protected/internal)
  - [ ] decorators/attributes/annotations (language-specific)
  - [ ] control-flow summary: branch/loop counts, early return, throw, await
  - [ ] dataflow summary (local): reads/writes/mutates/aliases for key identifiers
  - [ ] call graph summary (local): calls, awaited calls, dynamic calls
  - [ ] structural tags (existing) normalized into v2 tags
- [ ] Add per-language fidelity tests (“golden metadata” tests)

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
- [ ] Define `docs/risk-rules.md`:
  - [ ] source patterns (API inputs, env, files, IPC, user-controlled)
  - [ ] sink patterns (SQL exec, shell exec, file writes, eval, HTML sinks)
  - [ ] sanitizer patterns (escape/sanitize/parameterize)
  - [ ] propagation rules (assignments, returns, params)
  - [ ] categories + severity + confidence
  - [ ] per-language overrides
- [ ] Implement a versioned risk rules bundle:
  - [ ] shipped defaults
  - [ ] repo-local overrides + allowlists/suppressions
  - [ ] rule provenance stored in metadata

### 4.2.2 Intra-procedural taint/dataflow (per chunk/function scope)
- [ ] Build a local dataflow graph per function-like chunk:
  - [ ] identify variables, params, returns
  - [ ] detect reads/writes
  - [ ] propagate taint from sources through assignments/calls/returns
  - [ ] detect sink calls and whether arguments are tainted
  - [ ] record flow evidence (line ranges and variable names)
- [ ] Implement conservative approximations for dynamic constructs:
  - [ ] JS eval/dynamic property access
  - [ ] Python getattr/exec
  - [ ] SQL string building heuristics
- [ ] Add thresholds to prevent worst-case blowups (concrete defaults):
  - [ ] hard cap inputs for graph-based analysis: **≤ 200 KiB** OR **≤ 3,000 lines** per chunk (otherwise skip graph build)
  - [ ] max graph size: **15,000 nodes** / **45,000 edges** per chunk
  - [ ] max analysis budget: **75 ms** wall time per chunk (check budget every ~250 nodes)
  - [ ] fallback when any cap is hit: heuristic-only risk signals + set `risk.analysisStatus = "capped"` with the cap reason

### 4.2.3 Inter-procedural flows (within file, then cross-file)
- [ ] Phase 1 (within file):
  - [ ] connect calls between chunks in same file
  - [ ] propagate taint across call boundaries where signatures are available
- [ ] Phase 2 (cross-file):
  - [ ] build a repo call graph approximation (using existing relations + imports)
  - [ ] propagate taint across module boundaries with bounded depth: **max 2 cross-file hops** (imports/exports), **max 6 total hops** per flow
  - [ ] record “flow paths” with hop list capped to **6 hops** and confidence decay: `confidence *= 0.85` per hop (floor **0.20**); keep at most **3** shortest paths per source→sink pair

### 4.2.4 Risk metadata outputs
- [ ] For each chunk:
  - [ ] `risk.sources[]`, `risk.sinks[]`, `risk.sanitizers[]`
  - [ ] `risk.flows[]` with evidence and scope `local|file|cross-file`
  - [ ] severity + confidence + ruleIds
- [ ] Add search filters:
  - [ ] filter by risk tags/category/severity
  - [ ] filter by flow existence (source→sink)
  - [ ] option to show flow explanation in `--explain`

## 4.3 Advanced **type inference** (local + cross-file + tooling)

### Dependency guidance (best choices)
- `typescript` — primary for TS/JS type inference when a tsconfig exists; extract types with provenance (source, inferred, any/unknown).
  - Prefer incremental Programs (or reuse) rather than re-creating per file.
- `pyright` — primary for Python static typing; run via CLI with `--outputjson` for machine-readable results.
  - Cache pyright environment resolution per repo; treat missing stubs as low-confidence types.
- `protobufjs` — leverage schema-defined types for `.proto` files and for generated-code correlation when present.

### 4.3.1 Local type extraction upgrades
- [ ] Improve literal inference (existing) to include (concrete defaults):
  - [ ] object shape hints (JS/Python dict keys): cap at **20 keys** (keep first-seen order; drop remainder)
  - [ ] array element hints: inspect first **25 elements**
  - [ ] union narrowing from simple conditionals (limited)
- [ ] Track provenance per type entry:
  - [ ] declared (annotation)
  - [ ] inferred (literal/flow)
  - [ ] tooling-derived (LSP/tsserver/clangd/sourcekit)
- [ ] Normalize and canonicalize types per language:
  - [ ] unify builtin synonyms
  - [ ] normalize generics and union notation


### 4.3.2 Cross-file inference engine
- [ ] Build a repo symbol table keyed by:
  - [ ] file + symbol name + kind
  - [ ] export/import edges
- [ ] Infer:
  - [ ] return types from called constructors/factories (bounded; defaults: sample **25** call sites per symbol, depth **≤ 2** hops)
  - [ ] param types based on call sites (bounded; defaults):
    - [ ] sample up to **25** call sites per function (prefer distinct call sites across files)
    - [ ] keep at most **5** distinct candidate types per parameter (drop tail candidates by confidence)
    - [ ] stop after **2** cross-file hops (`confidence *= 0.85` per hop; floor **0.20**)
  - [ ] field types based on assignments and constructor patterns (bounded; defaults):
    - [ ] sample up to **50** assignments/initializers per field
    - [ ] keep at most **5** distinct candidate types per field
- [ ] Confidence model:
  - [ ] decay across hops
  - [ ] conflict resolution rules
  - [ ] record competing candidates

### 4.3.3 Tooling integration hardening (LSP and language servers)
- [ ] Timeouts + circuit breaker + bounded retries (concrete defaults)
  - [ ] per-request timeout: `tooling.timeoutMs = 15_000` (15s; matches current provider defaults, with some secondary calls at 8s)
  - [ ] retries: **2** (exponential backoff 250ms → 1s)
  - [ ] circuit breaker: disable a provider for the remainder of the run after **3** consecutive timeouts/errors
- [ ] Capture per-tool logs per build
- [ ] Store tooling provenance (tool version, command line, workspace root)
- [ ] Make tooling optional and non-fatal

### 4.3.4 Output schema and search integration
- [ ] Emit types in v2 metadata schema:
  - [ ] params, returns, locals, fields
  - [ ] confidence + source + evidence
- [ ] Search filters must support:
  - [ ] `--inferred-type`, `--return-type`, `--param`, `--signature`
  - [ ] “tooling-only” vs “heuristic-only” gating (for debugging)

**Deliverables**
- `docs/risk-rules.md` + risk rules bundle format
- advanced risk engine (local → file → cross-file)
- advanced type inference engine (local + cross-file + tooling)
- v2 metadata completeness across core languages
- fixtures and goldens for risk/types correctness

**Exit criteria**
- Risk flows and type inference are correct on fixtures with documented conservative limitations.
- `index-validate` can validate risk/type metadata invariants.
- Enrichment never crashes indexing; it degrades gracefully with actionable logs.

---

# Phase 5 — Search Correctness, Parity, and Index Benchmarking Suite

**Objective:** Guarantee that search semantics are correct, explainable, and stable across backends, and add an index-evaluation tool that can auto-generate benchmark queries (10–100+ configurable) that exercise flags.

## 5.1 Search contract and explainability

### Dependency guidance (best choices)
- `roaring-wasm` — implement fast boolean retrieval operators (AND/OR/NOT) over postings; this underpins correctness + speed.
- `lru-cache` — query-result caching (per query plan signature); enforce size/TTL to prevent runaway memory.
- `msgpackr` — persist query plans and explain traces for debugging/benchmark replay.

- [ ] Define `docs/search-contract.md`:
  - [ ] ranking components and weights
  - [ ] filter semantics and precedence rules
  - [ ] how multi-mode results are fused (RRF rules)
  - [ ] how metadata fields impact scoring and filtering
- [ ] Implement a single explain schema across backends:
  - [ ] lexical score components
  - [ ] semantic score components
  - [ ] filter decisions
  - [ ] metadata boosts

## 5.2 Backend parity as a gate (memory vs sqlite vs sqlite-fts)

### Dependency guidance (best choices)
- `better-sqlite3` — SQLite backend parity testing: ensure identical semantics vs in-memory index.
- `lmdb` (optional) — if introduced as an alternate backend, add parity tests against SQLite and in-memory.

- [ ] Define parity thresholds (concrete defaults; `K=5`):
  - [ ] Gate policy (concrete default):
    - [ ] memory vs sqlite: **blocking** (fails CI)
    - [ ] memory vs sqlite-fts: **non-blocking warning** (until the backend is promoted from experimental)
  - [ ] Parity scoring rule (concrete default):
    - [ ] if both backends return **0 hits** for a given query+mode, treat `overlap@K = 1.0` and exclude that query+mode from `rankCorr` averaging
  - [ ] memory vs sqlite (primary backend; blocking):
    - [ ] `overlap@5` average **≥ 0.95** (code and prose evaluated separately)
    - [ ] Spearman `rankCorr` average **≥ 0.90**
    - [ ] `avgDelta` average **≤ 0.10**
    - [ ] no single query with `overlap@5 < 0.60`
  - [ ] memory vs sqlite-fts (experimental backend; warning-only):
    - [ ] `overlap@5` average **≥ 0.70**
    - [ ] Spearman `rankCorr` average **≥ 0.55**
    - [ ] `avgDelta` average **≤ 0.50**
- [ ] Create parity debug tooling:
  - [ ] compare component-level scoring
  - [ ] diff filters and metadata interpretation

## 5.3 **Index evaluator + benchmark query generator** (new)

### Dependency guidance (best choices)
- `tinybench` — microbench harness for parsing, chunking, indexing, and query operators (configurable runs, warmups).
- `hdr-histogram-js` — capture latency distributions (p50/p95/p99) across repeated queries and builds.
- `seedrandom` — deterministic benchmark query generation (seeded by index hash + config).
- `prom-client` — export benchmark metrics for dashboards/CI regression gates (histograms + counters).
- `@vscode/ripgrep` — baseline external comparator for lexical search latency + correctness on the same corpora.

This is the requested capability.

- [ ] Implement `tools/index-bench-suite.js` (name illustrative):
  - Inputs:
    - [ ] index path (or repoRoot)
    - [ ] number of queries (10–1000)
    - [ ] random seed
    - [ ] coverage targets (ensure flags are exercised)
  - Index analysis step:
    - [ ] sample symbols by language/kind
    - [ ] sample files by ext/size
    - [ ] sample metadata values (decorators, risk tags, types, visibility, imports)
  - Query generation step:
    - [ ] generate a mixed set:
      - [ ] “name lookup” queries (symbol exact-ish)
      - [ ] “natural language” queries
      - [ ] filters-heavy queries exercising flags:
        - [ ] `--lang`, `--ext`, `--file`, `--kind`
        - [ ] `--calls`, `--uses`, `--reads`, `--writes`, `--mutates`, `--awaits`
        - [ ] `--decorator`, `--signature`, `--param`, `--return-type`, `--inferred-type`
        - [ ] `--risk`, `--min-risk-score` (or equivalent), flow existence filters
        - [ ] `--modified-after`, `--author`, churn filters (where available)
      - [ ] backend toggles:
        - [ ] memory vs sqlite vs sqlite-fts
        - [ ] ann on/off
        - [ ] rrf/mrr/mmr toggles where available
    - [ ] ensure at least `N = max(10, ceil(0.25 * queryCount))` queries include **multiple flags simultaneously**
  - Execution step:
    - [ ] run the search CLI/core search with each query
    - [ ] capture latency, candidate counts, and topK stability
  - Report step:
    - [ ] JSON report + optional markdown summary
    - [ ] per-flag coverage report (“did we exercise X?”)

- [ ] Integrate into CI (smoke-level) and perf pipelines (tiered).

**Deliverables**
- `docs/search-contract.md`
- unified explain schema and parity tools
- index benchmark suite generator + runner + reports
- CI gate that runs a small benchmark suite on fixtures

**Exit criteria**
- Search parity gates are green for fixtures.
- Benchmark suite can generate and run 10–100+ flag-rich queries and produce a report deterministically.

---

# Phase 6 — Throughput Engineering: Sharding, Worker Pools, Parallelism, WASM Parsing Acceleration

**Objective:** After correctness gates are met, maximize build throughput and stability by making sharding metric-driven, tuning concurrency, improving pre-pass leverage, and accelerating language parsing (especially tree-sitter WASM).

## 6.1 Metric-driven sharding (time-equalized shards)

### Dependency guidance (best choices)
- Shard planner algorithm (default): **LPT greedy bin packing** (Longest-Processing-Time first; implement in-house, no new dependency).
- `xxhash-wasm` — stable file identity + content hash used to reuse prior throughput measurements safely across runs.
- `hdr-histogram-js` — maintain per-language/per-extension throughput distributions to inform shard planning.

### 6.1.1 Collect throughput metrics
- [ ] During builds, record per-language performance:
  - [ ] files/sec, lines/sec, bytes/sec
  - [ ] parse time (chunking + relations)
  - [ ] tokenization time
  - [ ] stage2/3/x enrichment time
- [ ] Persist a “perf profile” artifact:
  - [ ] per language + file-size bucket cost model
  - [ ] versioned and tied to config hash

### 6.1.2 Shard planning with a cost model
- [ ] Replace line-count-only shard sizing with estimated time cost:
  - [ ] cost(file) = overhead(lang) + bytes * byteCost(lang) + lines * lineCost(lang)
  - [ ] modifiers for enabled features (relations/flow/tree-sitter/tooling)
- [ ] Implement bin-packing / greedy balancing to minimize shard makespan
- [ ] Support constraints:
  - [ ] preserve directory locality (optional; default: off; for cache locality)
  - [ ] cap max shard size by bytes/lines (defaults): **maxShardBytes = 64 MiB**, **maxShardLines = 200,000**
- [ ] At runtime:
  - [ ] adaptively rebalance when early shards show different throughput than predicted

## 6.2 Worker pool correctness + Windows reliability hard gate

### Dependency guidance (best choices)
- `piscina` — standardize on Piscina for worker pools (robust scheduling, backpressure, worker lifecycle controls).
  - Prefer transferable objects (ArrayBuffer) or SharedArrayBuffer for large payloads; avoid structured-clone of huge JSON.
  - Validate Windows paths/URLs for worker entrypoints (`file://` URLs where needed).
- `pino` — log worker lifecycle events and crashes with shard context; ensure uncaught exceptions are attributed to a shard + stage.

- [ ] Explicitly cap default worker counts (concrete defaults):
  - [ ] `fileConcurrency = min(cpuCount, 16)` (Windows: `min(cpuCount, 8)`)
  - [ ] `cpuConcurrency = fileConcurrency` (avoid CPU oversubscription by default)
  - [ ] `ioConcurrency = min(64, fileConcurrency * 4)` (Windows: `min(32, fileConcurrency * 4)`)
  - [ ] `workerPool.maxWorkers = min(8, fileConcurrency)` (default), and hard-cap at **16** unless explicitly overridden
  - [ ] `indexing.pythonAst.maxWorkers = min(4, fileConcurrency)` (default), and hard-cap at **8** unless explicitly overridden
- [ ] Add Windows-specific CI and stress tests:
  - [ ] worker pool creation, restart, and shutdown
  - [ ] long runs with many small tasks
  - [ ] path length + spaces + unicode paths
- [ ] Improve worker crash reporting:
  - [ ] capture error class, message, stack, serialized “cause” chain
  - [ ] include task context (file, ext, size, mode) on failure
- [ ] Consider splitting pools by task type:
  - [ ] tokenization pool
  - [ ] parsing pool (tree-sitter/Babel/TS)
  - [ ] quantization pool
  - [ ] avoid contention and reduce restart blast radius

## 6.3 Parallelism and pipeline refactors (architectural changes allowed)

### Dependency guidance (best choices)
- `piscina` — use a single pool per stage (or per workload class) with explicit concurrency limits; avoid nested pools.
- `fdir` — parallelize file discovery and stat collection; feed measured work weights into shard planning.
- `lru-cache` — cache parse artifacts (AST, token streams, segment maps) within shard lifetime; enforce strict memory budgets.
- `fflate` — stream intermediate shard writes so workers can flush incrementally rather than buffering.

- [ ] Reduce redundant IO passes:
  - [ ] integrate import extraction into file processing when feasible
  - [ ] defer import-link enrichment to a post-pass instead of separate full scan
- [ ] Stream postings construction:
  - [ ] avoid holding all chunk texts/tokens in memory at once
  - [ ] incremental flush of postings shards
- [ ] Pipeline embeddings with backpressure:
  - [ ] overlap embedding computation with lexical index build where possible
  - [ ] control memory via bounded queues (defaults):
    - [ ] cap pending file-processing tasks at `min(10_000, fileConcurrency * 100)`
    - [ ] cap pending embedding batches at `min(64, embeddingConcurrency * 8)`
    - [ ] when caps are hit, producers block (no unbounded Promise arrays)

## 6.4 WASM parsing acceleration (tree-sitter)

### Dependency guidance (best choices)
- `@swc/core` — where tree-sitter WASM is insufficiently fast for JS/TS metadata, use SWC parse as an accelerator (native, optional).
- `@ast-grep/napi` — can offload certain structural matches to tree-sitter engines efficiently; apply before bespoke analyzers.
- `xxhash-wasm` — cache AST/parse results keyed by stable content hash to avoid repeat work across stages.

Within the limits of web-tree-sitter + tree-sitter-wasms:

- [ ] Optimize traversal:
  - [ ] avoid `node.namedChildren` allocations; use `namedChildCount`/`namedChild(i)` or TreeCursor
  - [ ] avoid `text.split('\n')` for doc extraction when possible (use line index + windowed scanning)
- [ ] Preload grammars efficiently:
  - [ ] keep per-process cache as today, but add an option to preload in parallel after correctness verification
- [ ] Offload heavy parsing to workers (optional; default: off):
  - [ ] per-worker wasm init + grammar cache
  - [ ] measure if this improves throughput vs overhead
- [ ] Add/enable additional WASM grammars where available:
  - [ ] JavaScript / TypeScript / TSX / JSX
  - [ ] Python (chunking fallback to avoid spawning python for stage1)
  - [ ] JSON / YAML / TOML / Markdown (as available) for segment parsing
- [ ] Add per-language performance guardrails:
  - [ ] maxBytes/maxLines gating (defaults):
    - [ ] tree-sitter: skip if file > **512 KiB** or > **10,000 lines**
    - [ ] YAML top-level chunking: skip if file > **200 KiB**
    - [ ] Kotlin flow: skip if file > **200 KiB** or > **3,000 lines**
    - [ ] Kotlin relations: skip if file > **200 KiB** or > **2,000 lines**
    - [ ] per-file parse timeout: if parsing exceeds **1000 ms**, fall back to heuristic chunking for that file
  - [ ] automatic fallback to heuristic parsing on slow files

**Deliverables**
- perf profile artifact + cost-model sharder
- Windows worker pool reliability gate
- reduced redundant passes and pipelined indexing where beneficial
- tree-sitter traversal optimizations + additional wasm grammars
- benchmark comparisons showing throughput improvements

**Exit criteria**
- Shards finish in near-equal wall time on benchmark repos (reduced straggler effect).
- Worker pool does not fail on Windows across stress runs.
- Measured throughput improves without violating correctness gates.

---

# Phase 7 — Observability, Failure Capture, and Operational Durability

**Objective:** Ensure failures are diagnosable, logs are complete, and long-running operation is durable (watch mode, service mode).

## 7.1 Structured logging and run diagnostics

### Dependency guidance (best choices)
- `pino` — structured logs with runId/shardId/stageId; use redaction for secrets; avoid logging full file contents by default.
- `pino-pretty` — developer-only pretty transport; ensure production logs remain JSON.
- `prom-client` — export counters/histograms for build throughput, parse failures, risk rule matches, and query latency.
- `hdr-histogram-js` — maintain in-process histograms for high-cardinality timing stats (then export summaries).

- [ ] Add structured JSON logs option:
  - [ ] log levels
  - [ ] timestamps
  - [ ] buildId correlation
  - [ ] shardId / workerId correlation
- [ ] Capture environment snapshot at start of build:
  - [ ] node version, OS, CPU count, memory
  - [ ] enabled features and effective config hash
- [ ] Ensure logs flush on crash:
  - [ ] avoid fire-and-forget writes for crash logs
  - [ ] add “last N events” ring buffer persisted on fatal errors (default: **N=200** events, capped to **2 MiB** serialized)

## 7.2 Failure taxonomy and actionable capture

### Dependency guidance (best choices)
- `pino` — emit structured error events with classification fields: `{ category, languageId, stage, shardId, file, offset?, tool, retryable }`.
- `ajv` — validate that error objects conform to a schema (so failures are machine-actionable, not ad-hoc strings).

- [ ] Define a failure taxonomy:
  - [ ] parse failures
  - [ ] tool dependency failures
  - [ ] worker pool failures
  - [ ] artifact IO failures (JSON too large, corruption)
  - [ ] sqlite build failures
- [ ] For each failure class:
  - [ ] record minimal reproduction hints
  - [ ] suggest config mitigations (e.g., file caps, disable feature X)

## 7.3 Watch/service durability

### Dependency guidance (best choices)
- `chokidar` — cross-platform file watching; on Windows/network drives prefer `awaitWriteFinish` and consider polling fallback.
- `piscina` — for watch mode, keep pools warm but rate-limit rebuilds; cancel in-flight shard work on superseding changes.

- [ ] Ensure watch mode debounces and avoids rebuild storms
- [ ] Ensure service queue and stage2 jobs:
  - [ ] have durable state machine (Phase 2)
  - [ ] can be resumed after crash/restart
  - [ ] produce per-job logs and reports

**Deliverables**
- structured logging + diagnostic bundle output
- failure taxonomy + captured evidence improvements
- hardened watch/service operation

**Exit criteria**
- Any build failure produces a diagnostic bundle sufficient to triage without rerunning.
- Long-running modes remain stable over multi-hour runs.

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

- [ ] Decide parsing strategy:
  - [ ] tree-sitter wasm grammar (preferred)
  - [ ] heuristic parser
  - [ ] tooling/LSP enrichment only (optional)
- [ ] Implement:
  - [ ] chunk extraction
  - [ ] minimal relations (imports + calls) where feasible
  - [ ] comment extraction rules
  - [ ] metadata v2 mapping
- [ ] Add fixtures:
  - [ ] “language fidelity” tests
  - [ ] perf guard tests (max bytes/lines)
- [ ] Add to benchmark matrix.

## 8.2 Recommended language priorities

### Dependency guidance (best choices)
- Prioritize languages whose parsers expose **ranges/locations** and can run deterministically in your target environments (Node + optional native/WASM).
- Reuse existing primitives (`micromark`, `parse5`, `@ast-grep/napi`, `graphology`, `ajv`) rather than adding bespoke parsers where possible.

**High priority (common + high ROI)**
- [ ] JavaScript/TypeScript (tree-sitter wasm for chunking/metadata)
- [ ] TSX/JSX segmentation improvements
- [ ] Python (tree-sitter wasm chunking as stage1 fallback)
- [ ] Dockerfile
- [ ] Makefile
- [ ] Protobuf
- [ ] GraphQL

**Next tier (ecosystem breadth)**
- [ ] CMake
- [ ] Bazel/Starlark
- [ ] Nix
- [ ] Dart
- [ ] Scala / Groovy
- [ ] R / Julia

**Web template tier**
- [ ] Handlebars/Mustache
- [ ] Jinja2 / Django templates
- [ ] Razor

## 8.3 Architecture simplification after stabilization

### Dependency guidance (best choices)
- Consolidate on fewer parsing/AST stacks per ecosystem:
  - JS/TS: SWC for speed + TypeScript for type-aware enrichment, with AST bridges where needed.
  - Structural matching: `@ast-grep/napi` rule packs to reduce custom per-language logic.
- Keep serialization + storage minimal: `msgpackr` + `fflate` + one durable backend (`better-sqlite3` or `lmdb`) behind a stable contract.

- [ ] Consolidate parsing APIs:
  - [ ] one segment discovery API
  - [ ] one chunking API
  - [ ] one metadata v2 builder interface
- [ ] Reduce duplicate passes and duplicated formats
- [ ] Remove deprecated schema paths once migrations are complete

**Deliverables**
- language onboarding playbook
- expanded language and mixed-file coverage
- simplified architecture and reduced defect surface

**Exit criteria**
- New languages can be added with predictable steps, tests, and guardrails.
- Maintenance burden decreases while coverage increases.

---

## Appendix — Explicit inclusion checklist

This roadmap explicitly includes full implementation planning for:

- **Advanced rich metadata per chunk**: Phase 2.2 + Phase 4.1  
- **Advanced risk analysis (sources/sinks/flows)**: Phase 4.2  
- **Advanced type inference**: Phase 4.3  
- **Hybrid chunking of mixed files**: Phase 3.1–3.2  
- **All comments extracted and searchable as prose**: Phase 3.3–3.4  
- **Metric-driven sharding based on folders/files/lines/languages + throughput metrics**: Phase 6.1  
- **Worker pool correctness + Windows stability**: Phase 6.2  
- **Pre-pass strategy to maximize later passes**: Phase 6.1/6.3 (metrics + planning)  
- **Logging/failure capture completeness**: Phase 7  
- **Auto-generated benchmark query suite (10–100+ searches using flags)**: Phase 5.3

---

## Appendix — Dependency documentation and examples (local)

Local dependency references live under `docs/references/dependency-bundle/`.
OSS summaries remain indexed in `docs/references/README.md`.

### Bundle entrypoints
- README — docs/references/dependency-bundle/README.md
- Topic guide — docs/references/dependency-bundle/TOPIC_GUIDE.md
- Link inventory — docs/references/dependency-bundle/LINK_INVENTORY.md
- Manifest — docs/references/dependency-bundle/manifest.json

### Package sheets
- `typescript` — docs/references/dependency-bundle/deps/typescript.md
- `@typescript-eslint/typescript-estree` — docs/references/dependency-bundle/deps/typescript-eslint-typescript-estree.md
- `micromark` — docs/references/dependency-bundle/deps/micromark.md
- `ajv` — docs/references/dependency-bundle/deps/ajv.md
- `linguist-languages` — docs/references/dependency-bundle/deps/linguist-languages.md
- `yaml` — docs/references/dependency-bundle/deps/yaml.md
- `@vue/compiler-sfc` — docs/references/dependency-bundle/deps/vue-compiler-sfc.md
- `svelte` — docs/references/dependency-bundle/deps/svelte.md
- `@astrojs/compiler` — docs/references/dependency-bundle/deps/astrojs-compiler.md
- `@babel/traverse` — docs/references/dependency-bundle/deps/babel-traverse.md
- `esquery` — docs/references/dependency-bundle/deps/esquery.md
- `@swc/core` — docs/references/dependency-bundle/deps/swc-core.md
- `pyright` — docs/references/dependency-bundle/deps/pyright.md
- `@ast-grep/napi` — docs/references/dependency-bundle/deps/ast-grep-napi.md
- `graphology` — docs/references/dependency-bundle/deps/graphology.md
- `jsdoc-type-pratt-parser` — docs/references/dependency-bundle/deps/jsdoc-type-pratt-parser.md
- `@es-joy/jsdoccomment` — docs/references/dependency-bundle/deps/es-joy-jsdoccomment.md
- `re2js` — docs/references/dependency-bundle/deps/re2js.md
- `aho-corasick` — docs/references/dependency-bundle/deps/aho-corasick.md
- `greedy-number-partitioning` — docs/references/dependency-bundle/deps/greedy-number-partitioning.md
- `xxhash-wasm` — docs/references/dependency-bundle/deps/xxhash-wasm.md
- `roaring-wasm` — docs/references/dependency-bundle/deps/roaring-wasm.md
- `msgpackr` — docs/references/dependency-bundle/deps/msgpackr.md
- `fflate` — docs/references/dependency-bundle/deps/fflate.md
- `lru-cache` — docs/references/dependency-bundle/deps/lru-cache.md
- `better-sqlite3` — docs/references/dependency-bundle/deps/better-sqlite3.md
- `piscina` — docs/references/dependency-bundle/deps/piscina.md
- `fdir` — docs/references/dependency-bundle/deps/fdir.md
- `ignore` — docs/references/dependency-bundle/deps/ignore.md
- `file-type` — docs/references/dependency-bundle/deps/file-type.md
- `istextorbinary` — docs/references/dependency-bundle/deps/istextorbinary.md
- `iconv-lite` — docs/references/dependency-bundle/deps/iconv-lite.md
- `chardet` — docs/references/dependency-bundle/deps/chardet.md
- `pino` — docs/references/dependency-bundle/deps/pino.md
- `prom-client` — docs/references/dependency-bundle/deps/prom-client.md
- `hdr-histogram-js` — docs/references/dependency-bundle/deps/hdr-histogram-js.md
- `tinybench` — docs/references/dependency-bundle/deps/tinybench.md
- `seedrandom` — docs/references/dependency-bundle/deps/seedrandom.md
- `@vscode/ripgrep` — docs/references/dependency-bundle/deps/vscode-ripgrep.md
- `onnxruntime-node` — docs/references/dependency-bundle/deps/onnxruntime-node.md
- `hnswlib-node` — docs/references/dependency-bundle/deps/hnswlib-node.md
- `lmdb` — docs/references/dependency-bundle/deps/lmdb.md
- `parse5` — docs/references/dependency-bundle/deps/parse5.md
- `chokidar` — docs/references/dependency-bundle/deps/chokidar.md
- `picomatch` — docs/references/dependency-bundle/deps/picomatch.md
- `@mdx-js/mdx` — docs/references/dependency-bundle/deps/mdx-js-mdx.md
- `dockerfile-ast` — docs/references/dependency-bundle/deps/dockerfile-ast.md
- `fast-xml-parser` — docs/references/dependency-bundle/deps/fast-xml-parser.md
- `graphql` — docs/references/dependency-bundle/deps/graphql.md
- `protobufjs` — docs/references/dependency-bundle/deps/protobufjs.md
- `@handlebars/parser` — docs/references/dependency-bundle/deps/handlebars-parser.md
- `nunjucks` — docs/references/dependency-bundle/deps/nunjucks.md
- `smol-toml` — docs/references/dependency-bundle/deps/smol-toml.md
- `jsonc-parser` — docs/references/dependency-bundle/deps/jsonc-parser.md
- `semver` — docs/references/dependency-bundle/deps/semver.md
- `execa` — docs/references/dependency-bundle/deps/execa.md
- `pino-pretty` — docs/references/dependency-bundle/deps/pino-pretty.md
