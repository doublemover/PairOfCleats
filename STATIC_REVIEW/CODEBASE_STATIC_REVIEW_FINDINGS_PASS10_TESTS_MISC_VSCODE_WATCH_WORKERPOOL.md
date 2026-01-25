# Codebase Static Review Findings — Pass 10 (Tests: TS/Unicode/Watch/Workers/VS Code)

> Scope: **only** the files listed in the request.  
> Goal: identify **bugs, mistakes, mis-implementations, flakiness risks, portability problems, missing coverage**, and **how to fix/implement better** (no code changes performed).

---

## Scope

Reviewed only the following files:

- `tests/typescript-imports-only.js`
- `tests/typescript-parser-selection.js`
- `tests/unicode-offset.js`
- `tests/uninstall.js`
- `tests/unsupported-language-skip.js`
- `tests/uv-threadpool-env.js`
- `tests/uv-threadpool-no-override.js`
- `tests/vector-extension-missing.js`
- `tests/vector-extension-sanitize.js`
- `tests/vscode-extension.js`
- `tests/watch-backend-selection.js`
- `tests/watch-debounce.js`
- `tests/watch-filter.js`
- `tests/watch-stability-guard.js`
- `tests/worker-pool-windows.js`
- `tests/worker-pool.js`
- `tests/xxhash-backends.js`
- `extensions/vscode/extension.js`

---

## Executive Summary

These scripts cover useful “correctness cliffs” that are easy to regress: **TypeScript parser fallbacks**, **Unicode offset stability**, **watch mode correctness**, **worker-pool parity**, **vector extension hardening**, and **VS Code integration basics**.

The biggest problems (from a reliability/maintainability standpoint) are:

1. **Hidden global-state leakage** (environment variables and global backend selectors) that can cause cross-test coupling when tests are run in a shared process.
2. **Timer-based tests with tight margins** (`watch-debounce`, `watch-stability-guard`) that are vulnerable to CI jitter.
3. **Brittle artifact assumptions** (`unicode-offset` reads `chunk_meta.json` directly and will break if the project switches formats or shards by default).
4. **Extension runtime constraints** (VS Code extension uses `execFile` with a fixed `maxBuffer`, assumes a particular JSON output shape, and has fragile CLI path resolution).

The section “Test Timing & Suite Tiering” at the end provides an actionable process to track per-test duration and enforce CI-friendly tiers (smoke/unit vs integration/e2e).

---

## High-Priority Findings

### P0 — VS Code extension is vulnerable to output size (maxBuffer) and assumes a specific JSON shape

**Where**
- `extensions/vscode/extension.js`

**What’s wrong**
- Uses `cp.execFile(..., { maxBuffer: 20 * 1024 * 1024 }, ...)`. This hard caps stdout+stderr buffering:
  - If search output grows beyond ~20MB (easy with verbose JSON fields, large result sets, or accidental logging), VS Code will report a failure even when the CLI succeeded.
- Assumes the CLI returns JSON shaped like:
  - `payload.code`, `payload.prose`, `payload.records` arrays with items containing `file`, `startLine`, `score`, etc.
  - If the CLI JSON schema evolves (e.g., `{ results: [...] }`, or nested `{ hits: { code: [...] } }`), the extension will silently show “no results” or break with JSON/key errors.
- It also discards stderr except on error; if the CLI emits warnings to stderr while exiting 0, users won’t see them.

**Why it matters**
- The extension is an “integration surface” users will try early. If it fails due to buffering or schema drift, users will perceive the whole tool as unstable, even if the CLI itself is fine.

**Suggested fix**
- Replace `execFile` with a streaming spawn (`spawn`) and incremental stdout accumulation:
  - Prefer reading stdout as a stream and failing only when the JSON cannot be parsed at end.
  - Add a soft cap with a clear message: “results too large; reduce maxResults or increase verbosity controls”.
- Treat JSON shape as a versioned contract:
  - Consider emitting a small `schemaVersion` or `formatVersion` in JSON output.
  - Parse defensively: accept both `{ code/prose/records }` and a canonical `{ resultsByMode }` shape (or whatever you standardize on).
- Surface stderr warnings even on success (either in a VS Code output channel or in an info message).

**Additional tests**
- Add a test (or fixture JSON) that simulates:
  - >20MB output (or at least “large enough to exceed maxBuffer”).
  - schema variations (legacy vs future) so the extension can be kept compatible intentionally.

### P0 — VS Code extension uses an async `execFile` callback; failures can surface as unhandled rejections or a stuck progress UI

**Where**
- `extensions/vscode/extension.js` (`runSearch()`)

**What’s wrong**
- `cp.execFile(..., async (error, stdout, stderr) => { ... await vscode.workspace.openTextDocument(...) ... })`
  - Node’s `execFile` does not await an async callback; any thrown error after an `await` becomes an unhandled promise rejection.
  - If `openTextDocument` / `showTextDocument` fails (missing file, bad URI, permission), the progress notification may never resolve.
- There is no outer `try/finally` ensuring `resolve()` is called exactly once.

**Why it matters**
- In VS Code, unhandled rejections can spam logs, degrade extension host stability, and produce a “search stuck” user experience.

**Suggested fix**
- Avoid an `async` callback; instead:
  - wrap the whole exec in a Promise and keep the callback synchronous, forwarding errors via `resolve/reject`, or
  - switch to `spawn` and handle streams with explicit `try/catch/finally`.
- Ensure completion signaling executes in a `finally` path, and surface document-open errors as user-facing messages.

**Additional coverage**
- Add a test/fixture scenario where:
  - the CLI returns a hit for a file that no longer exists (simulate by deleting the file before selection),
  - confirm the extension shows a useful error instead of hanging/crashing.

---

### P0 — CLI path resolution in the VS Code extension can resolve to a non-existent command without clear diagnostics

**Where**
- `extensions/vscode/extension.js` (`resolveCli()`)

**What’s wrong**
- If `pairofcleats.cliPath` is configured and *relative*, `resolveCli` joins it to `repoRoot` but does **not** verify that the resulting path exists.
- If `cliPath` is absolute but doesn’t exist, the logic still uses it (because `path.join(repoRoot, absolute)` returns the absolute path), but there is no “does not exist / is not executable” preflight error.

**Why it matters**
- Misconfiguration becomes a confusing “spawn ENOENT” style error message. The extension should detect and guide: “Your CLI path does not exist; set it to … or clear it to use the bundled repo script”.

**Suggested fix**
- Add a preflight validation step:
  - If configured path exists and is a file, proceed.
  - Otherwise show an actionable error including resolvedPath and recommended values (repo-local `bin/pairofcleats.js`, or global `pairofcleats`).
- Consider Windows specifics:
  - If command is `pairofcleats` on Windows, it might need `.cmd` or `.exe`. Detect and adjust when possible.

---

### P0 — Unicode offset test is tightly coupled to `chunk_meta.json` format and will regress if default meta format changes

**Where**
- `tests/unicode-offset.js`

**What’s wrong**
- Reads **only** `chunk_meta.json`:
  - `const chunkMetaPath = path.join(codeDir, 'chunk_meta.json');`
- The project already supports multiple chunk meta output layouts elsewhere (JSONL, sharded parts, etc.). If defaults change, this test will fail even if the Unicode offsets are perfectly correct.

**Why it matters**
- Unicode offset correctness is important enough that the test should be **format-agnostic**. Otherwise, any chunk-meta writer refactor becomes a false negative in this test.

**Suggested fix**
- Load chunk metadata through the same abstraction used by the index/retrieval code:
  - Prefer using the canonical artifact reader (e.g., `src/shared/artifact-io.js`) so the test is resilient to JSON vs JSONL vs parts.
- If you intentionally want this test to enforce “chunk_meta.json exists in this profile”, make that explicit:
  - set config for this test to force JSON chunk meta output, and document it in the test header.

**Additional coverage**
- Add a companion test that validates Unicode offsets when chunk meta is emitted as JSONL parts (if/when that becomes a supported/default mode).

---

## Medium-Priority Findings

### P1 — Timer-based debounce/stability tests risk flakiness under CI load

**Where**
- `tests/watch-debounce.js`
- `tests/watch-stability-guard.js`

**What’s wrong**
- Both tests use real timeouts and assert counts/elapsed time with fairly tight tolerances:
  - Debounce: `debounceMs: 30`, waits 60ms then expects one call.
  - Stability guard: `checks: 3, intervalMs: 100`, expects `elapsed >= 150`.
- Under CI contention, Node timers can drift significantly (GC pauses, noisy neighbors), producing occasional false failures.

**Why it matters**
- Flaky tests degrade trust in the suite and slow down iteration (retries, “ignore this failure” culture).

**Suggested fix**
- Increase margins and make assertions less timing-sensitive:
  - Debounce: wait 3–5× the debounce time before asserting.
  - Stability guard: assert a lower bound consistent with the algorithm’s *minimum* wait time, or assert on semantic outcomes rather than elapsed time.
- Prefer deterministic timing in unit tests:
  - If feasible, inject a clock or use a fake timer mechanism for the scheduler and stability guard.
  - If not, isolate these tests in a “timing-sensitive” tier and allow retries.

**Additional coverage**
- Add a test case that ensures `waitForStableFile()` returns false or times out cleanly when file is continuously changing (to validate negative behavior without relying on exact elapsed ms).

---

### P1 — Multiple tests mutate environment/global state without a consistent restore pattern

**Where**
- `tests/watch-backend-selection.js` (sets `PAIROFCLEATS_WATCHER_BACKEND` and deletes it later, but does not restore prior value)
- `tests/unicode-offset.js` (sets `process.env.PAIROFCLEATS_CACHE_ROOT`)
- `tests/vector-extension-missing.js` (sets `PAIROFCLEATS_TESTING`, `PAIROFCLEATS_CACHE_ROOT`)
- `tests/xxhash-backends.js` (calls `setXxhashBackend(...)`, global for the process)

**What’s wrong**
- Tests can be run:
  - in a single node process (importing/running multiple scripts), or
  - as separate processes per test file.
- In the “single process” case, env/global leakage can alter subsequent tests in surprising ways.

**Why it matters**
- This is one of the easiest ways to introduce “heisenbugs” in test suites.

**Suggested fix**
- Adopt a test helper pattern:
  - `withEnv({ VAR: 'value' }, fn)` that restores previous values on exit.
  - `withGlobalReset(fn)` for things like xxhash backend selection.
- For scripts that must use `process.env`, snapshot and restore explicitly:
  - `const prev = process.env.X; ...; finally { if (prev===undefined) delete process.env.X; else process.env.X=prev; }`

---

### P1 — VS Code extension uses `--json` but does not control verbosity/result shape; this encourages “too large” payloads

**Where**
- `extensions/vscode/extension.js` (`buildArgs()`)

**What’s wrong**
- `buildArgs` requests JSON output but does not request compact JSON fields; it assumes `--top` controls size sufficiently.
- If the CLI includes verbose fields by default (e.g., full text snippets, full metadata blocks), the extension is the first to hit size limits.

**Suggested fix**
- Add extension-level defaults for compact output:
  - if the CLI supports it: `--json-compact` or `--json-fields file,startLine,endLine,name,headline,score`.
  - if not supported today, this is a good integration-driven requirement to add (and then use here).
- Consider a two-stage UX:
  1) show a compact hit list
  2) fetch/render details on selection (requires an API server or a follow-up CLI call)

---

### P2 — `typescript-imports-only` test is brittle due to intentionally invalid syntax and parser selection details

**Where**
- `tests/typescript-imports-only.js`

**What’s wrong**
- The snippet contains `export = ???` which is syntactically invalid; the test expects `collectTypeScriptImports(..., importsOnly=true)` to succeed anyway.
- This can be brittle across parser implementations or upgrades:
  - If the “imports-only” path is implemented by doing a partial parse, the invalid tail may still throw.
  - Babel vs TypeScript parser behavior differs.

**Why it matters**
- This is a valuable regression test (imports-only should be resilient), but it should fail only when the underlying behavior regresses—not when parsing rules change in an unrelated way.

**Suggested fix**
- Replace `export = ???` with a “more stable” failure-inducing construct that is less likely to be interpreted differently across parsers (e.g., an unclosed block or deliberately truncated file end).
- Assert more than “import includes foo”:
  - validate that it returns exactly one import, and that it does not accidentally scan strings/comments for false imports.

---

## Low-Priority Findings / Observations

### P3 — Inconsistent test style (shebang, assertions, and exit handling)

**Where**
- Some tests are `#!/usr/bin/env node` scripts (`unicode-offset`, `uninstall`, `unsupported-language-skip`, etc.).
- Others are ESM modules without shebang (`watch-debounce`, `watch-filter`) using top-level await/import style.

**What’s wrong**
- If tests are run by a custom runner, this is fine; but it makes ad-hoc local execution inconsistent (“can I run this file directly?”).
- It increases onboarding friction.

**Suggested fix**
- Decide one of:
  - “All test files are directly runnable node scripts” (add shebang consistently), or
  - “All tests are imported and executed by a runner” (remove shebangs and standardize exports).
- If keeping both styles, document the rule-of-thumb in `tests/README.md` (or similar).

---

## Per-file quick scan notes (to avoid “silent omissions”)

These are intentionally brief. Items that rise to priority are expanded above.

- `tests/typescript-parser-selection.js`
  - Good sanity test for parser availability, but it only asserts “chunks exist”.
  - Consider extending it to validate **parser selection behavior** (e.g., same exported symbol count) and to gate the `typescript` parser path behind explicit “typescript available” capability if that ever becomes optional.
- `tests/uninstall.js`
  - Solid “safety net” test for uninstall behavior; consider adding a negative safety assertion:
    - verify the script does **not** delete outside the configured roots (e.g., refuses `PAIROFCLEATS_HOME=/` in testing mode).
- `tests/unsupported-language-skip.js`
  - Valuable semantic test, but maintainability is poor because it manually supplies a very large `createFileProcessor(...)` config object.
  - Consider a shared `makeTestFileProcessorDefaults()` helper to reduce churn when the file-processor signature changes.
- `tests/uv-threadpool-env.js` / `tests/uv-threadpool-no-override.js`
  - Tests are small and do the right thing by passing an explicit env object.
  - Minor improvement: add an assertion that `resolveRuntimeEnv()` does not *delete* unrelated env vars (i.e., it only sets/overrides what it owns).
- `tests/vector-extension-missing.js`
  - Good fallback test, but it is schema-brittle (manually creates tables) and leaks env vars.
  - Consider constructing the DB through the same builder/migration code path the tool uses, so the test keeps validating real-world behavior as schema evolves.
- `tests/vector-extension-sanitize.js`
  - Good injection hardening test. Consider adding:
    - a case for column names (if configurable),
    - a case for unicode/quoted identifiers, and
    - a case for empty/whitespace table values.
- `tests/vscode-extension.js`
  - Useful manifest smoke test; consider also verifying:
    - `main` points to the correct entrypoint
    - `activationEvents` include “onStartupFinished” or other desired events (if you want background indexing features later)
- `tests/watch-backend-selection.js`
  - Good coverage of env-based forcing and capability fallback.
  - Should restore prior env state rather than `delete` unconditionally.
- `tests/watch-filter.js`
  - Good behavioral coverage including special filenames and records-mode exclusion.
  - If you later add “virtual file layer / segmented script extraction”, consider adding cases for those synthetic/virtual paths.
- `tests/worker-pool.js`
  - Good parity checks across tokenization and quantization.
  - Consider using deep equality assertions rather than `JSON.stringify` so failures are more diagnosable.
- `tests/worker-pool-windows.js`
  - Great Windows-specific path torture test; ensure it is tiered as “platform-specific integration” and not required on non-Windows lanes.
  - Potential future: validate long-path support explicitly if you ever enable `\\?\` normalization.
- `tests/xxhash-backends.js`
  - Good baseline parity check for wasm/native backends.
  - Add cleanup of tmp dir and ensure backend is restored even on assertion failure (wrap in try/finally).

---

## Test Timing & Suite Tiering Process (CI Smoke vs Integration/E2E)

This is a concrete process to make test scope decisions based on data, and to keep CI fast while still running full end-to-end validation regularly.

### 1) Instrument test durations at the runner boundary

**Mechanism**
- In the test runner that executes these scripts (or a thin wrapper), capture:
  - start timestamp
  - end timestamp
  - exit code
  - optional: peak RSS (if feasible via `process.resourceUsage()` or platform-specific tooling)

**Output**
- Emit a JSONL ledger (append-only) per run:
  - `tests/.cache/test-times/latest.jsonl`
  - Each record: `{ test, startedAt, durationMs, exitCode, platform, nodeVersion, sha }`

**Why JSONL**
- Easy to append and diff over time.
- Can be rolled up into “top slowest tests” dashboards.

### 2) Maintain a lightweight “test tier manifest”

Create a single manifest checked into the repo, e.g.:

- `tests/manifest.json`

Each entry includes:
- `id` / `path`
- `tier`: `unit` | `integration` | `e2e` | `perf` | `timing-sensitive`
- `expectedDurationMs` (auto-updated from the ledger, but can have a manual override)
- `requires`: capabilities tags (`git`, `better-sqlite3`, `watcher.parcel`, `windows`, `nodeNativeXxhash`, etc.)

### 3) Enforce tier-based execution in CI

Example policy:
- **PR CI (fast)**:
  - run all `unit` + `integration` tests with a budget (e.g., 6–10 minutes).
  - allow `timing-sensitive` with retries or run on a nightly schedule only.
- **Nightly / pre-release**:
  - run full `e2e` + `perf` (including repo indexing, service tests, multi-backend tests).
- **Platform-specific lanes**:
  - Windows lane runs `worker-pool-windows.js`.
  - Linux lane runs native addon coverage (if present).
  - macOS lane runs sourcekit-specific tests (if present).

### 4) Use the ledger to continuously optimize

Automate two outputs:
- “Top 20 slowest tests” report
- “Duration delta vs baseline” report (flag tests that get 2× slower)

Use these to drive:
- moving tests between tiers,
- adding caching/fixtures to shrink e2e tests,
- reworking timing-sensitive tests to be deterministic.

### 5) Make duration visible to developers

Add a CLI flag to the test runner:
- `node tests/run.js --report-times`

That prints a table like:

- test path
- duration
- tier
- status

…and saves the JSONL ledger artifact.

---

## Suggested follow-up tasks (roadmap-friendly)

1. **VS Code extension: streaming output + schema versioning**
   - Replace `execFile` with streaming `spawn` and add schema compatibility logic.

2. **Artifact-reader adoption in tests**
   - Update `unicode-offset` to use the canonical artifact reader instead of assuming `chunk_meta.json`.

3. **Test hygiene helpers**
   - Add `withEnv()` and `withTempDir()` helpers; adopt them in these scripts.

4. **Timer flakiness hardening**
   - Increase margins or inject fake timers for debounce/stability tests.

5. **Test duration ledger + tier manifest**
   - Instrument runner, create `tests/manifest.json`, and gate CI by tier.
