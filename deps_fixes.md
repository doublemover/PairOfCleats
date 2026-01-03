## 1) Best-of-breed dependencies to import (highest ROI first)

- **JSON-RPC (Content-Length framing) + request/response plumbing → `vscode-jsonrpc`**
  - **Use it for:** all LSP / JSON‑RPC transport (currently: `src/shared/jsonrpc.js` + framing usage inside `src/tooling/lsp/client.js`)
  - **Why it’s “best”:**
    - Handles the boring-but-fragile parts (framing, buffering, message boundaries, cancellations, error objects) that are easy to get subtly wrong.
    - It’s the de-facto reference implementation for Node-based LSP stacks.
  - **What you can delete/simplify:**
    - Replace most of `createFramedJsonRpcParser`/`writeFramedJsonRpc` with `vscode-jsonrpc` stream readers/writers.
  - **Notes / gotchas:**
    - You’ll still write the “what LSP messages to send” logic — this only removes the transport sharp edges.

- **LSP types / protocol shape helpers → `vscode-languageserver-protocol` (optional but very helpful)**
  - **Use it for:** typed request/notification names, params/results, symbol kinds, positions/ranges, etc.
  - **Why:** prevents drifting from spec + reduces hand-written protocol glue.

- **Concurrency limiting with backpressure → `p-queue`**
  - **Use it for:** replacing `src/shared/concurrency.js` (`runWithConcurrency`) anywhere you have:
    - file reading
    - chunking/tokenization
    - lint/complexity
    - embedding work dispatch
  - **Why it’s “best”:**
    - Real queue semantics: size/idle events, priorities, pause/resume, better control than “spawn N runners”.
    - Makes it easier to implement “IO concurrency ≠ CPU concurrency” (2 queues).
  - **Quick pattern:** one queue for disk IO (higher concurrency), one queue for CPU (lower concurrency).

- **Bounded caching (LRU + TTL + size-based eviction) → `lru-cache`**
  - **Use it for:** any Map-based caches (examples found: `complexityCache`, `lintCache` in `src/indexer/build/file-processor.js` and any similar ad-hoc Maps elsewhere).
  - **Why it’s “best”:**
    - Prevents silent memory growth when you index huge repos.
    - Lets you do “bytes-based” caps (e.g., cache at most 64MB of file text).

- **Fast directory crawling / file enumeration → `fdir`**
  - **Use it for:** replacing/accelerating `src/indexer/build/discover.js` (recursive `readdir` walking).
  - **Why it’s “best”:**
    - Extremely fast crawling compared to hand-rolled recursion.
    - Lets you do tight filtering during traversal to avoid extra stat calls.
  - **Rule of thumb:**
    - If you’re in a git repo and `git` is available, **`git ls-files` beats everything** for “which files are tracked”.
    - Use `fdir` as the best fallback for non-git folders / when you truly need “all files”.

- **JS import/export pre-scan without full parsing → `es-module-lexer` (+ `cjs-module-lexer` for CommonJS)**
  - **Use it for:** import graph building; avoids doing a full AST parse when you only need module edges.
  - **Where it helps:** anything in `src/indexer/build/imports.js` and the JS/TS language handlers where you only need `import`/`export`/`require()` signals.
  - **Why it’s “best”:**
    - Purpose-built for “extract import/export metadata fast”.
    - Lets you skip heavyweight parsing for most files.

- **One parser for JS + JSX + TS + TSX + Flow → `@babel/parser`**
  - **Use it for:** consolidating current dual-parser approach (`acorn` + `esprima`) and reducing per-language fragmentation (JS/TS/Flow).
  - **What it can replace:**
    - `src/lang/javascript.js` currently tries acorn then falls back to esprima; Babel can usually be one-shot with the right plugin list.
  - **Why it’s “best”:**
    - Broad syntax support (JSX, Flow, TS) in one library.
    - Cleaner error handling & fewer “parse twice” fallbacks.

- **Cross-platform file watching (instead of polling) → `chokidar`**
  - **Use it for:** replacing the polling loop in `src/indexer/build/watch.js` (stat-based scanning).
  - **Why it’s “best”:**
    - Proper FS event watching with ignore support + debouncing.
    - Large performance win in watch mode (especially on big repos).

- **Streaming JSON output (avoid giant `JSON.stringify` spikes) → `json-stream-stringify` (or `json-stream-es`)**
  - **Use it for:** `src/indexer/build/artifacts.js` where you currently write large artifacts via `JSON.stringify(...)`, e.g.:
    - `dense_vectors*_uint8.json`
    - `token_postings.json`, `phrase_ngrams.json`, `chargram_postings.json`
    - `minhash_signatures.json`
  - **Why it’s “best”:**
    - Lets you stream arrays/maps and keep peak memory low.
    - Avoids long single-thread stringify pauses (“stop-the-world” feeling).

- **Worker-thread pool for CPU-heavy tasks → `piscina`**
  - **Use it for:** CPU-bound steps that currently run on the main thread, such as:
    - tokenization + n-gram building
    - MinHash updates
    - expensive chunking / parsing (esp. if you add tree-sitter)
    - (possibly) embedding pre/post-processing
  - **Why it’s “best”:**
    - Well-known worker-pool abstraction with straightforward ergonomics.
  - **How to apply safely:**
    - Only offload pure functions (input → output). Avoid sharing mutable state.

- **Process execution ergonomics (optional) → `execa`**
  - **Use it for:** invoking `git`, LSP servers, external tooling, with better stdout/stderr capture and error handling than raw `child_process`.

---

## 2) Language-by-language tooling sanity check (are we using “the best” tools?)

> This section is about the languages PairOfCleats indexes (see `src/lang/*.js`) and the LSP tools already referenced in your tooling registry (`tools/tooling-utils.js`).

- **JavaScript**
  - **Current state:** custom chunking + parsing in `src/lang/javascript.js` using `acorn` with an `esprima` fallback.
  - **Best tools today:**
    - **Imports:** `es-module-lexer` (+ `cjs-module-lexer`) for fast graph extraction.
    - **AST when needed:** `@babel/parser` (JSX/Flow/TS coverage in one).
  - **Why change:** you’ll reduce “parse twice” fallbacks and unify JS/TS/Flow behavior.

- **TypeScript**
  - **Current state:** type tooling uses TypeScript compiler API opportunistically (`src/indexer/tooling/typescript-provider.js` loads `typescript` from the target repo when present).
  - **Best tools today:**
    - **Type inference:** TypeScript compiler API (what you’re doing) or `typescript-language-server` if you want full LSP semantics.
    - **Imports:** `es-module-lexer` for ESM, `cjs-module-lexer` for require graphs.
    - **Parser (only if you need ESTree):** `@typescript-eslint/typescript-estree`.
  - **Recommendation:** keep the compiler API approach for “best fidelity” and add a lexer pre-pass for speed.

- **Flow**
  - **Current state:** separate handler `src/lang/flow.js`.
  - **Best tools today:** `@babel/parser` with Flow plugins.
  - **Recommendation:** collapse Flow parsing into the same codepath as JS/TS if possible.

- **C / C++ / Objective-C**
  - **Current state:** chunking in `src/lang/clike.js`; LSP tool registry includes **clangd**.
  - **Best tools today:**
    - **LSP:** `clangd` ✅ (strong choice).
    - **Chunking:** consider Tree-sitter (`tree-sitter-c`, `tree-sitter-cpp`, `tree-sitter-objc`) if heuristics break in real-world macros.

- **Swift**
  - **Current state:** `src/lang/swift.js`; tooling registry includes **sourcekit-lsp**.
  - **Best tools today:**
    - **LSP:** `sourcekit-lsp` ✅ (strong choice).
    - **Chunking:** Tree-sitter (`tree-sitter-swift`) if you want consistent symbol boundaries outside LSP.

- **Go**
  - **Current state:** `src/lang/go.js`; tooling registry includes **gopls**.
  - **Best tools today:**
    - **LSP:** `gopls` ✅ (official Go server).
    - **Chunking:** Tree-sitter (`tree-sitter-go`) if you want accurate function/type block boundaries without regex.

- **Rust**
  - **Current state:** `src/lang/rust.js`; tooling registry includes **rust-analyzer**.
  - **Best tools today:**
    - **LSP:** `rust-analyzer` ✅
    - **Chunking:** Tree-sitter (`tree-sitter-rust`) if you need robust boundaries without invoking rust-analyzer.

- **Java**
  - **Current state:** `src/lang/java.js`; tooling registry includes **jdtls**.
  - **Best tools today:**
    - **LSP:** `jdtls` ✅
    - **Chunking:** Tree-sitter (`tree-sitter-java`) for reliable class/method extraction.

- **Kotlin**
  - **Current state:** `src/lang/kotlin.js`; tooling registry includes **kotlin-language-server**.
  - **Best tools today (realistically):**
    - **LSP:** `fwcd/kotlin-language-server` ✅ for “works today”
    - **Emerging option:** `Kotlin/kotlin-lsp` (official but currently labeled pre-alpha)
    - **Chunking:** Tree-sitter (`tree-sitter-kotlin`) if you need consistent syntax boundaries

- **C#**
  - **Current state:** `src/lang/csharp.js`; tooling registry includes **omnisharp**.
  - **Best tools today:**
    - **LSP choice is in flux:**
      - **OmniSharp** is still common, but many ecosystems are moving toward a Roslyn-based LSP (`Microsoft.CodeAnalysis.LanguageServer`).
    - **Chunking:** Tree-sitter (`tree-sitter-c-sharp`) if you want stable block boundaries.
  - **Recommendation:** keep OmniSharp as a fallback, but add an option to use Roslyn LSP when present.

- **Ruby**
  - **Current state:** `src/lang/ruby.js`; tooling registry includes **solargraph**.
  - **Best tools today:**
    - **Modern LSP:** **Ruby LSP** (Shopify) for modern Ruby tooling
    - **Legacy/compat:** Solargraph still useful, but Ruby LSP is trending as “state-of-the-art”.
  - **Recommendation:** support Ruby LSP first, Solargraph fallback.

- **PHP**
  - **Current state:** `src/lang/php.js`; tooling registry includes **phpactor**.
  - **Best tools today:**
    - **AST parsing:** `php-parser` (pure JS AST; great for indexing/import graph).
    - **LSP:** depends on constraints:
      - **Intelephense**: high-performance, widely used.
      - **Phpactor**: strong open-source choice.
  - **Recommendation:** keep Phpactor if you want OSS-only; add Intelephense integration as an opt-in.

- **Lua**
  - **Current state:** `src/lang/lua.js`; tooling registry includes **lua-language-server**.
  - **Best tools today:** LuaLS ✅

- **SQL**
  - **Current state:** `src/lang/sql.js`; tooling registry includes **sqls**.
  - **Best tools today:**
    - **LSP:** `sqls` is widely used, but the project itself notes instability.
    - **Parsing:** `node-sql-parser` can be valuable for extracting tables/columns (dialect-dependent).
  - **Recommendation:** treat SQL LSP as best-effort; keep robust fallback chunking.

- **Shell**
  - **Current state:** `src/lang/shell.js` (bash/zsh etc).
  - **Best tools today:**
    - **LSP:** `bash-language-server`
    - **Parsing:** Tree-sitter bash grammar if you need robust structure.

- **Perl**
  - **Current state:** `src/lang/perl.js`.
  - **Best tools today (practical):**
    - Perl tooling in Node-land is thin; either:
      - keep heuristic parsing, or
      - use Tree-sitter Perl if it’s “good enough” for your corpus.
    - Consider adding a Perl LSP only if your users really need it.

---

## 3) Cross-language “best tool” for chunking & symbol boundaries

- **Best general approach:** **Tree-sitter**
  - **Why it’s worth it:** one mental model + one API across most languages you index.
  - **Two implementation options:**
    - `tree-sitter` (native Node bindings; fastest but native build friction)
    - `web-tree-sitter` (WASM; easier installs, sometimes slower)
  - **How to adopt without rewriting everything:**
    - Start with “hard languages” where heuristics break most (Swift/Kotlin/C#/C++).
    - Keep existing heuristic chunkers as fallback.

---

## 4) Additional import opportunities (nice-to-haves)

- **CLI ergonomics**
  - If the CLI surface is growing, consider `yargs` or `commander` for consistent help output and subcommands.
- **Better “kill child process trees” (only if you really need it)**
  - `tree-kill` exists, but be aware of past Windows command-injection advisories; prefer the latest version and don’t pass user-controlled strings.

---

## 5) Existing dependency hygiene (things you can remove or consolidate)

- **Likely unused in this repo right now (based on string search):**
  - `minhash` (npm) — you already have `src/indexer/minhash.js` (`SimpleMinHash`)
  - `varint`
  - `seedrandom`
  - `yaml`
  - `strip-comments`
- **Redundant JS parsing stack:**
  - Consider consolidating:
    - `acorn` + `esprima` → `@babel/parser`
    - or keep `acorn` but add `acorn-jsx` and drop `esprima` if JSX is the only reason for fallback.

---


- **Bugs / correctness issues (high confidence)**
  - The build still keeps **all chunks in `state.chunks`**, then builds huge in-memory arrays and JSON strings when writing artifacts (`src/indexer/build/artifacts.js`). If “streaming” was intended as “don’t retain the entire index in memory,” that is **not** implemented.
  - **Unused / dead work in postings builder**
    - `src/indexer/build/postings.js` computes `posts` from `trimmedVocab` but never uses it (lines 60–66).
      - This is wasted CPU + allocations proportional to vocabulary size.
  - **Vocabulary trimming is effectively a no-op**
    - `src/indexer/build/postings.js` builds `trimmedVocab` from `df`, but:
      - there is **no `maxVocab` cap** anymore, and
      - `token_postings.json` is built from `tokenPostings.keys()` (full vocab), not from `trimmedVocab`.
    - If the intent was “cap postings size for speed/memory,” it is not happening.
  - **`dense_vectors_doc_uint8.json` and `dense_vectors_code_uint8.json` are produced but not used**
    - Written in `src/indexer/build/artifacts.js` (lines 74–81).
    - Loaded in `src/search/cli-index.js`, but never referenced anywhere else.
    - This costs build time + disk with no runtime benefit.
  - **Import scan runs for prose mode (wasted and can be large)**
    - `src/indexer/build/indexer.js` always calls `scanImports(...)` (lines 53–61) even when `mode === 'prose'`.
    - For prose, import scanning has no effect (language registry import collectors don’t apply), but it still reads & normalizes all prose files.
  - **Per-chunk relations clone file-level relations**
    - `src/indexer/language-registry.js` (lines 260–272) spreads `fileRelations` into every chunk’s `codeRelations`.
    - This duplicates potentially large arrays (`imports`, `exports`, `usages`, `importLinks`, `functionMeta`, `classMeta`, `flow`) across chunks.
    - It’s also semantically suspicious: chunk-level relations should ideally describe the chunk, not the entire file.
  - **Per-chunk `calls`/`callDetails` filtering is O(chunks × calls)**
    - `buildChunkRelations` filters `fileRelations.calls` and `callDetails` per chunk by scanning the entire arrays.
    - This can explode on large files with many calls.

- **Bugs / correctness issues (medium confidence / needs runtime confirmation)**
  - **Potential off-by-one in blame range for chunkers without line metadata**
    - `src/indexer/build/file-processor.js` falls back to:
      - `startLine = offsetToLine(lineIndex, c.start)`
      - `endLine = offsetToLine(lineIndex, c.end)`
    - If `c.end` is an *exclusive* offset (typical `slice(start,end)` convention), and it happens to land exactly at the start of the next line, `offsetToLine(..., c.end)` will return the next line, making blame ranges 1 line too long.
    - Many language chunkers provide explicit `meta.startLine/endLine` (JS/TS AST does), but YAML and heuristic chunkers may not.
  - **`scale: 1.0` in dense vector artifacts is misleading**
    - `dense_vectors_uint8.json` is quantized from [-1,1] into 256 bins; the effective step is about ~0.007843.
    - The `scale` field is not used by current file-based search, but it is incorrect metadata.
  - **ESLint API compatibility risk (depending on ESLint major version behavior)**
    - `src/indexer/analysis.js` uses `new ESLint({ useEslintrc: false })`.
    - If ESLint changes options semantics, lint could silently return `[]` (caught exception), leading to “lint present in index” being effectively disabled without warning.

- **Likely root causes of “indexing benchmark slower than it should be”**
  - **Git blame per chunk is extremely expensive**
    - `src/indexer/build/file-processor.js` calls `getGitMeta(..., { blame: gitBlameEnabled })` inside the chunk loop.
    - Even with caching for `git log` data, blame is executed **per chunk** (spawn `git blame -L ...`).
    - On repos with many chunks, this can dominate build time.
  - **ESLint instance creation per file is expensive**
    - `src/indexer/analysis.js` constructs a fresh `ESLint` object per file.
    - This is typically heavy due to parser/config initialization.
  - **Artifact writing is doing big “whole-object” JSON writes**
    - `src/indexer/build/artifacts.js` builds `chunkMeta` (a full copy of chunk objects) and `JSON.stringify(...)` for multiple huge files.
    - This is CPU + peak-memory heavy, and can become the bottleneck even after indexing is done.
  - **Debug artifacts are always written**
    - `.scannedfiles.json` and `.skippedfiles.json` are always written (artifacts.js lines 56–63).
    - For large repos these files can be huge and add seconds/minutes of extra work.
  - **Redundant / unused artifacts are written**
    - `dense_vectors_doc_uint8.json` and `dense_vectors_code_uint8.json` are written even though they are unused.
  - **Import scan reads files even when incremental cache would otherwise skip them**
    - Incremental caching avoids parsing unchanged files, but `scanImports` still reads every file up front.

- **Performance enhancements (quick wins / minimal code changes)**
  - **Skip import scan for prose mode**
    - In `src/indexer/build/indexer.js`, guard:
      - If `mode !== 'code'`, set `allImports = {}` and skip `scanImports` entirely.
    - Expected win: eliminates a full read pass over all prose files.
  - **Stop writing unused dense vector variants**
    - Remove or gate `dense_vectors_doc_uint8.json` and `dense_vectors_code_uint8.json` until they are actually used.
    - Expected win: less CPU, less disk IO, less JSON stringify time.
  - **Make debug output optional**
    - Gate `.scannedfiles.json` and `.skippedfiles.json` behind a `--debug` flag or env var.
    - Or: only write aggregate counts + top-N examples.
  - **Delete dead computations in `buildPostings`**
    - Remove `posts` creation.
    - Remove unused `trimmedVocab` logic if it’s not going to be used for pruning.
  - **Reuse ESLint instance**
    - Create one `ESLint` instance per build run (or per worker) and reuse in `lintChunk`.
    - Expected win: can be massive on JS-heavy repos.
  - **Make git blame opt-in (or auto-disable in benchmarks)**
    - Default `gitBlameEnabled` to false unless explicitly enabled.
    - Or: enable only when `--git-blame` is provided.
  - **Avoid per-chunk cloning of fileRelations**
    - In `buildChunkRelations`, only attach:
      - chunk-specific `calls`/`callDetails`
      - (maybe) a small set of file-level identifiers
    - Keep file-level relations in a separate “file meta” table.

- **Performance enhancements (bigger refactors that will move the needle)**
  - **Batch git blame once per file**
    - Run `git blame --line-porcelain -- <file>` once.
    - Build an array mapping `line -> author`.
    - For each chunk line range, compute unique authors via slice/set (or via prefix-count hashing).
    - This eliminates “spawn a git process per chunk”.
  - **Batch embeddings**
    - The transformer pipeline can often accept arrays of strings.
    - Embed chunks in batches per file or per N chunks:
      - reduces per-call overhead
      - enables better throughput in underlying runtime
    - Also consider computing only merged embedding, unless you truly need `embed_doc` and `embed_code` separately.
  - **Turn artifact writing into streaming output**
    - Replace `JSON.stringify(hugeArray)` with:
      - JSONL (one chunk per line), or
      - streaming JSON writer, or
      - binary formats (recommended for vectors/postings).
    - This lowers peak memory and can reduce wall-clock significantly.
  - **Normalize the data model (file-level vs chunk-level)**
    - Move repeated fields out of `chunk_meta.json`:
      - `complexity`, `lint`, `imports`, `exports`, `usages`, `importLinks`, `last_modified`, `last_author`, `churn`, etc.
    - Store them once per file in `file_meta.json` (or in SQLite only) and reference by file id in each chunk.
    - Expected win: much smaller indexes, faster writes/reads, less RAM pressure.
  - **Eliminate the full import pre-pass (or make it incremental)**
    - Option A (no prepass): during file processing, collect each file’s imports into a map; after processing all files, build reverse index for `allImports`.
    - Option B (incremental): store per-file imports in the incremental bundle and rebuild `allImports` from cached bundles without re-reading files.
  - **Parallelize CPU-heavy steps with worker threads**
    - Tokenization, chargram/ngram extraction, quantization, and even JSON serialization are CPU-bound and currently run on the main thread.
    - A worker-pool (e.g., `worker_threads`/Piscina) can improve throughput on multi-core machines.

- **“Pre-pass large scale gather” ideas (answering your specific question)**
  - **Yes — but target the right costs.** The best “pre-pass” isn’t just directory traversal; it’s batching/avoiding repeated expensive work.
  - **Pre-pass candidates that actually help**
    - **File inventory + stats in one pass**
      - While walking, gather `{path, ext, size, mtime}` and reuse it (don’t `stat` twice).
    - **Git metadata pre-pass**
      - One pass to get last-modified commit/author per file (can be done with fewer git invocations).
      - One blame pass per file (porcelain) to allow fast per-chunk author extraction.
    - **Import graph pre-pass that is incremental-aware**
      - If using incremental bundles: build `allImports` from cached import lists, only parse changed files.
    - **Embedding batch pre-pass**
      - Collect chunk texts per file, then embed as a batch.
  - **Pre-pass candidates that help less than they seem**
    - “Warm the OS cache by reading everything once” helps a bit, but it won’t fix per-chunk git blame or ESLint instantiation.

- **Benchmark-focused knobs you can use immediately (no code changes)**
  - Disable the biggest multipliers first:
    - Set `indexing.gitBlame=false` in `.pairofcleats.json` (or add a CLI flag if you add one).
    - Disable lint/complexity capture if the benchmark is meant to measure indexing core only.
    - Consider `--stub-embeddings` for speed benchmarking that excludes model inference.
  - Reduce index feature work if you just need a functional benchmark:
    - Turn off chargrams / phrase ngrams in postings config.
    - Turn off cross-file inference (typeInferenceCrossFile / riskAnalysisCrossFile).

- **Additional low-level micro-optimizations (nice-to-have)**
  - Replace per-chunk `preContext`/`postContext` building via `slice(...).split('\n')` with a cached per-file `lines[]` array.
  - Deduplicate import lists in `scanImports` (avoid repeated pushes when the same module is imported multiple times per file).
  - Bound `gitMetaCache` size (LRU) to avoid leaks in long-running processes.
  - In `tools/tooling-utils.js`, avoid storing `lowerNames` for every file — track only the filenames you care about (Dockerfile, Makefile, workflows).


- **High-confidence bugs / spec mismatches (not just “could be faster”)**
  - **Prose indexing still runs the import-scan pre-pass (wasted full read of all prose files)**
    - Where: `src/indexer/build/indexer.js` lines ~53–61.
    - Why it’s wrong: imports are only used by code relations; prose mode sets `fileRelations = null`, so the resulting `allImports` map is unused.
    - Impact:
      - Extra full-file reads for every prose file.
      - Extra time even when `--incremental` is enabled (because import scan reads files regardless of the incremental bundle cache).
    - Fix: only call `scanImports()` when `mode === 'code'` (or when a language option actually uses it).

  - **`buildPostings()` computes a `posts` array that is never used**
    - Where: `src/indexer/build/postings.js` lines ~60–66.
    - Impact: wasted CPU + memory proportional to vocab size.
    - Fix: delete the `posts` computation (and ideally delete the entire unused “trimmed vocab” branch if it’s not used anywhere).

  - **The “max vocab” logic is effectively dead code (and may cause runaway token index sizes)**
    - Where: `src/indexer/build/postings.js`:
      - It computes `trimmedVocab` from `df`, but it does not apply any pruning to `tokenVocab` / `tokenPostingsList`.
    - Impact:
      - Your token postings can grow without bound with repo size.
      - Index build time + disk size can balloon, independent of the “trimmedVocab” concept.
    - Fix options:
      - Either *actually prune* `tokenVocab/tokenPostingsList` to the top‑K vocab (plus query-time fallbacks),
      - Or remove “trimmedVocab” entirely and stop pretending there’s a vocab cap.

  - **Doc/code dense vectors are generated and written but appear unused by search**
    - Where:
      - Written: `src/indexer/build/artifacts.js` lines ~74–81.
      - Generated: `src/indexer/build/postings.js` lines ~72–75.
      - Loaded: `src/search/cli-index.js` loads `dense_vectors_doc_uint8.json` and `dense_vectors_code_uint8.json`.
      - Used: search rankers only reference `idx.denseVec` (not `denseVecDoc` / `denseVecCode`).
    - Impact:
      - Extra quantization work and **3x vector file writes**.
      - Extra disk IO and JSON serialization time.
    - Fix: either
      - wire `denseVecDoc/denseVecCode` into ranking (e.g., query intent chooses which vector set), OR
      - stop generating/writing/loading them.

  - **Dense vector “scale” metadata is misleading**
    - Where: `src/indexer/build/artifacts.js` writes `scale: 1.0`.
    - Reality: with `minVal=-1`, `maxVal=1`, `levels=256`, the dequantization scale is ~`2/255`.
    - Impact: not currently used by the JS ranker (which recomputes scale), but confusing and easy to misuse.
    - Fix: write correct metadata or remove the field.

- **Likely correctness issues / footguns (need runtime confirmation, but code smells are real)**
  - **Possible off-by-one line range for git blame when chunk meta lacks `endLine`**
    - Where: `src/indexer/build/file-processor.js` computes `endLine = offsetToLine(lineIndex, c.end)`.
    - Why it’s suspicious: chunk `end` is used as a JS slice end (exclusive), but `git blame -L start,end` is inclusive.
    - When it bites: chunkers that don’t populate `meta.startLine/meta.endLine` (e.g., YAML heuristic chunks, fallback chunks).
    - Expected fix: for exclusive `end`, use `offsetToLine(lineIndex, Math.max(0, c.end - 1))` (with care for empty chunks).

  - **Import link semantics are unclear (and may be backwards)**
    - Where: `src/indexer/build/imports.js` builds `allImports` as `moduleSpecifier -> [filesThatImportIt]`.
    - Many “import link” use-cases want the reverse: `file -> imports` or `module -> resolved target file`.
    - If “importLinks” are meant to connect *to the imported module*, this won’t do that.
    - At minimum: document what `importLinks` are supposed to mean and validate with tests.

  - **ESLint API compatibility risk**
    - Where: `src/indexer/analysis.js` uses `new ESLint({ useEslintrc: false })`.
    - ESLint has changed config systems across major versions; if this option stops working, linting silently becomes “always empty” (because errors are swallowed).
    - Fix: pin ESLint API usage or fail loudly when linting is enabled but cannot initialize.

- **Major performance offenders (these are the things that will dominate indexing time)**
  - **Git blame per chunk (worst-case: thousands of `git blame` processes)**
    - Where: `src/indexer/build/file-processor.js` calls `getGitMeta(..., { blame: true })` inside the chunk loop.
    - Why it’s slow:
      - `simple-git` shells out to `git`.
      - `git blame -L ...` per chunk is *process spawn heavy* and does a lot of work repeatedly.
    - Why a pre-pass helps: you can do **one blame per file** (porcelain/incremental) and derive chunk authors by line range.

  - **ESLint instantiated per file + lint results duplicated into every chunk**
    - Where:
      - Instantiation: `src/indexer/analysis.js` line ~29 (new ESLint per call).
      - Duplication: `src/indexer/build/file-processor.js` writes the same `lint` array into each chunk payload.
    - This is a double hit:
      - high CPU/time cost to lint,
      - inflated `chunk_meta.json` size and slower JSON serialization.

  - **File-level relations copied into every chunk (`buildChunkRelations`)**
    - Where: `src/indexer/language-registry.js` lines ~260–272.
    - What happens:
      - `output = { ...fileRelations }` copies a big object per chunk.
      - It then filters `calls` and `callDetails` by scanning the full arrays for each chunk (O(chunks × calls)).
    - Impact:
      - CPU blowups on large files with many functions.
      - Massive index bloat because imports/usages/functionMeta/etc repeat per chunk.

  - **Artifact writing is “JSON stringify everything at once”**
    - Where: `src/indexer/build/artifacts.js`:
      - builds `chunkMeta = state.chunks.map(...)` then `JSON.stringify(chunkMeta)`
      - stringifies giant vectors and postings arrays
      - always writes `.scannedfiles.json` and `.skippedfiles.json`
    - Impact:
      - big spike in peak RAM
      - long single-threaded serialization time
      - large disk writes

  - **Import scanning is a full second read pass over all code files**
    - Where: `src/indexer/build/imports.js`.
    - Impact:
      - Even with incremental bundles, you still read every file to discover imports.
      - You do work you already did during AST parsing for relations (for languages that parse AST).

- **Answer to your question: “Is there a pre-pass large scale gather to speed index building?”**
  - Yes — and you already *kind of* have one (file discovery + import scan). The problem is that the current pre-passes don’t eliminate the biggest repeated work.
  - The high-leverage “pre-pass” ideas that actually move the needle:
    - **Repo file inventory in one shot**
      - Use `git ls-files -z` when the repo is a git checkout, instead of walking directories twice (code + prose).
      - You’ll get:
        - fewer syscalls,
        - fewer ignore checks,
        - deterministic file ordering.
    - **Git metadata pre-pass (batched)**
      - Do one `git log --name-only` (or a structured variant) to map `file -> last_author/last_modified` without per-file git calls.
      - Do one `git blame --line-porcelain` per file and build a `line -> author` array, then compute chunk authors by range.
    - **Imports/relations pre-pass that is cacheable**
      - Store “imports extracted for this file” inside the incremental bundle.
      - On incremental rebuild, only recompute imports for changed files, and merge them to rebuild `allImports`.
    - **Embedding batching pre-pass**
      - Collect N chunk texts and call the embedding model once with an array of strings (batch) instead of one call per chunk.
      - This reduces overhead from model invocation and can be much faster on CPU.

- **Performance enhancements (ordered: fastest wins first)**
  - **Disable or defer the expensive stuff when running the *indexing benchmark***
    - If the benchmark is meant to measure the indexer’s “core pipeline,” you should be able to turn off:
      - `gitBlameEnabled` (set `indexing.gitBlame=false` in `.pairofcleats.json` or a bench config)
      - ESLint linting (add config gate; see below)
      - `riskAnalysis*` and `typeInference*` cross-file passes
      - chargrams (they are expensive to generate and store)
    - Right now there isn’t a clean “benchmark profile.” Add one.

  - **Skip `scanImports()` for modes that don’t use it**
    - Implement immediately. It’s a pure waste for prose.

  - **Make `.scannedfiles.json` / `.skippedfiles.json` opt-in**
    - They’re useful debug artifacts, but they’re not “index” artifacts.
    - Gate behind `--debug` or env var.

  - **Stop generating unused dense vector variants**
    - If `dense_vectors_doc_uint8.json` / `dense_vectors_code_uint8.json` are not used for ranking, don’t write them.
    - This is a very direct speedup (quantization + 2 extra giant JSON files eliminated).

  - **Stop duplicating file-level metadata into every chunk**
    - Split metadata into:
      - **file_meta.json**: one record per file (imports, churn, lint, complexity, etc)
      - **chunk_meta.json**: only chunk-specific info + a fileId pointer
    - Even if you don’t change your on-disk format, you can at least avoid copying `fileRelations` into every chunk object.

  - **Fix `buildChunkRelations` to avoid O(chunks × calls) scans**
    - Pre-index calls by caller name once per file: `Map<caller, calls[]>`.
    - Same for `callDetails`.

  - **Reuse ESLint instances**
    - Create one `ESLint` object per process (or per worker), not per file.
    - Optionally reuse results per incremental cached file.

  - **Replace per-chunk git blame calls with a per-file blame map**
    - One blame invocation per file.
    - Compute chunk authors via line ranges.

  - **Streaming / binary artifacts**
    - Replace JSON arrays of huge numeric arrays with one of:
      - JSONL (one chunk per line) for `chunk_meta`
      - binary (Uint8Array/Float32Array) for vectors
      - varint/delta encoding for postings
      - zstd/gzip compression
    - This can easily become the dominant speedup on large repos.

  - **Incremental import graph**
    - Persist per-file imports in incremental bundles.
    - Rebuild `allImports` without rereading all files.

  - **Move CPU-heavy steps to worker threads**
    - Tokenization, ngram generation, MinHash, and quantization are all synchronous loops in the main thread.
    - Worker threads (or a pool like Piscina) can give real parallelism.

  - **Reduce duplication in chunk context generation**
    - `preContext`/`postContext` repeatedly slice+split strings for each chunk.
    - Precompute `lines = text.split('\n')` once per file, then derive contexts by line indices.

  - **Dedupe `allImports` file lists**
    - `scanImports` pushes file paths per import occurrence; if an import appears multiple times in a file, you may get duplicates.
    - Convert per-module file lists to sets (or check last push) to cut memory.

  - **Stop recording every skipped directory/file as a JSON entry**
    - For big repos with many ignored files, `.skippedfiles.json` can dominate.
    - Record counts per reason + sample N paths, not the full list.

- **Extra: Why the benchmark likely “feels slower than it should”**
  - If you’re running with defaults:
    - `git blame` per chunk + ESLint per file are “death by a thousand subprocesses / expensive initializations.”
    - artifact writing is a huge single-threaded JSON serialization step.
    - doc/code vector variants and debug files add extra IO.
  - If you want the benchmark to reflect realistic usage, you’ll want a clear profile split:
    - “Core index build” (chunking + postings + vectors)
    - “Enrichment passes” (git blame, lint, risk correlation, cross-file tooling)
    - “Artifact persistence” (write format + compression)

- **Additional scalability / performance issues worth fixing (not all are Phase 67 items, but they affect indexing time)**
  - **Repo is walked separately for code and prose builds**
    - Where: `build_index.js` runs `buildIndexForMode` twice, and each call runs `discoverFiles()`.
    - Impact: two full directory traversals + ignore checks.
    - Fix: do a single traversal that returns `{ codeFiles, proseFiles }`, or at least reuse the directory walk results.

  - **`discoverFiles()` stats each file (oversize check) and `processFile()` stats it again**
    - Where:
      - `src/indexer/build/discover.js` does `await fs.stat(abs)`.
      - `src/indexer/build/file-processor.js` does `await fs.stat(absPath)` again.
    - Impact: double `stat()` syscalls on every file.
    - Fix: have discovery return `{ abs, rel, stat }` objects, or keep a `Map<abs, stat>`.

  - **Import scan normalizes entire file text (`text.normalize('NFKD')`) even though it only needs to match imports**
    - Where: `src/indexer/build/imports.js`.
    - Impact: forces a full string copy + extra CPU on every file.
    - Fix: only normalize extracted tokens, or skip normalization for import regexes.

  - **Incremental mode still performs a full import scan over *all* files**
    - Root cause: import scan does not consult incremental bundles.
    - Impact: “incremental” builds stay IO-bound on large repos.
    - Fix: persist per-file imports in incremental bundles and rebuild `allImports` from the manifest.

  - **JSON is used as the storage format for very large numeric arrays**
    - Vectors: `dense_vectors_uint8.json` (and doc/code variants)
    - Postings: `token_postings.json`, `phrase_ngrams.json`, `chargram_postings.json`
    - Impact:
      - Serialization/deserialization overhead is huge.
      - File size is huge.
      - Node spends a lot of time in GC.
    - Fix: move to binary (or SQLite) for postings/vectors.

  - **Index includes per-chunk `tokens` arrays even though postings already encode term presence**
    - Where: `chunk_meta.json` stores `tokens`, `ngrams`, plus other metadata.
    - Impact: `chunk_meta.json` size can explode, and writing it becomes slower than the indexing itself.
    - Fix: keep tokens only when needed for snippets/highlighting, or store a compact representation.

  - **More duplication: file path stored multiple times in different artifacts**
    - `chunk_meta.json` repeats the file path per chunk.
    - `.scannedfiles.json` repeats absolute paths.
    - `.skippedfiles.json` repeats absolute paths.
    - Impact: disk bloat + slower IO.
    - Fix: normalize around file IDs and store file path once.

  - **Potential hot loop: per-chunk context slicing**
    - Where: `src/indexer/build/file-processor.js` builds `preContext` / `postContext` via slicing and splitting strings.
    - Fix: pre-split file lines once and index by line number.

  - **Unbounded caches still exist**
    - `gitMetaCache` in `src/indexer/git.js` grows per repo root and file.
    - Fix: add an LRU cap or clear per build.

  - **Token postings data structure is heavy**
    - `Map<string, Array<[docId, tf]>>` is convenient but memory-expensive.
    - Fix: for large corpora, build postings in sorted order and compress.