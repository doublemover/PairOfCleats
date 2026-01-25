# Codebase Static Review Findings — Tools / Bench / Service (Pass 7)

This report is a focused static review of the **tooling and operational scripts** (under `tools/`) that wrap the core indexing/retrieval engine: API server, MCP server, bench harnesses, ingestion utilities (SCIP/LSIF/ctags/gtags), build orchestration (bootstrap, embeddings build, SQLite builds), and the lightweight repo/queue service utilities.

All file references are relative to the repo root. This pass intentionally **does not** review core engine sources outside of these tools, except when a tool’s behavior is tightly coupled to a specific downstream contract (called out explicitly).

## Scope

Files reviewed:

### API tooling
- `tools/api/response.js`
- `tools/api/sse.js`
- `tools/api/validation.js`
- `tools/api-server.js`
- `tools/assemble-pieces.js`

### Benchmark harness (language + micro)
- `tools/bench/language/cli.js`
- `tools/bench/language/config.js`
- `tools/bench/language/locks.js`
- `tools/bench/language/metrics.js`
- `tools/bench/language/process.js`
- `tools/bench/language/progress/parse.js`
- `tools/bench/language/progress/render.js`
- `tools/bench/language/progress/state.js`
- `tools/bench/language/report.js`
- `tools/bench/language/repos.js`
- `tools/bench/micro/compression.js`
- `tools/bench/micro/extractors.js`
- `tools/bench/micro/hash.js`
- `tools/bench/micro/index-build.js`
- `tools/bench/micro/regex.js`
- `tools/bench/micro/run.js`
- `tools/bench/micro/search.js`
- `tools/bench/micro/tinybench.js`
- `tools/bench/micro/utils.js`
- `tools/bench/micro/watch.js`
- `tools/bench-dict-seg.js`
- `tools/bench-language-matrix.js`
- `tools/bench-language-repos.js`
- `tools/bench-query-generator.js`

### Bootstrap + build tooling
- `tools/bootstrap.js`
- `tools/build-embeddings.js`
- `tools/build-embeddings/atomic.js`
- `tools/build-embeddings/cache.js`
- `tools/build-embeddings/chunks.js`
- `tools/build-embeddings/cli.js`
- `tools/build-embeddings/embed.js`
- `tools/build-embeddings/hnsw.js`
- `tools/build-embeddings/lancedb.js`
- `tools/build-embeddings/manifest.js`
- `tools/build-embeddings/run.js`
- `tools/build-embeddings/sqlite-dense.js`
- `tools/build-lmdb-index.js`
- `tools/build-sqlite-index.js`
- `tools/build-sqlite-index/cli.js`
- `tools/build-sqlite-index/index-state.js`
- `tools/build-sqlite-index/run.js`
- `tools/build-sqlite-index/temp-path.js`
- `tools/build-tantivy-index.js`
- `tools/cache-gc.js`
- `tools/check-env-usage.js`
- `tools/ci-build-artifacts.js`
- `tools/ci-restore-artifacts.js`
- `tools/clean-artifacts.js`
- `tools/cli-utils.js`
- `tools/combined-summary.js`
- `tools/compact-pieces.js`
- `tools/compact-sqlite-index.js`
- `tools/compare-models.js`
- `tools/config-dump.js`
- `tools/config-inventory.js`
- `tools/ctags-ingest.js`
- `tools/default-config-template.js`
- `tools/default-config.js`
- `tools/download-dicts.js`
- `tools/download-extensions.js`
- `tools/download-models.js`

### Index analysis, ingest, MCP, and reporting tools
- `tools/ctags-ingest.js`
- `tools/gtags-ingest.js`
- `tools/lsif-ingest.js`
- `tools/scip-ingest.js`
- `tools/eval/match.js`
- `tools/eval/run.js`
- `tools/generate-demo-config.js`
- `tools/generate-repo-dict.js`
- `tools/get-last-failure.js`
- `tools/git-hooks.js`
- `tools/index-state-utils.js`
- `tools/index-validate.js`
- `tools/indexer-service.js`
- `tools/map-iso-serve.js`
- `tools/mcp-server.js`
- `tools/mcp/repo.js`
- `tools/mcp/runner.js`
- `tools/mcp/tools.js`
- `tools/mcp/transport.js`
- `tools/mergeAppendOnly.js`
- `tools/parity-matrix.js`
- `tools/path-utils.js`
- `tools/release-check.js`
- `tools/repometrics-dashboard.js`
- `tools/report-artifacts.js`
- `tools/report-code-map.js`
- `tools/reset-config.js`
- `tools/run-phase22-gates.js`
- `tools/scip-ingest.js`

### Service layer + operational helpers
- `tools/service/config.js`
- `tools/service/logger.js`
- `tools/service/queue.js`
- `tools/service/repos.js`
- `tools/shard-census.js`
- `tools/show-throughput.js`
- `tools/structural-search.js`
- `tools/triage/context-pack.js`
- `tools/triage/decision.js`
- `tools/triage/ingest.js`
- `tools/uninstall.js`
- `tools/validate-config.js`
- `tools/validate-critical-deps.js`
- `tools/vector-extension.js`
- `tools/verify-extensions.js`
- `tools/workers/bundle-reader.js`

## Severity Key

- **Critical**: likely to cause incorrect results, crashes, corrupted artifacts/state, queue deadlocks, or major production breakage.
- **High**: significant correctness/quality risk, major performance hazard, or security foot-gun.
- **Medium**: correctness edge cases, meaningful perf waste, confusing UX, or latent scaling hazards.
- **Low**: minor issues, maintainability concerns, or polish.

---

## Executive Summary (Most Actionable)

1. **[Critical] Queue persistence is not crash-safe and can silently lose work.** `tools/service/queue.js` writes the queue JSON in-place (non-atomic) and treats parse failures as “empty queue.” A partial write or corruption can drop queued/running jobs with no recovery path.

2. **[High] “Lock file” semantics are incomplete; a crashed worker can permanently wedge the queue.** `tools/service/queue.js` uses a `wx` lock file with a fixed 5s acquisition timeout and no stale-lock eviction. If a process exits without cleanup, the service can deadlock.

3. **[High] Several ingest pipelines write JSONL without backpressure handling.** `ctags-ingest`, `lsif-ingest`, `scip-ingest`, `gtags-ingest` call `writeStream.write()` in a hot loop and never await `'drain'`, which can create **unbounded memory growth** on large inputs.

4. **[High] Child-process spawn error paths are not handled in the worker service.** `tools/indexer-service.js` only waits on `'close'`; if `spawn()` fails (`ENOENT`, permission, etc.), the Promise may never resolve, leaving the queue job “running” forever and continuously heartbeating.

5. **[High] SSE responder has a return-type foot-gun and incomplete SSE framing.** `tools/api/sse.js` returns a **Promise** from `sendHeaders()` despite being non-`async`, and emits `data:` lines without newline-safe framing. Both can break consumers under realistic payloads.

6. **[High] Path normalization in ingestion tools can emit `..` paths (and non-repo paths).** Multiple ingest scripts compute `path.relative(repoRoot, resolved)` and then return it without rejecting “outside repo” results. This can create collisions, confusing UX, and security issues if those artifacts are later treated as repo-relative.

7. **[Medium] The indexer-service + repo sync flow is functional but lacks operational hardening.** Missing timeouts, weak validation of config JSON, weak shutdown handling, and limited telemetry can make the service brittle under failures.

8. **[Medium] Several tools parse “extra args” by naive whitespace splitting.** `--args "a b='c d'"` style quoting will not survive `.split(/\s+/)`, leading to unexpected behavior in `ctags-ingest`, `scip-ingest`, `gtags-ingest`, etc.

9. **[Medium] The isometric map HTTPS server uses a brittle path-safety check.** `tools/map-iso-serve.js` uses `startsWith(baseDir)` on normalized paths, which can be bypassed by prefix collisions (e.g., `/base` vs `/baseX`) and should be replaced with a robust containment check.

---

## 1) Queue + Service Orchestration (`tools/indexer-service.js`, `tools/service/*`)

### 1.1 **[Critical]** Queue file writes are not atomic; parse errors can drop the entire queue

**Where**
- `tools/service/queue.js`
  - `saveQueue()` writes directly to `queue*.json` via `fs.writeFile(...)`
  - `loadQueue()` uses `readJson(..., {jobs:[]})` and falls back silently

**What’s wrong**
- `saveQueue()` overwrites the queue file in place. If the process is interrupted mid-write (crash, power loss, disk full), you can end up with a truncated or invalid JSON file.
- `loadQueue()` treats a read/parse error as “no jobs”: it returns the fallback payload and proceeds, effectively **forgetting** all prior jobs.

**Why it matters**
- The queue becomes **non-durable** under fault conditions. This is especially problematic because the service is intended as an operational primitive (scheduled indexing, embeddings builds, etc.).

**Suggested fix direction**
- Switch queue persistence to an **atomic replace** pattern (write to temp file + fsync + rename).
- On parse failure: preserve the corrupted file (rename to `.corrupt.<timestamp>.json`), emit a loud warning/error, and avoid auto-zeroing the queue.
- Add a small **queue schema/version** to support forward compatibility.

**Tests to add**
- Simulate partial write (write half a JSON document) and assert:
  - service refuses to treat it as empty by default, and
  - corruption is detected and quarantined.

---

### 1.2 **[High]** Queue lock file can wedge indefinitely (no stale eviction)

**Where**
- `tools/service/queue.js` — `withLock(lockPath, worker)`

**What’s wrong**
- The lock is implemented as a `wx` “create-only” file, deleted in a `finally` block.
- If the process terminates unexpectedly after acquiring the lock, the lock file remains. Future lock attempts will hit a 5s timeout and throw `"Queue lock timeout."` indefinitely.

**Why it matters**
- One crash can wedge the entire service; it will never make progress until the lock file is removed manually.

**Suggested fix direction**
- Write lock content including `{pid, startedAt, hostname}` and implement stale eviction (e.g., > N seconds, or pid is not alive).
- Or avoid file locks entirely and use a more robust primitive (SQLite queue, advisory locks, or fs flock on platforms that support it).

**Tests to add**
- Create a lock file manually and assert the service can recover after `lockStaleMs` elapses.

---

### 1.3 **[High]** Worker process spawning can hang forever when `spawn()` fails

**Where**
- `tools/indexer-service.js` — `spawnWithLog(...)`

**What’s wrong**
- `spawnWithLog` only resolves on `'close'`. If `spawn()` emits an `'error'` event (common when the executable is missing or permissions fail), `'close'` may never occur.
- In that case:
  - the worker loop stalls,
  - the job heartbeat continues (interval stays alive),
  - the job remains “running” forever until manually requeued.

**Suggested fix direction**
- Attach `child.on('error', ...)` and resolve with a non-zero exit code (and capture the message in the job report).
- Ensure heartbeat timers are cleaned up in all failure paths.

**Tests to add**
- Spawn a nonexistent command and assert:
  - the Promise resolves promptly,
  - the job is marked failed or retried as configured, and
  - the heartbeat timer is cleared.

---

### 1.4 **[Medium]** Repo sync is synchronous, unbounded, and branch assumptions are brittle

**Where**
- `tools/service/repos.js`

**What’s wrong**
- Uses `spawnSync('git', ...)` with no timeout or cancellation.
- Default branch is hardcoded to `'main'`; many repos still use `'master'` or other defaults.
- `git pull --ff-only` without specifying remote branch depends on the local repo’s upstream configuration.

**Suggested fix direction**
- Prefer async spawn with timeouts and clear error surfaces.
- If a branch is not specified, detect default branch (`git remote show origin` or `git symbolic-ref refs/remotes/origin/HEAD`).
- Log repo sync outcomes in structured form for the service.

---

### 1.5 **[Medium]** Service config loading is not resilient to JSON errors

**Where**
- `tools/service/config.js`

**What’s wrong**
- `JSON.parse(fs.readFileSync(...))` is not wrapped; malformed config crashes the service on startup.

**Suggested fix direction**
- Parse with try/catch and emit a clear configuration error showing which file failed, and how to validate it (`tools/validate-config.js`).

---

### 1.6 **[Medium]** Logging configuration inherits upstream logger hazards

**Where**
- `tools/service/logger.js`

**What’s wrong**
- This tool wraps `configureLogger()` from `src/shared/progress.js`. Previous sweeps already flagged potential mis-wiring in the pretty/json logger setup.
- In practice, enabling structured logging for the service may cause instability depending on the `pino` configuration.

**Suggested fix direction**
- Treat this file as “thin,” but add a small service-level smoke test that starts the service with `PAIROFCLEATS_LOG_FORMAT=pretty` and ensures it does not crash.

---

## 2) API Server + SSE + Validation (`tools/api/*`, `tools/api-server.js`)

### 2.1 **[High]** SSE `sendHeaders()` returns a Promise despite being non-async

**Where**
- `tools/api/sse.js` — `sendHeaders() { ... return writeChunk('\n'); }`

**What’s wrong**
- `writeChunk()` is `async`, so `sendHeaders()` returns a Promise.
- A caller expecting boolean semantics (as implied by the body: `return false` / `return writeChunk(...)`) can easily treat it as truthy and proceed incorrectly.

**Suggested fix direction**
- Make `sendHeaders` `async`, or make it synchronous (write headers only) and require the caller to call an async “kick” explicitly.

---

### 2.2 **[High]** SSE event framing is not newline-safe

**Where**
- `tools/api/sse.js` — `sendEvent(event, payload)` does `data: ${JSON.stringify(payload)}\n\n`

**What’s wrong**
- SSE requires that each newline in a data payload be represented as separate `data:` lines. If `payload` is (or contains) a string with newlines, some clients will interpret it as multiple events or malformed data.

**Suggested fix direction**
- If you want “payload as JSON,” keep it JSON, but ensure the final serialized string is split on `\n` and each line is prefixed with `data: `.

---

### 2.3 **[Medium]** Missing transport headers for common reverse proxies

**Where**
- `tools/api/sse.js` — response headers

**What’s wrong**
- When running behind nginx or similar proxies, SSE often requires disabling buffering (`X-Accel-Buffering: no`) and ensuring intermediaries don’t cache or close idle connections.

**Suggested fix direction**
- Add proxy-friendly headers optionally (behind a CLI/config flag), and optionally a heartbeat/ping event to keep connections warm.

---

### 2.4 **[Medium]** Search request schema is permissive in ways that can surprise downstream

**Where**
- `tools/api/validation.js`

**What’s wrong**
- Several fields that are semantically typed as dates or durations are defined as generic strings or integers with no format constraint (e.g., `modifiedAfter`, `modifiedSince`).
- `normalizeMetaFilters` will stringify object-valued meta entries as `[object Object]`, which is almost never intended.

**Suggested fix direction**
- Add formats (date-time, duration) or explicitly document the accepted formats.
- Reject or JSON-stringify object values for meta filters to avoid accidental garbage filters.

---

### 2.5 **[Medium]** API server shutdown can hang on keep-alive sockets

**Where**
- `tools/api-server.js` — `server.close(() => { router.close(); process.exit(0); })`

**What’s wrong**
- `server.close()` waits for all existing connections to end. If clients hold keep-alive sockets open, shutdown can hang indefinitely.
- There is no forced socket destroy after a grace period.

**Suggested fix direction**
- Track active sockets and force-close after N seconds on shutdown.

---

## 3) Ingestion Tools (SCIP/LSIF/ctags/gtags)

These scripts share the same systemic hazards: **unbounded buffering**, **non-repo-safe path normalization**, and **child-process error paths**.

### 3.1 **[High]** JSONL writes do not handle backpressure

**Where**
- `tools/ctags-ingest.js` — `writeStream.write(...)` inside the read loop
- `tools/scip-ingest.js` — `writeStream.write(...)` inside occurrences loop
- `tools/lsif-ingest.js` — `recordEntry()` does `writeStream.write(...)`
- `tools/gtags-ingest.js` — `writeStream.write(...)` inside parse loop

**What’s wrong**
- In Node, `Writable.write()` returns `false` when the internal buffer is full. Continuing to write will queue data in memory.
- Large LSIF/SCIP/ctags streams can be huge; these tools can accumulate significant memory before the OS flushes the file.

**Suggested fix direction**
- Implement a small helper: `async writeLine(stream, line)` that awaits `'drain'` when needed.
- Optionally, use `pipeline()` with a Transform that understands backpressure.

**Tests to add**
- Feed a large synthetic stream and assert memory does not grow without bound (or at least that `drain` handling is present and invoked).

---

### 3.2 **[High]** Path normalization can emit `..` or “outside repo” paths

**Where**
- `tools/scip-ingest.js`, `tools/lsif-ingest.js`, `tools/ctags-ingest.js`, `tools/gtags-ingest.js`

**What’s wrong**
- They compute `rel = path.relative(repoRoot, resolved)` and then return `rel` without checking whether the path is outside the repo root.
- If the input contains absolute paths outside the repo root, the resulting `file` field can be `../../...`.

**Why it matters**
- Later consumers may treat `file` as repo-relative and join it with repoRoot, enabling path traversal or collisions.
- Even without security impact, it corrupts cross-tool correlation (you end up with “files” that aren’t in the repo).

**Suggested fix direction**
- Use a robust containment check (`path.relative` must not start with `..` and must not be absolute). If outside, either:
  - drop the entry, or
  - store absolute path under a different field (`absFile`) and keep `file` as `null`.

---

### 3.3 **[High]** Child process spawn error paths are not handled

**Where**
- `tools/ctags-ingest.js` — `spawn(ctagsCmd, ...)`
- `tools/scip-ingest.js` — `spawn(scipCmd, ...)`
- `tools/gtags-ingest.js` — `spawn(globalCmd, ...)`

**What’s wrong**
- All three only listen for `'close'` and `stderr.data`. If spawn fails (`ENOENT`), the process emits `'error'` and may never emit `'close'`.

**Suggested fix direction**
- Add `child.on('error', ...)` to reject/throw with a clear “tool not found” message.

---

### 3.4 **[High]** `lsif-ingest` can be a memory bomb on large LSIF dumps

**Where**
- `tools/lsif-ingest.js` — `vertexById`, `docById`, `rangeById`, `rangeToDoc` Maps

**What’s wrong**
- The script retains a large amount of LSIF state in memory while scanning. LSIF dumps for large repos can be many millions of lines.
- This tool can exceed memory even before it produces useful output.

**Suggested fix direction**
- If the LSIF is topologically friendly (often it is), avoid storing all vertices:
  - keep only the subset you need (documents + ranges + results),
  - free data structures once a document block is complete,
  - or pre-pass / indexing approach by splitting LSIF by document.

---

### 3.5 **[Medium]** Naive `--args` splitting breaks quoted arguments

**Where**
- `tools/ctags-ingest.js`, `tools/scip-ingest.js`, `tools/gtags-ingest.js`

**What’s wrong**
- `String(argv.args).split(/\s+/)` cannot represent quoted tokens and escapes.

**Suggested fix direction**
- Prefer a repeatable `--arg` flag or parse using a shell-words parser (optional dependency) with safe defaults.

---

## 4) Benchmark Harness (`tools/bench/*`)

### 4.1 **[High]** Process tree termination is incomplete on non-Windows

**Where**
- `tools/bench/language/process.js` — `killProcessTree(pid)` does `process.kill(pid, 'SIGTERM')`

**What’s wrong**
- On Unix, this kills only the parent process, not the entire process group. Tools that spawn workers or subprocesses can survive and leak CPU/disk.

**Suggested fix direction**
- Spawn children in their own process group (detached) and kill by negative pid (`process.kill(-pid, ...)`), plus an escalation strategy (SIGTERM → SIGKILL after a grace period).

---

### 4.2 **[Medium]** Lock handling for bench runs is “best effort” and susceptible to PID reuse

**Where**
- `tools/bench/language/locks.js`

**What’s wrong**
- Staleness is inferred via PID liveness + age; PID reuse can cause false positives/negatives.
- The lock does not include a unique run ID or host identity.

**Suggested fix direction**
- Store `{pid, startedAt, hostname, repoLabel, runId}` and validate all fields.

---

### 4.3 **[Medium]** Progress renderer depends on parsing human log lines

**Where**
- `tools/bench/language/progress/*`

**What’s wrong**
- `render.js` attempts to parse progress and file lines via regexes. This is inherently brittle and will drift when log formats change.

**Suggested fix direction**
- Prefer structured progress events (the project already has `parseProgressEventLine` usage in `process.js`).
- Long term: require that index builds emit machine-readable progress events and have the bench harness consume those exclusively.

---

### 4.4 **[Low]** Some bench defaults can create unintended disk pressure

**Where**
- `tools/bench/language/cli.js`, `tools/bench/language/metrics.js`

**Notes**
- Cache roots, per-run suffixing, and clone behaviors are reasonable but should be paired with clear cleanup tooling and disk space checks (especially on CI).

---

## 5) Bootstrap + Build Tools (Index, SQLite, Embeddings)

### 5.1 **[Medium]** Bootstrap mixes concerns and relies on fragile JSON parsing of subprocess output

**Where**
- `tools/bootstrap.js`

**What’s wrong**
- Tooling detection is executed via a subprocess and parsed as JSON from stdout. Any incidental logs will break JSON parsing.
- Incremental behavior is toggled implicitly if an incremental cache directory exists, which can be surprising.

**Suggested fix direction**
- Ensure tooling-detect supports a “JSON only” mode with stderr-only logs.
- Require explicit `--incremental` unless a config flag opts into “auto incremental.”

---

### 5.2 **[Medium]** Build scripts frequently mix sync + async FS without consistent atomic patterns

**Where**
- Multiple files across `tools/build-*`, `tools/ci-*`, `tools/clean-artifacts.js`, `tools/config-*`

**What’s wrong**
- Many scripts write state or manifests via plain `writeFile`/`writeFileSync`. Some are atomic; many are not.
- The result is a “best effort” operational story—fine for local use, but brittle at scale or under failures.

**Suggested fix direction**
- Standardize on a single `atomicWriteJson()` helper and use it in all state/manifest writers.
- Where files are large (JSONL), standardize on streaming + piece manifests.

---

### 5.3 **[Medium]** SQLite extension verification is susceptible to SQL injection via CLI overrides

**Where**
- `tools/verify-extensions.js`

**What’s wrong**
- User-supplied `--table`/`--column` are interpolated into SQL without quoting/escaping. This is a local tool, but it can still lead to confusing failures or foot-guns.

**Suggested fix direction**
- Validate identifiers against a safe regex and/or quote identifiers defensively.

---

## 6) MCP Transport + Tool Invocation (`tools/mcp/*`, `tools/mcp-server.js`)

### 6.1 **[Medium]** Cancellation ID type mismatch can make cancel unreliable

**Where**
- `tools/mcp/transport.js` — cancel uses `params.id` and looks up `inFlight.get(cancelId)`

**What’s wrong**
- JSON-RPC IDs can be numbers or strings. If a client uses numeric IDs but the map key is a string (or vice versa), cancellation will fail silently.

**Suggested fix direction**
- Canonicalize IDs for map lookups (e.g., `String(id)`).

---

### 6.2 **[Medium]** Progress notifications can be unthrottled

**Where**
- `tools/mcp/transport.js` — `sendProgress(...)`

**What’s wrong**
- There’s no rate limiting. Long-running tools that emit frequent progress can overwhelm clients and the stdio channel.

**Suggested fix direction**
- Add a per-tool call throttle (e.g., coalesce to one event per 250–500ms, or only send when message changes).

---

## 7) Isometric Map Server (`tools/map-iso-serve.js`)

### 7.1 **[Medium]** Path safety check uses `startsWith(baseDir)` (prefix collision)

**Where**
- `tools/map-iso-serve.js` — `safeJoin(baseDir, requestPath)`

**What’s wrong**
- `startsWith` is not a robust containment check (`/base` is a prefix of `/baseX`).
- Better: `isInside(baseDir, targetPath)` using `path.relative` semantics (the project already has such a helper in `tools/path-utils.js`).

**Suggested fix direction**
- Replace the check with `isInside(baseDir, resolved)` or compare path segments (`baseDir + path.sep`).

### 7.2 **[Low]** `decodeURIComponent` can throw and crash the server on malformed URLs

**Suggested fix direction**
- Wrap decode in try/catch and return 400.

---

## Appendix A — Cross-Cutting Refactor Opportunities (Tooling Layer)

These are not “bugs,” but they are recurring sources of drift and operational risk.

1. **Unify CLI parsing and config resolution across tools.**
   - Some tools use `createCli`, others use `yargs` directly (`tools/bench/micro/run.js`).
   - A single shared parser + config overlay reduces behavioral drift.

2. **Standardize atomic state writes.**
   - Queue/state/manifest JSON should be atomic everywhere, not only sometimes.

3. **Create a shared “streaming JSONL writer” helper.**
   - Many tools re-implement JSONL writing and all omit backpressure handling today.

4. **Normalize “extra args” parsing with a safe abstraction.**
   - Prefer repeatable `--arg` flags or a structured config file for tool arguments.
