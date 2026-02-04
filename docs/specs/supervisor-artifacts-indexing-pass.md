# Spec — Supervisor Artifacts Indexing Pass (v1)

## Objective
Standardize how job outputs are discovered, normalized, and surfaced to the TUI as **artifacts**.

This is a “post-job” pass performed by the **Node supervisor** after the child process exits, so the Rust TUI can:
- show result-centric screens without log scraping
- present stable paths + sizes + existence checks
- export diagnostics quickly (including recording/event files)

## Non-goals
- Not a general file indexer for the whole repo.
- Not a replacement for the build system.
- Not a security boundary: paths are trusted (repo-local).

---

## Definitions

### Artifact
A structured reference to a file/directory produced or consumed by a job.

Canonical artifact record:

```json
{
  "kind": "index:code",
  "label": "Code index dir",
  "path": "/abs/path/to/cache/index/code",
  "exists": true,
  "bytes": 13241234123,
  "mtime": "2026-01-30T17:02:12.012Z",
  "mime": null
}
```

Rules:
- `path` MUST be absolute or a repo-relative path with a known base (recordings directory).
- `bytes` is required when `exists=true` and size is cheaply available; else null.
- `mtime` should be set when `exists=true` and stat succeeds; else null.

### Artifact indexing pass
A bounded, deterministic pass that:
1) determines **expected artifacts** based on job type and args
2) resolves paths + existence
3) attaches metadata (bytes/mtime)
4) emits a **job artifacts update event**

---

## Protocol additions

### Event: `job:artifacts`
Emitted after `job:end`.

```json
{
  "proto": "poc.progress@2",
  "event": "job:artifacts",
  "ts": "2026-01-30T17:02:12.012Z",
  "runId": "run-7b9e…",
  "jobId": "job-003",
  "artifacts": [ { "...artifact..." }, "..." ],
  "artifactsIndexed": true,
  "source": "supervisor"
}
```

Guidance:
- The supervisor MAY emit intermediate progress using `task:*` with `stage:"artifacts"`.
- The UI treats `job:artifacts` as the authoritative final list.

---

## Artifact extractors (by job type)

### Generic extractor (all jobs)
- Recording file (if enabled): `.poc/recordings/run-<runId>.jsonl`
- Job stdout capture (if enabled): `.poc/results/<jobId>.stdout.json` or `.txt`
- Job stderr capture (optional): `.poc/results/<jobId>.stderr.txt`
- Exported job event slice (on demand): `.poc/exports/<jobId>.events.jsonl`

### Index build (`build_index.js`)
Discover:
- cache root + repo cache root (from env/config)
- index output dirs:
  - code/prose/extracted-prose/records index dirs (`getIndexDir` semantics)
- crash log:
  - `<repoCacheRoot>/logs/index-crash.log`
- build state:
  - `<buildRoot>/build_state.json` (if used)
- preprocess outputs:
  - `<repoCacheRoot>/preprocess.json` (if produced)
- sqlite/lmdb/tantivy artifacts:
  - sqlite db files per mode (paths from `resolveSqlitePaths`)
  - lmdb dirs for code/prose (paths from `resolveLmdbPaths`)
  - tantivy dirs/meta if enabled (paths resolved in `src/retrieval/cli/load-indexes.js`)

### Bench (`tools/bench/language-repos.js`)
Discover:
- results root (`--out` or default)
- bench log path (often printed by tool; prefer structured output if added)
- report JSON (captured stdout when `--json`)

### Search (`search.js`)
Discover:
- metrics dir (from `getMetricsDir`)
- `metrics.json`, `searchHistory`, `noResultQueries` (written by `recordSearchArtifacts()`)

### Setup (`tools/setup/setup.js`)
Discover:
- config file path (.pairofcleats.json)
- downloaded dict/model directories (from config)
- extensions directory (if applicable)

---

## Performance constraints
- Must run in < ~250ms for typical jobs.
- Directory size recursion is allowed only for known artifact roots and must have a budget:
  - maxEntries, maxDepth, maxTotalBytes scanned
- Prefer sizes from manifest/meta where available (e.g. `pieces/manifest.json`) over recursive scans.

---

## Testing

### Unit tests
- extractor returns expected artifacts for each job type given argv/env fixtures.
- metadata stat failures produce `exists:false` or null fields without throwing.
- artifact kinds are stable and unique.

### Integration tests
- run a small `build_index.js` on fixture repo and assert:
  - `job:artifacts` emitted
  - artifact list includes index dir + preprocess + crash log (missing ok)
- run a search and assert metrics artifacts discovered.
