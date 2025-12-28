# PairOfCleats 

*Give your Coding Agents a pair of cleats, so they can sprint through your codebase.*

## 🚀 What is PairOfCleats?

**PairOfCleats** _(pronounced 'Paraclete')_ is a utility that builds a hybrid semantic index of your Git repo. 

You run the build script "offline" on your local computer, which only takes a few minutes, then include the index in your agent image or repo.

Coding Agents then use the search utility, which allows them to query the index to get informative json blobs about code & docs. 

---

### 👟 Why PairOfCleats?

While using 3o, codex, and local models such as Devstral, I became frustrated with how many turns they seem to waste looking around with `git diff`, `find`, `grep`, `regex`, `nc` etc, commonly combining them with `tail` or `less` to 'brute force' their way through hundreds of lines of code in progressively smaller chunks while they fill their context window with garbage.

I figured it would be helpful if they were able to query the codebase and documentation as if they had the advanced searching features of a decent IDE and powerful text editor. Search can be filtered by function, class declaration, method signature, parameter, by function calls, module imports, lint issues, and more. 

<h3 align=center>👀 What does it look like?</h3>

<p align=center>
	<img src="https://i.imgur.com/CvoPk56.png" width="476" height="217">
	<br/>
	<i>This is the stylized, human readable output</i>
</p>

---

## ❓ Should I use it right now
- Probably not, I need to finish everything on the [roadmap](https://github.com/doublemover/PairOfCleats/blob/main/ROADMAP.md)

## 🔧 Requirements
- Node.js (v18+ recommended)
- A decently fast computer to build the search index with, or patience
  - Takes a 5800X3D ~3m10s to build the index for this [JS Lemmings Port](https://github.com/doublemover/LemmingsJS-MIDI) (~430 files) when using `MiniLM-L12-v2` for chunk embeddings
          - Index Size is ~15MB, can be tuned
  - Memory usage is currently low
  - Vague minspec target is a stock M2 Mini
  - Optional: SQLite backend (FTS5) to store full indexes for shared access; search uses the same renderer/scoring
  - Optional: Python 3 for AST-based metadata on `.py` files (falls back to heuristic chunking)


<details>
<summary><h2>⚙️ Index Features</h2></summary>

- Recursively scans your codebase
  - **Code**: `.js`, `.mjs`, `.cjs`, `.py`, `.swift`, `.rs`, `.c`, `.cc`, `.cpp`, `.h`, `.hpp`, `.m`, `.mm`, `.yml`, `.sh`, `.html`
  - **Prose**: `.md`, `.txt`
  - Skips irrelevant directories (`.git`, `node_modules`, `dist`, `coverage`, etc)
- Automatically determines ideal chunk size & dimension count separately for prose & code
- Configurable to prioritize offline generation time, index size, search speed, and accuracy
- Combines BM25 Search, embeddings, MinHash signatures, and rich code/documentation relations
- Smart Chunking
  - **Code**: Functions, Classes & Methods, Arrow Functions, Exports, Swift/Python/C/ObjC/Rust declarations
  - **Prose**: Headings (Markdown/RST), Sections (YAML)
- Feature Extraction (per chunk)
	- **Tokenization & Stemming**  
	- **N-grams & Char n-grams** → for phrase search  
	- **BM25 stats** → sparse postings (compressed varint)  
	- **Dense vector embedding** (MiniLM) → for ANN search  
	- **MinHash signatures** → fast approximate similarity  
	- **Code relations**: Calls graph, Imports & Exports, Identifier usages
	- **Git metadata**: Last author & modified date, Churn score, Per-chunk blame authors
	- **Complexity analysis** (cyclomatic complexity of JS functions)
	- **Lint results** (via ESLint)
	- **Docstrings / Signatures / Param annotations** (via doc comment extraction)
	- **Headline generation** → auto-summarized chunk label
	- **Neighbor context** → pre/post lines for agent context windowing
</details>

<details>
<summary><h2>🔍 Search Features</h2></summary>

`node .\search.js searchterm`

Provides a CLI utility for **agent-friendly semantic search** of your repo.

#### Search Pipeline:

**Tokenization of Query**
- Smart splitting of camelCase, snake_case, natural language.
- Optional splitting of long identifiers with dictionary.

**Main Search Techniques**
- **BM25 token / phrase match** (inverted index with term frequencies)
  - Headline boosting
  - N-gram matches
- **MinHash-based ANN search** (fallback)
  - Cross-file approximate similarity
- **Dense vectors** (optional, when ANN is enabled and embeddings are available)
- Combined + deduplicated result set.

**Advanced Filtering**
- `--type FunctionDeclaration` or `--type ClassDeclaration`
- `--author NAME`
- `--calls FUNC_NAME` → call graph filtering
- `--import MODULE`
- `--lint` → chunks with lint issues
- `--churn N` → high-churn code
- `--signature STR`, `--param PARAM`

**Rich Output**
- **Human-friendly mode** (with color-coded terminal output):
  - Headline, Calls graph, Imports & Exports, Identifier usages (with frequency)
  - Last author + churn score
  - Lint issues, External doc links
  - Pre/post context, Body summary
- **JSON mode**:
  - Machine-friendly output for agent toolchains.

**Metrics Tracking**
- Per-file hit frequency + terms → cache `repometrics/metrics.json`
- Search history → cache `repometrics/searchHistory`
- Failed queries → cache `repometrics/noResultQueries`
- These metrics can be consumed by the index builder to enhance results
- Github workflows included to automatically handle merging these files
- Optional persistent query cache via `search.queryCache`

</details>

<details>
<summary><h2>📚 Dictionaries</h2></summary>

PairOfCleats uses word lists to split identifiers into real words for better tokenization.

Download the default English dictionary (bootstrap does this automatically):

`npm run download-dicts -- --lang en`

Add custom dictionary sources:

`npm run download-dicts -- --url mylist=https://example.com/words.txt`

Update dictionaries (uses ETag/Last-Modified when available):

`npm run download-dicts -- --update`

Slang support:
- Drop `.txt` files into the dictionary cache `slang/` folder and they will be loaded automatically.

Repo-specific dictionary (opt-in):
- Generate: `npm run generate-repo-dict -- --min-count 3`
- Enable in `.pairofcleats.json`:
  ```json
  { "dictionary": { "enableRepoDictionary": true } }
  ```

Wordlists are used during index build to split identifiers into real words (improves tokenization for BM25 and n-grams).

Dictionary config example:
```json
{
  "dictionary": {
    "languages": ["en"],
    "includeSlang": true,
    "enableRepoDictionary": false
  }
}
```
</details>

<details>
<summary><h2>🧠 Model Cache</h2></summary>

PairOfCleats stores embedding models under `<cache>/models` by default.

Override via `.pairofcleats.json`:
```json
{ "models": { "id": "Xenova/all-MiniLM-L12-v2", "dir": "C:/cache/pairofcleats/models" } }
```

Or set `PAIROFCLEATS_MODELS_DIR` / `PAIROFCLEATS_MODEL`.

Optional compare list:
```json
{ "models": { "compare": ["Xenova/all-MiniLM-L12-v2", "Xenova/all-MiniLM-L6-v2"] } }
```

One-off model overrides:
- Build: `node build_index.js --model Xenova/all-MiniLM-L12-v2`
- Search: `node search.js --model Xenova/all-MiniLM-L12-v2` (used only if the index is missing model metadata)
</details>

<details>
<summary><h2>🗃️ SQLite Backend (FTS5)</h2></summary>

Build a shared SQLite index (split code/prose DBs):

`npm run build-sqlite-index`

Layout:
- `index-sqlite/index-code.db`
- `index-sqlite/index-prose.db`

Search (auto-uses SQLite when enabled):

`node .\\search.js "searchterm"`

Force a backend:

`node .\\search.js --backend sqlite "searchterm"`

`node .\\search.js --backend sqlite-fts "searchterm"`

`node .\\search.js --backend memory "searchterm"`

Notes:
- SQLite stores the full index artifacts (chunks + postings + n-grams + minhash + dense vectors).
- `search.js` reads those artifacts and uses the same renderer/scoring as the file-backed path.
- FTS5 is built into SQLite and can be used as a SQLite-only scoring path with `--backend sqlite-fts` (experimental; lower parity with BM25+ngrams).
- Optional: use a loadable SQLite vector extension for ANN (`sqlite.annMode = "extension"`). See `docs/sqlite-ann-extension.md`.
- Use `npm run download-extensions` or set `sqlite.vectorExtension.path` to point at the extension binary.
- Split DBs reduce lock contention and allow quicker prose-only rebuilds.
- Legacy `index.db` files are deleted during rebuild/cleanup.

You can also set defaults in `.pairofcleats.json` (enable `use` to make SQLite the default backend when available):
```json
{
  "sqlite": {
    "use": true,
    "dbDir": "C:/cache/pairofcleats/index-sqlite",
    "annMode": "js",
    "vectorExtension": {
      "provider": "sqlite-vec",
      "dir": "C:/cache/pairofcleats/extensions",
      "path": ""
    }
  },
  "search": {
    "annDefault": true,
    "sqliteFtsNormalize": false,
    "sqliteFtsProfile": "balanced",
    "sqliteFtsWeights": [0.2, 1.5, 0.6, 2.0, 1.0],
    "queryCache": {
      "enabled": false,
      "maxEntries": 200,
      "ttlMs": 0
    },
    "bm25": { "k1": 1.2, "b": 0.75 }
  },
  "indexing": {
    "concurrency": 4,
    "importConcurrency": 4
  }
}
```

Override paths with `codeDbPath`/`proseDbPath`.
Override extension paths with `PAIROFCLEATS_EXTENSIONS_DIR` or `PAIROFCLEATS_VECTOR_EXTENSION`.

ANN is enabled by default (configurable via `search.annDefault`). Use `--no-ann` to disable for a single search.
Set `sqlite.annMode` to `extension` to use a SQLite vector extension when available.
Set `search.sqliteFtsNormalize` to true to normalize FTS5 scores into a 0..1 range.
Tune FTS5 weighting with `search.sqliteFtsProfile` (`balanced`, `headline`, `name`) or custom `search.sqliteFtsWeights` (array of 5 weights for file/name/kind/headline/tokens).
To enable FTS5 scoring, set `sqlite.scoreMode` to `fts` (experimental; lower parity with BM25+ngrams).
</details>

<details>
<summary><h3>What Agents Gain</h3></summary>

- **Fast codebase navigation** → jump to functions/classes/types.
- **Semantic similarity** → find similar code by content and structure.
- **Cross-file graphing** → follow calls and imports across files.
- **Recency awareness** → bias toward recent / high-churn code.
- **Doc surfacing** → pull in relevant documentation and comments.
- **Speed** → agents commonly waste several 'turns' looking for what they need to work on, once instructed to utilize this, even one successful use per task massively speeds up how fast they complete their tasks
- **Clarity** → because you control which files are indexed, agents only find what you want them to, enhancing task accuracy and lowering confusion

</details>

<details open>
<summary><h4>🤔 How Do I Know They're Using It?</h4></summary>
	
- Logs of every query are added to a history file and committed with the rest of the agent's work
- Searches with no results are tracked separately so you know if the index needs to be updated or references need to be adjusted
- Detailed metrics of results are also included to help with manual or automated tuning of index generation
- The included github workflows, git hooks/configuration, and merge scripts automatically handle appending new entries 
</details>

<details>
<summary><h4>🤨 How Do I Know It's Helping?</h4></summary>
	
- That's for you to decide!
- I've only been using this for a few days, without taking the time to measure it:
	- Task completion speed is faster, both succesful tasks and 'failures' such as detecting that the task has already been completed
	- Failures happen less
- If you have experience with running automated benchmarks of coding agents please reach out
	- I'd like to quantify the impact and it would help me improve this
</details>

<details>
<summary><h4>🤢 Why did you write it all in js</h4></summary>
	
- Javascript seems pretty good now you should try it
- The searches typically take 80-120ms to complete, I have seen some queries run as long as 1-1500ms but have since changed the way that metadata is stored within chunks when the index is built and improved the way it is consumed in the search tool
- There is another branch where I am rewriting the search tool in rust
- I will eventually also rewrite the index generation to use rust
</details>

---

## 💻 Installation

- Clone the repo
- Quick start (bootstrap):
  - `npm run bootstrap`
  - Add `--incremental` to reuse the per-file cache (auto-enabled when present)
  - Add `--with-sqlite` to also build the SQLite index
  - With `sqlite.use: true`, `search.js` will use SQLite automatically when the DB exists (use `--backend memory` to force file-backed)
- Manual setup:
  - Install dependencies: `npm install`
  - (Optional) Download dictionaries: `npm run download-dicts -- --lang en`
  - (Optional) Download embedding model: `npm run download-models`
  - (Optional) Download SQLite ANN extensions (supports `.zip`, `.tar`, `.tar.gz`, `.tgz`): `npm run download-extensions -- --url vec0.dll=...`
  - (Optional) Verify extension install: `npm run verify-extensions` (use `--no-load` to skip load checks)
  - Configure which file types and folders to skip
  - (Optional) Configure `.pairofcleats.json` and `.pairofcleatsignore`
- Build the index: `node build_index.js` (add `--incremental` to reuse per-file cache)
  - (Optional) Build a shared SQLite index: `npm run build-sqlite-index` (use `-- --incremental` to update in place when the per-file cache exists)
- Include the index & search.js
        - Indexes are stored outside the repo by default; use cache mounting for agent images
        - If you need repo-local indexes, set `cache.root` in `.pairofcleats.json` to a path inside the repo

## 🔌 MCP Server

Run the MCP server (stdio):

`npm run mcp-server`

Tools exposed:
- `index_status` (cache + index presence, repo identity, git info)
- `build_index` (index build + optional sqlite)
- `search` (JSON search results)
- `download_models` (prefetch embeddings)
- `report_artifacts` (sizes for cache + indexes)

## ✅ Tests

Lightweight smoke checks:

`npm run verify`

Fixture smoke (stub embeddings, no model download):

`npm run fixture-smoke`

Fixture parity (runs parity harness against all fixtures):

`npm run fixture-parity`

Fixture eval (expected-hit checks against fixture queries):

`npm run fixture-eval`

Query cache harness:

`npm run query-cache-test`

Benchmarks (query latency + artifact sizes):

`npm run bench`
`npm run bench-ann`

Optional: measure build times with `npm run bench -- --build --stub-embeddings`.

Cleanup harness:

`npm run clean-artifacts-test`

Uninstall harness:

`npm run uninstall-test`

SQLite incremental harness:

`npm run sqlite-incremental-test`

SQLite compaction harness:

`npm run sqlite-compact-test`

SQLite ANN extension harness:

`npm run sqlite-ann-extension-test`

Download extensions archive harness:

`npm run download-extensions-test`

Verify extensions (loads the binary unless `--no-load` is provided):

`npm run verify-extensions`

Repometrics dashboard harness:

`npm run repometrics-dashboard-test`

MCP server harness:

`npm run mcp-server-test`

Model comparison harness:

`npm run compare-models -- --models Xenova/all-MiniLM-L12-v2,Xenova/all-MiniLM-L6-v2 --build`

Model comparison test harness:

`npm run compare-models-test`

Summary report test harness:

`npm run summary-report-test`

Combined summary report (runs compare + parity and writes `docs/combined-summary.json`):

`npm run summary-report -- --models Xenova/all-MiniLM-L12-v2,Xenova/all-MiniLM-L6-v2`

Reuse existing indexes (skip rebuilds):

`npm run summary-report -- --models Xenova/all-MiniLM-L12-v2,Xenova/all-MiniLM-L6-v2 --no-build`

Optional flags:
- `--require-index` (fail if index artifacts are missing)
- `--require-sqlite` (fail if the SQLite index is missing)
- `--require-dicts` (fail if dictionaries are missing)

## 🧹 Maintenance

- Report cache/artifact sizes: `npm run report-artifacts`
- Clean repo artifacts (indexes + metrics + default sqlite dbs): `npm run clean-artifacts`
- Clean everything in the cache root: `npm run clean-artifacts -- --all`
- Uninstall caches + dictionaries + models + extensions (prompts): `npm run uninstall` (use `--yes` to skip prompt)
- Uninstall test harness: `npm run uninstall-test`
- Compact SQLite indexes (prune vocab + reassign doc_ids): `npm run compact-sqlite-index`
- Repometrics dashboard (console summary + optional JSON): `npm run repometrics-dashboard`
- Build CI artifacts: `node tools/ci-build-artifacts.js --out ci-artifacts`
- Restore CI artifacts: `node tools/ci-restore-artifacts.js --from ci-artifacts` (bootstrap auto-detects when present)

## 📚 Design docs

- `COMPLETE_PLAN.md`
- `docs/model-comparison.md`
- `docs/sqlite-compaction.md`
- `docs/sqlite-ann-extension.md`
- `docs/sqlite-incremental-updates.md`
- `docs/repometrics-dashboard.md`
- `docs/sqlite-index-schema.md`
- `docs/query-cache.md`

## 📦 Cache Layout

Indexes and metrics live outside the repo by default (configurable via `.pairofcleats.json`):

- `<cache>/repos/<repoId>/index-code`
- `<cache>/repos/<repoId>/index-prose`
- `<cache>/repos/<repoId>/incremental/<mode>/` (per-file cache)
- `<cache>/repos/<repoId>/repometrics`
- `<cache>/repos/<repoId>/repometrics/index-<mode>.json`
- `<cache>/repos/<repoId>/repometrics/queryCache.json`
- `<cache>/repos/<repoId>/index-sqlite/index-code.db`
- `<cache>/repos/<repoId>/index-sqlite/index-prose.db`
- `<cache>/models`
- `<cache>/extensions`

Default cache root:
- Windows: `%LOCALAPPDATA%\\PairOfCleats`
- Linux/macOS: `~/.cache/pairofcleats`
- Update AGENTS.md to instruct agents to utilize search.js & leave repo metrics alone
- Set up workflows and merge drivers for search metrics
- Enjoy!

--- 

<h3 align=center>😻 How can I help</h3>
<p align=center>Detailed issues are good.<br />
Pull requests are better.<br />
Money is best<br /></p>
<p align=center><a href="https://ko-fi.com/E1E71G7Y0T"><img src="https://ko-fi.com/img/githubbutton_sm.svg"></a></p>

<p align=center><i>Give your agents better shoes. 🏃‍♂️👟</i></p>
