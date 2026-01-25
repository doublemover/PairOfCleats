# Codebase Static Review Findings — Pass 7 (Tools: API server + bench harness)

**Scope:** Static review of the developer tooling surface that sits “around” the core index/retrieval engine: a lightweight HTTP API server implementation, streaming (SSE) response helpers, request validation, an index-piece assembly helper, and the language benchmark harness (repo cloning, lock coordination, progress parsing/rendering, metrics and report aggregation).

**Files reviewed (only):**

- `tools/api/response.js`
- `tools/api/sse.js`
- `tools/api/validation.js`
- `tools/api-server.js`
- `tools/assemble-pieces.js`
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

---

## Executive summary

This slice of the repository is “tooling glue”: it is frequently executed in CI and by developers, and it is the first thing users will touch when they want automation (API server) or confidence (bench harness). The dominant risks are **contract ambiguity** and **observability gaps** rather than missing features:

- The SSE responder has an **async/sync contract mismatch** (`sendHeaders()` returns a Promise but is not `async`), which can silently break call-site logic and cause “headers claimed sent” even when backpressure/close races occur.
- The API request validator is strict about types but does **not coerce**; this is fine for JSON bodies, but becomes brittle if any clients send numbers/booleans as strings (very common in HTTP gateways and query-string adapters). In addition, the schema’s enums are a likely **drift hotspot** relative to CLI/runtime capabilities.
- The bench harness’s “run identity” (cache suffix vs log file naming) can be inconsistent because `buildRunSuffix()` is invoked multiple times; this makes result triage and deterministic caching harder than it needs to be.
- The interactive progress renderer is useful, but it has a couple of correctness/UX sharp edges: it can mis-estimate line-based progress (counting “file started” as “lines processed”), can show >100% processed in some edge cases, and (depending on how `writeLog` is wired) may **fail to persist key progress lines** into the on-disk log.
- Windows-path support and repo cloning are handled thoughtfully, but repo-derived directory naming is not fully sanitized; a malicious or malformed repo string could create unexpected paths under the benchmark root.

Overall: these are good building blocks, but they need tightened invariants so that the tooling layer is as “boring and reliable” as the indexing layer is becoming.

---

## Severity rubric

- **Critical:** Can break tool contracts, produce misleading output, or create hangs/crashes in normal flows.
- **High:** Likely to cause incorrect behavior or operational pain in realistic usage.
- **Medium:** Edge-case correctness/perf risk; will matter at scale or in CI environments.
- **Low:** Quality-of-life, maintainability, or drift risks that accumulate over time.

---

## Cross-cutting themes

1. **Tooling code needs the same “envelope invariants” as artifacts.**  
   Streaming output (SSE) and progress/log output (bench) are interfaces; return types and log completeness must be unambiguous.

2. **Prefer single-source-of-truth option contracts.**  
   Hand-authored enums and validator schemas tend to drift from the actual supported backends/modes. If possible, derive these from existing CLI option definitions or a shared “capabilities” inventory.

3. **Bench harnesses are only useful when results are reproducible.**  
   Run IDs, cache directories, and log filenames should share one stable identifier per invocation.

---

## Findings

### F-01 — `sendError()` allows `details` to override canonical error envelope fields
**Severity:** High  
**File:** `tools/api/response.js`

**What’s wrong**
- `sendError()` builds `{ ok: false, code, message, ...rest }`, where `rest` is derived from `details` (minus `code`).  
- Because `rest` is spread last, a caller can accidentally (or intentionally) override `ok`, `message`, and other canonical fields (e.g., `ok: true`).

**Why it matters**
- This makes error responses less reliable and complicates client logic. If a downstream handler uses `ok` as the primary success signal, a malformed `details` object could invert semantics.

**Suggested fix**
- Make envelope fields authoritative:
  - spread `details` first, then overwrite: `{ ...rest, ok:false, code, message }`, or
  - explicitly strip/deny `ok`, `message`, and other reserved keys from `details`.

**Suggested tests**
- Unit test: `sendError(res, 400, 'bad', 'nope', { ok:true, message:'x' })` must still serialize `ok:false` and `message:'nope'`.

---

### F-02 — `sendJson()` can throw on serialization and crash the handler path
**Severity:** Medium  
**File:** `tools/api/response.js`

**What’s wrong**
- `JSON.stringify(payload)` can throw (circular structures, BigInt, custom `toJSON` throwing).  
- There is no try/catch and no fallback response.

**Why it matters**
- Even if “normal” payloads are safe, accidental inclusion of circular objects (e.g., error objects with references, metrics registries) can crash a request path and potentially the whole process if not caught upstream.

**Suggested fix**
- Wrap serialization in try/catch and produce a deterministic error payload (500) when serialization fails.
- Consider a safe serializer for known tricky types (e.g., BigInt → string) if needed.

**Suggested tests**
- Unit test: circular payload should not crash; should respond with `{ ok:false, code:'internal_error' }` (or similar).

---

### F-03 — SSE `sendHeaders()` returns a Promise but is not `async`
**Severity:** Critical  
**File:** `tools/api/sse.js`

**What’s wrong**
- `sendHeaders()` returns `false` or the result of `writeChunk('\n')`.  
- `writeChunk` is `async`, so the return type is **either boolean or Promise<boolean>**, depending on path.
- This is extremely easy to misuse:
  - `if (!sse.sendHeaders()) ...` will treat a Promise as truthy and not execute error handling.
  - Non-awaited calls lose the ability to detect close/backpressure failure.

**Why it matters**
- SSE endpoints are typically long-lived. Backpressure and early client disconnects are common. An ambiguous contract here can produce subtle “stream looks alive but it isn’t” failures.

**Suggested fix**
- Make `sendHeaders()` explicitly `async` and always return `Promise<boolean>`, or make it fully synchronous and always return `boolean` (but then you must decide how to handle backpressure).
- Update JSDoc to reflect the true return type and enforce at call-sites.

**Suggested tests**
- Contract test: `await sendHeaders()` returns `false` if `res` is already closed/destroyed.
- Behavioral test: when `res.write()` returns false (simulated), `sendHeaders()` waits for `drain` or `close` and returns the correct value.

---

### F-04 — SSE implementation is missing practical production hardening
**Severity:** Medium  
**File:** `tools/api/sse.js`

**What’s wrong**
- Headers are minimal; there is no opt-out of proxy buffering (common for Nginx), and there is no heartbeat/ping mechanism.
- `sendEvent()` does not sanitize `event` names; newline characters could break the protocol framing.
- `JSON.stringify(payload)` is not guarded; it can throw and blow up a streaming handler.
- No explicit `res.flushHeaders()` or equivalent “force header flush” step is used.

**Why it matters**
- SSE commonly fails “in the middle” due to load balancers/proxies timing out idle connections or buffering responses, producing confusing user experiences.

**Suggested fix**
- Add optional hardening defaults:
  - `X-Accel-Buffering: no` (best-effort) and `Cache-Control: no-cache, no-transform`
  - optional heartbeat: comment events `: ping\n\n` every N seconds
  - sanitize `event` to a safe subset or reject invalid names
  - guard payload serialization and surface an error event before closing

**Suggested tests**
- Protocol test: event names with `\n` are rejected or sanitized.
- Streaming test: can send multiple events and client receives correct framing.

---

### F-05 — API request validation is strict but does not coerce; schema drift is likely
**Severity:** High  
**File:** `tools/api/validation.js`

**What’s wrong**
- Ajv is instantiated without `coerceTypes`, so `top: "10"` is invalid (must be an integer), `ann: "true"` is invalid, etc.
- Enums (`mode`, `backend`, `output`) are hard-coded; these will drift as the CLI and backends evolve (e.g., new modes/backends, renamed modes like `extracted-prose`).

**Why it matters**
- In practice, many HTTP clients (and gateways) produce strings for numbers/booleans unless you enforce JSON bodies. This becomes a support burden quickly.
- Drift between API and CLI creates “works in CLI but not via API” surprises.

**Suggested fix**
- Decide the API contract:
  - If the API is strictly JSON-body based: document it and enforce `Content-Type: application/json` at the router level.
  - If query-string compatibility is desired: enable `coerceTypes` and/or normalize payload prior to validation.
- Reduce drift:
  - derive enums from a shared inventory (preferred), or
  - centralize the enum list so CLI and API share constants.

**Suggested tests**
- Validation test: `top: "5"` should either be accepted (coerced) or rejected with a documented, stable error message.
- Drift test: a small “capabilities snapshot” fixture for supported `mode/backend/output`.

---

### F-06 — `normalizeMetaFilters()` stringifies objects ambiguously
**Severity:** Medium  
**File:** `tools/api/validation.js`

**What’s wrong**
- For object values, it emits `${key}=${value}` which yields `[object Object]` for non-primitive values.
- For arrays of objects, it flattens entries but does not ensure stable ordering or encoding.

**Why it matters**
- Meta filters are typically used to create reproducible queries. Ambiguous stringification undermines determinism and makes debugging harder.

**Suggested fix**
- Define a canonical encoding:
  - primitives as-is
  - objects encoded as JSON (stable stringification), e.g., `key={...}`
- Consider rejecting non-primitive meta values if the downstream filter engine cannot reliably interpret them.

**Suggested tests**
- Ensure object meta values encode deterministically (same object → same filter string).
- Ensure key ordering is stable (either sorted or stable-json encoded).

---

### F-07 — API server shutdown can hang with keep-alive/SSE connections
**Severity:** High  
**File:** `tools/api-server.js`

**What’s wrong**
- `server.close()` waits for existing connections to end. With keep-alive or SSE clients, this may never happen, and the shutdown callback may never fire.
- There is no socket tracking / forced connection teardown, and no timeout-based “hard stop.”

**Why it matters**
- In production-like usage (or even dev usage with a browser open), SIGTERM/SIGINT may appear to “do nothing,” leaving CI jobs or local sessions stuck.

**Suggested fix**
- Track sockets:
  - on `'connection'`, store sockets in a Set; on socket `'close'`, remove
  - on shutdown, call `socket.destroy()` after a short grace period
- Optionally support a `--shutdown-timeout-ms` flag.

**Suggested tests**
- Integration test: open an HTTP keep-alive connection (or SSE stream), send SIGTERM, verify process exits within a bounded timeout.

---

### F-08 — Auth/CORS options are permissive and could be misconfigured insecurely
**Severity:** Medium  
**File:** `tools/api-server.js`

**What’s wrong**
- `--allow-unauthenticated` combined with `--cors-allow-any` is a “dangerous but easy” configuration. That may be intentional, but there is no explicit “are you sure?” warning.
- `allowedRepoRoots` is treated as a raw list of strings; if downstream checks are not path-normalized consistently, it can become a policy bypass surface.

**Why it matters**
- This tool is likely to be run by users who are not thinking deeply about network exposure. The default is safe (localhost), but the easy switch to unsafe modes should be clearly signposted.

**Suggested fix**
- Emit explicit warnings when:
  - binding to non-local addresses with unauthenticated mode
  - `cors-allow-any` is enabled
- Normalize allowed repo roots to canonical absolute paths at startup (and perform all request-time comparisons against canonical forms).

**Suggested tests**
- Policy test: `allowedRepoRoots` matching uses canonicalization (no `..` traversal).
- Warning test: insecure flag combos produce a prominent stderr warning.

---

### F-09 — `assemble-pieces` can destructively delete output before verifying inputs
**Severity:** Medium  
**File:** `tools/assemble-pieces.js`

**What’s wrong**
- With `--force`, the tool deletes `outDir` (`rm -r`) before validating that all `inputs` exist and are compatible/complete.
- If the inputs are wrong, you end up with “nothing assembled” and your previous output is gone.

**Why it matters**
- This is a sharp edge in workflows that iterate on assembly. It increases the blast radius of mistakes.

**Suggested fix**
- Preflight validation step:
  - verify every input directory exists
  - verify required manifests/pieces exist in each input
  - verify modes/stage markers are compatible (if applicable)
- Only after preflight passes should `outDir` be deleted/recreated.

**Suggested tests**
- E2E test: invalid input with `--force` should fail *without* deleting existing `outDir` (or at least should require an explicit `--force-delete`).

---

### F-10 — Bench harness run IDs/log paths can be inconsistent within a single invocation
**Severity:** Medium  
**File:** `tools/bench/language/cli.js`

**What’s wrong**
- `buildRunSuffix()` is called multiple times during argument normalization (cache suffix and log file name).  
- If the clock crosses a second boundary between calls, the “run id” fragments diverge (cache dir uses one suffix, log file uses another).

**Why it matters**
- Results become harder to correlate: “which log corresponds to which cache?”  
- This reduces reproducibility and complicates automation.

**Suggested fix**
- Generate one `runId` early and reuse it for:
  - `cacheSuffix` default
  - log filename default
  - any “results record” id fields

**Suggested tests**
- Unit test: `parseBenchLanguageArgs()` returns a single consistent run identifier used across output paths.

---

### F-11 — `getRecommendedHeapMb()` may overestimate memory in containers/CI
**Severity:** Medium  
**File:** `tools/bench/language/metrics.js`

**What’s wrong**
- Uses `os.totalmem()` which reflects host memory, not container limits.
- On CI runners or Docker, this can recommend heaps that exceed the process’s actual memory budget, increasing OOM risk.

**Why it matters**
- Bench harnesses should be stable across environments; recommending a too-large heap causes flaky failures and confusing guidance.

**Suggested fix**
- Detect cgroup memory limit (Linux) when present, or accept an override:
  - `BENCH_TOTAL_MEM_MB` or `--total-mem-mb`
- At minimum, document that the heuristic is host-based and can be overridden.

**Suggested tests**
- Unit test: when an env override is set, recommended heap uses it.
- (Optional) CI test: simulate a low memory limit and ensure recommended heap is bounded.

---

### F-12 — `killProcessTree()` doesn’t actually kill the tree on POSIX
**Severity:** Medium  
**File:** `tools/bench/language/process.js`

**What’s wrong**
- On Windows, it uses `taskkill /T /F` which kills descendants.
- On non-Windows, it sends SIGTERM to the single pid; child processes spawned by that process may survive.

**Why it matters**
- Bench runs can leak orphaned index/search processes if interrupted, creating resource contention and confusing subsequent runs.

**Suggested fix**
- Launch children in their own process group and kill the group:
  - spawn with `{ detached: true }` and then `process.kill(-pid, 'SIGTERM')` (platform permitting), or
  - use a small, vetted “tree kill” helper for POSIX (optional dependency).

**Suggested tests**
- Integration test: spawn a child that spawns a grandchild; call `killProcessTree`; assert both terminate.

---

### F-13 — Progress/log ingestion may omit key lines depending on how `writeLog` is wired
**Severity:** High  
**File:** `tools/bench/language/progress/render.js`

**What’s wrong**
- `appendLog()` does not consistently call `writeLog(cleaned)` for all parsed “special” lines (shard lines, file progress lines, progress summary lines).  
- If `appendLog` is the only sink for stdout/stderr lines (typical), then the on-disk log can miss exactly the lines you need for diagnosis.

**Why it matters**
- When a bench run fails, the log file is the primary forensic artifact. Missing progress/context lines reduces debuggability and undermines the bench harness’s value.

**Suggested fix**
- Treat `writeLog` as the canonical append-only sink for *all* incoming lines.
- If you want to de-noise logs, do it at presentation time (interactive window), not at persistence time.
- Optionally tag/partition logs: `[raw]`, `[progress]`, `[metrics]`.

**Suggested tests**
- “Log completeness” test: feed a representative set of lines into `appendLog()` and assert they all appear in the persisted log sink in some form.

---

### F-14 — Line-based ETA/progress math can overcount and produce >100% processed
**Severity:** Medium  
**File:** `tools/bench/language/progress/render.js`

**What’s wrong**
- `linesProcessed[mode]` increments when a file is first seen in logs, not when it completes. This can over-count “processed lines” early.
- `remainingLines = totalLines - processedLines` is not clamped. If processedLines drifts above totalLines (duplicate file lines, mismatched path keys), the displayed “processed/total” can exceed 100%.

**Why it matters**
- The bench harness is used to compare indexing strategies. Misleading throughput/ETA indicators reduce trust in the benchmark output.

**Suggested fix**
- Clamp: `processedLines = Math.min(processedLines, totalLines)` before formatting.
- If the build pipeline cannot emit “file completed,” explicitly label this as an estimate (“seen files”) or track line progress via `Line x / y` events more directly.

**Suggested tests**
- Unit test: duplicate file progress lines should not cause processedLines to exceed totalLines.
- Unit test: mismatched path forms (absolute vs relative) should not blow up totals; should degrade gracefully.

---

### F-15 — Interactive rendering assumes TTY and doesn’t handle resizing robustly
**Severity:** Low  
**File:** `tools/bench/language/progress/render.js`

**What’s wrong**
- Rendering uses `readline.moveCursor` and block rewrites. If `interactive` is true but stdout is not a TTY, output can become corrupted.
- Width is sampled per render, but there is no explicit handling for terminal resize events (minor).

**Why it matters**
- This mostly affects “piped” CI logs or unusual terminal environments.

**Suggested fix**
- Gate interactive mode on `process.stdout.isTTY` (or make `interactive` default to that).
- Consider clearing and re-rendering on resize if necessary (optional).

**Suggested tests**
- “Non-TTY safety” test: when stdout is not TTY, renderer should not attempt cursor moves.

---

### F-16 — Repo-derived paths are not fully sanitized for benchmark directories
**Severity:** High  
**File:** `tools/bench/language/repos.js`

**What’s wrong**
- `resolveRepoDir()` uses `repo.replace('/', '__')` but does not handle:
  - backslashes on Windows
  - `..` segments
  - characters that are invalid or special on filesystems
- A malformed config could escape the intended benchmark root directory or produce confusing directory structures.

**Why it matters**
- Bench tooling often runs on arbitrary config input. Defensive sanitization prevents foot-guns and mitigates risk if configs are pulled from shared sources.

**Suggested fix**
- Implement a strict “safe name” function:
  - allow only `[A-Za-z0-9._-]`, replace everything else with `_`
  - explicitly strip path separators and `..`
- Optionally include a short hash suffix to avoid collisions.

**Suggested tests**
- `owner/../../evil` must not traverse outside `reposRoot`.
- `owner\\repo` must not create nested folders on Windows.

---

### F-17 — Index artifact presence checks are simplistic and can mis-detect partial indexes
**Severity:** Medium  
**File:** `tools/bench/language/repos.js`

**What’s wrong**
- `needsIndexArtifacts()` checks for the presence of `chunk_meta.*` files/directories only.
- A partially written index could contain `chunk_meta` but be otherwise unusable (missing token postings, dense vectors, manifest, etc.).

**Why it matters**
- Bench runs may skip building indexes incorrectly, producing misleading benchmark results or failures later.

**Suggested fix**
- Prefer using the project’s own validator (if accessible in tools context), or at least check for:
  - `index_state.json`
  - `pieces/manifest.json`
  - backend-specific artifacts expected for the benchmark mode
- Treat this as a minimal “is it valid enough for bench?” gate.

**Suggested tests**
- Fixture: directory with only `chunk_meta.json` should still be considered “needs build.”

---

### F-18 — Bench config loader has no schema validation (easy drift + unclear errors)
**Severity:** Low  
**File:** `tools/bench/language/config.js`

**What’s wrong**
- Config is loaded as JSONC and only validated as “object.”
- A malformed config will fail later, often far from the source of the error.

**Why it matters**
- Benchmark tooling is frequently edited by humans. Early schema validation reduces frustration and improves CI signal.

**Suggested fix**
- Add an Ajv schema for the bench config structure:
  - languages, tiers, repo list entries, required string fields
- Emit actionable error messages (line/column if possible).

**Suggested tests**
- Invalid config (missing required keys) fails with a specific, stable diagnostic.

---

### F-19 — Report aggregation backends selection may undercount if only some metrics are present
**Severity:** Low  
**File:** `tools/bench/language/report.js`

**What’s wrong**
- Backend list is inferred from `summary.backends` or `Object.keys(summary.latencyMsAvg || {})`.  
- If a backend only reports hitRate/resultCount but not latencyMsAvg, it can be omitted from aggregation.

**Why it matters**
- Minor accuracy issue in reports; usually latency exists, but not guaranteed.

**Suggested fix**
- Union keys from all per-backend metric objects (`latencyMsAvg`, `hitRate`, `resultCountAvg`, memory).

**Suggested tests**
- Summary containing hitRate for a backend but no latency should still include that backend in the aggregated result.

---

## Suggested “tightening” tasks (tooling-level)

These are not bug fixes themselves; they are scoped stabilization steps to keep the tools reliable:

1. **SSE responder contract cleanup**
   - Make `sendHeaders()` signature unambiguous (`async` returning `Promise<boolean>`).
   - Add a small suite of unit tests around close/backpressure behavior.

2. **API search request contract alignment**
   - Decide JSON-body-only vs tolerant coercion.
   - Share enums/constants with CLI/retrieval to avoid drift.

3. **Bench run identity unification**
   - Introduce a single `runId` generated once per invocation and used for cache/log/results.

4. **Bench log completeness guarantee**
   - Ensure *all* child stdout/stderr lines are persisted to log sinks.
   - Keep “dedupe” only for interactive display.

5. **Path sanitization for benchmarks**
   - Implement a deterministic “safe repo name” and add tests for traversal/invalid chars.

---
