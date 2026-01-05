# PairOfCleats — Development Decisions & Next Steps

This document is meant to drive *high-leverage engineering decisions*:
- which approaches should be “mainline”
- what to add to maximize retrieval quality and scalability
- how to make performance evaluation trustworthy
- how to simplify the system into a more graspable product

---

## 3) Pick the best approach (and what to keep / deprecate)

This section resolves the major “forks” in the codebase into a clear default posture.

### 3.1 Storage backend: memory artifacts vs SQLite

**Options currently present**
- **Memory backend**: JSON artifacts loaded into memory
- **SQLite backend**: postings/metadata in tables, optional FTS and ANN

**Best default**
- **Backend = `auto`**
  - If repo is “small/medium”: memory backend is simplest and fastest for one-off CLI use.
  - If repo is “large”: SQLite is the correct default to avoid memory blowups and `ERR_STRING_TOO_LONG`.

**Why**
- JSON arrays become fragile at repo scale (single-string parse limits, RAM spikes).
- SQLite provides stable scaling, incremental querying, and better cold-start behavior.

**Decision**
- Keep **both**, but make “auto” the UX default.
- Consider “SQLite for large repos” as a first-class recommendation in docs and CLI help.

**Implementation detail**
- Codify the policy in one place (e.g. `src/storage/backend-policy.js`):
  - input: chunkCount, artifact sizes, “force backend”, sqlite availability
  - output: backend choice + rationale for `--explain`

---

### 3.2 Sparse ranking: custom BM25 vs SQLite FTS5

**Options**
- **Custom BM25 over postings** (reference)
- **SQLite FTS5** (fast, but scoring differs)

**Best approach**
- **Keep BM25 as the reference ranker** and the “quality baseline.”
- Keep FTS5 as:
  - candidate generation (fast first pass)
  - or an alternate mode explicitly labeled “fast but different scoring”

**Why**
- You already have custom boosts + query parsing + tokenization choices that BM25 aligns with.
- FTS5 ranking is great for text search, but aligning it with your specialized code token streams can be fiddly.

**What to keep**
- BM25: mainline
- FTS5: optional accelerator

**Key enhancement**
- You compute tuned BM25 parameters (k1/b) during indexing; ensure search uses these by default:
  - store them in `token_postings.json` metadata
  - default to those if CLI does not override

---

### 3.3 Dense retrieval: sqlite-vec ANN vs JS scan vs MinHash

**Options**
- **sqlite-vec ANN**: scalable
- **JS dense scan**: portable fallback
- **MinHash**: model-free approximate similarity

**Best approach**
1) **sqlite-vec ANN** for large repos and sustained server usage  
2) **JS dense scan** fallback (works everywhere)  
3) **MinHash** fallback (embeddings disabled/unavailable)

**Why**
- ANN is the only scalable semantic retrieval option.
- Dense scan is acceptable for smaller repos.
- MinHash is valuable as an “always works” baseline, but not competitive with embeddings on semantic matching.

**Quality guardrail**
- Ensure dense retrieval path behaves consistently:
  - If candidate-limited dense scoring returns nothing, retry broadened candidates or full scan (mirroring current sqlite-vec retry logic).

---

### 3.4 Which embedding vector to use: merged vs doc vs code vs auto

**Options**
- code embeddings
- doc embeddings
- merged embeddings
- auto selection

**Best default**
- **AUTO**: select vector based on query shape and search mode.

**Why**
- Code-ish queries often work best with code vectors.
- Prose queries often work best with doc vectors.
- Merged is a compromise that can underperform in both extremes.

**Action**
- Make `--dense auto` the documented default.
- Add an `--explain` section describing which vector was used and why.

---

### 3.5 Parsing/chunking: AST > tree-sitter > heuristics hierarchy

**Best approach**
Keep the existing hierarchy:

1) Prefer language-native AST parsers when stable and available.
2) Else tree-sitter.
3) Else heuristic chunking.

**Why**
- AST parsers tend to yield the best boundaries and metadata.
- Tree-sitter provides broad language coverage.
- Heuristics keep things functional for everything else.

**Important improvement**
- For TypeScript: attempt to load `typescript` from the *target repo* `node_modules` (not just PairOfCleats dependencies).
  - This improves “best available parser” without forcing TypeScript as a hard dependency.

---

### 3.6 Tokenization: dictionary segmentation modes

**Options**
- greedy
- DP
- auto

**Best default**
- **auto** (DP with max length guard, else greedy)

**Why**
- DP improves segmentation quality for medium tokens but can be expensive on very long tokens.
- Auto gives the best trade-off.

**Enhancement**
- Make the DP max length adaptive to repo size (larger repos → more conservative DP).

---

### 3.7 Phrase ngrams + chargrams postings

**Best approach**
- Keep both, but add guardrails:
  - cap chargrams for very long tokens
  - optionally restrict chargrams to “high-value fields” (names/signatures) rather than whole bodies

**Why**
- chargrams significantly improve usability on typos/partials/paths/identifiers
- but can dominate index size if unbounded

---

### 3.8 Advanced analysis: flow, risk correlation, lint/complexity, inference

**Best approach**
- Keep these capabilities, but **do not make them default for first-time users**.
- Introduce **profiles**:
  - `lite`: fast, minimal
  - `balanced`: hybrid retrieval + relations (recommended default)
  - `full`: everything

**Why**
- Advanced analysis is valuable but increases build time and conceptual complexity.
- Profiles let you keep the power without overwhelming users.

---

## 4) What else it should do (features to maximize intent)

The intent is “better context retrieval for agents in large repos.” The improvements below are selected because they deliver the most practical benefit per engineering effort.

### 4.1 Replace score blending with Reciprocal Rank Fusion (RRF)

**Problem**
Score normalization-based blending is fragile and can be dominated by outliers.

**Solution**
Use **RRF**, which combines ranked lists instead of raw scores.

**Implementation**
- After BM25 and ANN generate ranked lists, compute:
  - `rrfScore += 1 / (k + rank)`
- Sort by RRF score.

**Pseudocode**
```js
function rrfMerge(lists, k = 60) {
  const score = new Map();
  for (const hits of lists) {
    hits.forEach((h, i) => {
      const r = i + 1;
      score.set(h.idx, (score.get(h.idx) || 0) + 1 / (k + r));
    });
  }
  return [...score.entries()]
    .map(([idx, s]) => ({ idx, score: s, scoreType: 'rrf' }))
    .sort((a, b) => b.score - a.score);
}
```

**Why**
RRF is robust and often improves perceived relevance without tuning.

**References**
- https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf
- https://en.wikipedia.org/wiki/Reciprocal_rank_fusion

---

### 4.2 Fielded indexing (name/signature/doc/body token streams)

**Problem**
A token match in a huge chunk body can drown out the more meaningful match in a symbol name or signature.

**Solution**
Index fields separately:
- `nameTokens`
- `signatureTokens`
- `docTokens`
- `bodyTokens`

**Sparse scoring**
Compute BM25 per field and combine with weights:
- name: 3.0
- signature: 2.0
- doc: 1.5
- body: 1.0

**Implementation details**
- Extend chunk meta to store normalized field text.
- Build separate postings for each field (or store field tags per token occurrence).
- Add CLI flags:
  - `--field-weights name=3,sig=2,doc=1.5,body=1`

**SQLite implementation**
- FTS5 supports multiple columns. Use `bm25()` with weights.

**Why**
This is a classic and very effective improvement in code search relevance.

**References**
- https://sqlite.org/fts5.html
- https://en.wikipedia.org/wiki/Okapi_BM25

---

### 4.3 Query intent classification (code-ish vs prose-ish vs path-ish)

**Problem**
The best retrieval settings differ by query shape.

**Solution**
Add a cheap heuristic classifier:
- code-ish if query contains operators (`=>`, `{}`, `::`), identifiers, or language tokens
- path-ish if it contains `/`, `\`, `.ext`
- prose-ish if it’s mostly words and longer

**Use it to choose**
- default mode (`code` vs `prose` vs `both`)
- dense vector selection (`code` vs `doc`)
- field weights (boost names/signatures for code-ish)
- candidate generation (chargrams stronger for path-ish)

**Implementation**
- Add `classifyQuery(query)` in `src/search/query-intent.js`
- Print classification in `--explain`

---

### 4.4 Graph-aware context expansion (“context packs”)

**Problem**
One chunk is often insufficient for agents. The agent needs “supporting definitions.”

**Solution**
After you choose top results, expand with a small neighborhood:
- definitions of called functions
- imported symbol definitions
- parent class/interface declarations
- adjacent chunks in the same file (already supported by context lines)

**Implementation**
- Use relations you already extract:
  - `codeRelations.calls`
  - imports/exports (file relations)
  - repo map symbol → chunk index

**Behavior**
- Return:
  - “primary hits” (ranked)
  - plus “context hits” labeled as such (lower weight)

**Example**
If top hit is `auth/jwt.ts:verifyToken`, context expansion adds:
- `auth/jwt.ts:decodeHeader`
- `auth/keys.ts:getJwks`
- `config/auth.ts` constants

---

### 4.5 Structural search integration (semgrep/ast-grep/comby) as index metadata

**Problem**
Structural search exists but is not part of the main retrieval flow.

**Solution**
Integrate structural matches into the index:
- run packs during indexing (optional)
- attach results to chunk meta by line ranges
- expose filters:
  - `--struct-pack security`
  - `--struct-rule X`
  - `--struct-tag injection`

**Implementation**
- Refactor `tools/structural-search.js` into importable module
- Produce JSONL of matches
- Map matches to chunk IDs by overlap
- Store in `chunk.docmeta.structMatches` (or `risk.structuralMatches`)

**References**
- https://semgrep.dev/docs/
- https://ast-grep.github.io/
- https://comby.dev/

---

### 4.6 Build-time filter index artifact (avoid recomputing per search)

**Problem**
Search startup rebuilds a path/chargram filter index for file filtering.

**Solution**
Build and store `filter_index.json` (or JSONL) during indexing.

**Benefit**
- faster cold start
- reduces repeated CPU work
- helps API/MCP servers

---

### 4.7 In-process API/MCP server (stop spawning per request)

**Problem**
Spawning a Node process per query adds latency and overhead.

**Solution**
Expose a library API:
- `buildIndex()`
- `search()`

Then API server loads index once and queries in-process.

**Implementation**
- Refactor CLI wrappers to call the library.
- The server keeps:
  - open SQLite connection
  - loaded postings or mmap’d files
  - embedding model warmed up

---

### 4.8 Large-artifact strategy: JSONL/sharding or “SQLite-first” for huge repos

**Problem**
Mega JSON arrays are fragile and expensive to load/parse.

**Solution options**
1) For large repos, write `chunk_meta.jsonl` and stream parse.
2) For large repos, skip giant JSON artifacts and make SQLite the canonical store.

**Recommendation**
- Start with JSONL for portability + stream parsing.
- Add “SQLite-first” path for truly large repos where JSON is not worth it.

---

### 4.9 Profiles as a first-class UX feature

**Problem**
Too many knobs. New users don’t know what matters.

**Solution**
Introduce `profile` that controls:
- analysis depth
- indexing time vs richness
- default search strategy

**Profiles**
- `lite`: chunking + basic metadata + lexical search
- `balanced`: adds relations + embeddings + hybrid
- `full`: adds flow/risk/lint/complexity/inference/structural

**Implementation**
- Implement a config “preset merge” step.
- Make `--profile balanced` default.

---

## 5) Performance testing: what to improve and how to measure accurately

### 5.1 Current strengths to keep
- End-to-end script coverage tests ensure the toolchain runs.
- Parity tests catch backend divergence.
- Benchmark scaffolding exists (repo lists, scripts).

### 5.2 Main limitations
1) **Benchmarks aren’t statistically robust**
   - single-run timings are noisy
2) **Quality evaluation isn’t first-class**
   - parity != relevance
3) **Benchmarks blend concerns**
   - I/O + parsing + GC + ranking all mixed

### 5.3 Proposed testing strategy

#### A) Microbenchmarks (fast, isolated)
Measure and regress:
- tokenization (splitId, segmentation)
- chargram/phrase generation
- postings build
- BM25 scoring loop
- dense dot products and quantization
- tree-sitter parse throughput per language

**Implementation**
- Add `tools/bench/micro/`
- Use Node’s `perf_hooks` + repeated iterations.
- Report:
  - mean
  - p50/p95
  - standard deviation
  - warm/cold variants if applicable

#### B) Component benchmarks (realistic but decomposed)
- Index build without embeddings
- Index build with embeddings
- Search: sparse only (BM25)
- Search: dense only (ANN/scan)
- Search: hybrid (merged)

**Key requirement**
- Always run each benchmark multiple times and report p50/p95.

#### C) End-to-end benchmarks (what users feel)
Keep current approach, but standardize:
- cold run (no cache)
- warm run (cache warmed, model warmed)

**Metrics to record**
- total time
- peak RSS memory
- artifact sizes
- number of chunks, tokens, postings
- queries/sec for API mode

---

### 5.4 Add true IR quality metrics (high leverage)

Parity tests ensure consistency; they don’t measure usefulness.

**Add labeled evaluation**
For each evaluation repo:
- a set of queries
- list of relevant chunks/files (labels)

**Compute**
- Recall@k
- MRR (mean reciprocal rank)
- nDCG@k

**How to get labels cheaply**
- Start “silver labels”:
  - grep exact identifier → file
  - relevant chunk = chunk containing identifier definition/use
- Upgrade a smaller subset to “gold labels” by hand.

**Implementation**
- `tools/eval/run.js`:
  - loads index (or builds)
  - runs queries
  - computes metrics
  - writes report JSON
- CI gate:
  - fail if recall@10 drops below threshold on gold set

---

### 5.5 Regression gates (make CI protect quality + performance)

Add CI thresholds for:
- build time regression (%)
- search p95 latency regression (%)
- artifact size growth (%)
- recall@k drop

This turns exploration into a maintainable system.

---

## 6) How to boil it down (reduce complexity without losing capability)

The goal is: someone can understand the system in 5 minutes and modify it safely.

### 6.1 Create a “core library API”
Expose these functions as the core product surface:

- `buildIndex(repoRoot, options)`
- `search(repoRoot, params)`
- `buildSqliteIndex(repoRoot, options)`
- `status(repoRoot)` (artifact presence, version, profile, stats)

Then make:
- CLI wrappers call these
- API server calls these
- MCP server calls these

This eliminates duplication and makes testing easier.

---

### 6.2 Unify tokenization modules
Currently tokenization logic is spread across:
- index tokenization
- query tokenization
- triage indexing

Refactor into `src/core/tokenize/`:
- `tokenizeChunk(chunk, mode, config)`
- `tokenizeQuery(query, mode, config)`
- `splitIdentifier()`
- `segmentWordsWithDict()`

**Benefit**
- fewer drift bugs
- easier to test microbench and correctness

---

### 6.3 Introduce profiles and hide advanced knobs
Most users should not see dozens of flags. Provide:

- `--profile lite|balanced|full`
- `--backend auto|memory|sqlite`
- `--ann on|off|auto`
- `--mode code|prose|both`

Everything else becomes “advanced config.”

---

### 6.4 Separate “production” vs “experimental” features
Move slower or unstable features into `src/experimental/`:
- cross-file type inference
- heavy risk correlation
- structural-search packs integration (until stable)

And require `profile=full` (or explicit flags) to enable them.

---

### 6.5 Make artifacts scale reliably
Pick one of:
- JSONL (stream parse) for large artifacts
- or “SQLite-first” storage for large repos

Avoid giant JSON arrays for chunk_meta and postings when repo size is large.

---

### 6.6 Standardize naming + responsibility boundaries
Suggested module boundaries:

- `src/index/` — chunking + metadata extraction + writing artifacts
- `src/retrieval/` — query parsing + candidate generation + ranking + merge
- `src/storage/` — file artifacts and sqlite interactions
- `src/integrations/` — CLI, HTTP, MCP
- `src/experimental/` — optional research features

This mirrors the mental model and reduces onboarding time.

---

## Recommended implementation order (most effective path)

This is ordered by “maximum user impact per unit effort” and “enables later work.”

1) **Introduce profiles (`lite` / `balanced` / `full`) + make `balanced` default**
   - Immediately reduces complexity and improves first-run experience.
   - Enables safe toggling of expensive analysis features.

2) **Refactor to a core library API (`buildIndex`, `search`)**
   - Removes duplication and unblocks in-process API/MCP.
   - Makes it easier to write real tests and benchmarks.

3) **Stop per-request process spawning: make API/MCP in-process**
   - Big latency win.
   - Makes PairOfCleats usable as a long-running local service.

4) **Implement RRF hybrid merging**
   - High relevance gain with minimal tuning.
   - Reduces brittle score normalization behavior.

5) **Add IR evaluation harness (Recall@k, MRR, nDCG) + CI regression gates**
   - Prevents quality regressions.
   - Guides future tuning objectively.

6) **Fielded indexing (name/signature/doc/body)**
   - Very high relevance improvement for symbol queries.
   - Makes metadata extraction pay off more.

7) **Large-artifact strategy: JSONL/sharding or SQLite-first**
   - Fixes scale pain permanently.
   - Enables larger repos without special casing.

8) **Query intent classification (code vs prose vs path)**
   - Improves defaults and reduces user knob-twiddling.

9) **Graph-aware context expansion (“context packs”)**
   - Makes results more agent-usable (multi-chunk context).
   - Leverages relations you already extract.

10) **Structural search integration into index metadata**
   - Powerful for security/triage workflows.
   - Slightly heavier engineering; best after profiles and evaluation harness exist.

11) **Microbench + component bench standardization (p50/p95, warm/cold)**
   - Useful for ongoing optimization once architecture is stable.
   - Best after core library refactor so benchmarks call stable entrypoints.
