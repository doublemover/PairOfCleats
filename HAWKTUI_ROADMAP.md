# Roadmap — Rust Ratatui TUI + Node Supervisor

## Phase: Terminal-owned TUI driving repo tooling (Supervisor MVP → shipped binary)

### Objective
Deliver a **standalone Rust Ratatui TUI** that owns the terminal and drives existing Node scripts through a **Node supervisor** with a **strict, versioned JSONL protocol** for tasks/logs/results, including **correct cancellation + process-tree cleanup** across platforms.

### Goals
- A single UI-driven entrypoint that can (at minimum):
  - run core jobs (`setup`, `bootstrap`, `index build`, `search`, and bench harness jobs as “power user” flows)
  - display streaming tasks and logs from **nested subprocess trees**
  - cancel jobs safely and predictably
- A formal, versioned JSONL protocol boundary:
  - **Progress** as JSONL events (line-delimited)
  - **Final result** as either a typed terminal event (`job:end` with `result`) or a machine JSON blob on stdout (captured by supervisor)
- Shared, tested line decoding and event parsing logic (no ad‑hoc “split on \n” everywhere)
- Optional compile-on-install with secure prebuilt binary fallback
- No terminal corruption: raw mode restored, child processes terminated on exit

### Non-goals
- Replacing all existing CLI commands immediately
- Making every script “pure JSONL” in all modes (only in explicit `--progress jsonl` / supervisor mode)
- Distributed or remote execution, resumable job queues, or multi-user concurrency
- A full interactive editor for every config file on day one (MVP focuses on robust job-running + visibility)

### Constraints / invariants
- **Rust TUI owns the terminal**: no spawned job may assume it owns the TTY.
- The supervisor must treat all non-protocol output as logs (never “best effort parse random JSON”).
- Cancellation must be **tree-aware**:
  - Windows: `taskkill /T` then escalate to `/F`
  - POSIX: signal the process group (negative PID) when detached
- `--json` outputs must be **stdout-only** (no additional stdout noise); logs and progress go to stderr/protocol.
- **Line length cap**: decoder enforces a hard cap (default 1MB) and emits a `log` event indicating truncation.
- **Error behavior**: any malformed JSONL line becomes a `log` event with `parseError=true` (never fatal).

### Locked decisions (remove ambiguity)
- **Cancel exit code**: tools invoked under the supervisor must exit **130** on user‑initiated cancel (SIGINT/SIGTERM are normalized to 130).
- **Progress protocol**: v2 events must include `proto: "poc.progress@2"` and `event` (allowlist defined in v2 spec).
- **JSONL mode**: when `--progress jsonl`, stderr must emit **only** protocol events (no raw human lines).
- **JSON output**: when `--json`, stdout emits exactly **one** JSON object; stderr carries logs/progress only.
- **Event ordering**: every protocol event includes `ts` (ISO string) and a monotonic `seq` (per-job when `jobId` is present, else per-process).
- **POSIX kill**: if `detached === true`, kill process group (`-pid`); else kill single PID.
- **Job artifacts**: supervisor emits a `job:artifacts` event after `job:end` with a stable artifact list; artifacts include `kind`, `label`, `path`, `exists`, `bytes`, `mtime`, `mime`.
- **Search dispatch**: `bin/pairofcleats.js` must **not** reject valid search flags or backends; it passes all args through to `search.js`.
- **Spec file locations** (new):
  - `docs/specs/tui-tool-contract.md`
  - `docs/specs/progress-protocol-v2.md`
  - `docs/specs/node-supervisor-protocol.md`
  - `docs/specs/dispatcher-rewrite-and-search-reconciliation.md`
  - `docs/specs/supervisor-artifacts-indexing-pass.md`
  - `docs/specs/tui-installation.md`

### Tool JSON/JSONL stdout inventory (must remain exhaustive)
Tools that emit JSON to stdout or JSONL progress (must never use `stdio: 'inherit'` for children):
- `build_index.js` (progress JSONL / JSON summary)
- `search.js` (JSON output modes)
- `tools/reports/report-code-map.js` (JSON map output)
- `tools/setup/*` (JSONL progress mode)
- `tools/bootstrap/*` (JSONL progress mode)
- `tools/bench/**` (JSON/JSONL in harness mode)
- `tools/tooling/**` (install/detect/download report tools)
- `tools/config/**` (inventory/contract scripts)

Each listed tool must declare:
- stdout mode (JSON vs JSONL vs human)
- stderr mode (logs/protocol only)
- child stdio policy (pipe vs inherit)

### Related but out-of-scope specs
- `docs/specs/spimi-spill.md` (indexing perf roadmap; not part of TUI milestone work)

### Implementation order (dependency-aware, cross‑cutting first)
**Foundational work (must land first)**
1) **Sub‑phase 0.2 + 1.1–1.3**: shared kill‑tree, strict protocol v2, shared stream decoder, stdout guard.
2) **Sub‑phase 0.3–0.7**: tool JSONL/JSON hygiene + bench/setup/bootstrap refactors (can proceed in parallel per tool).

**Core runtime**
3) **Sub‑phase 2.1–2.2**: supervisor protocol + implementation.
4) **Sub‑phase 2.3–2.4**: dispatch refactor + artifacts pass (needs protocol + manifest fields defined).

**Product layer**
5) **Sub‑phase 3**: Rust TUI MVP (can start once protocol/manifest shapes are locked; can use mocked supervisor streams).
6) **Sub‑phase 4**: cancellation hardening (depends on supervisor + UI).
7) **Sub‑phase 5**: installation + distribution (can start once crate skeleton exists).

### Parallelization map (non‑overlapping work)
- **Track A (protocol + helpers)**: Sub‑phase 0.2, 1.1–1.3, plus 0.7 stdout guard.
- **Track B (tool hygiene)**: Sub‑phase 0.3–0.6 can be split by tool family:
  - B1: `build_index.js` + `tools/setup/*`
  - B2: bench harness (`tools/bench/language-*`)
  - B3: support tools invoked by setup/bench (`tools/tooling/*`, downloads)
- **Track C (dispatch)**: Sub‑phase 2.3 can proceed in parallel with Track B once protocol shapes are fixed.
- **Track D (supervisor core)**: Sub‑phase 2.2 can proceed in parallel with Track C (needs protocol + kill‑tree only).
- **Track E (Rust TUI)**: Sub‑phase 3 can begin after 2.1 spec + manifest field list are frozen (mock data OK).
- **Track F (install/dist)**: Sub‑phase 5 can begin after 3.1 crate skeleton (no dependency on supervisor runtime).

### Dependency matrix (phase → prerequisites)
| Phase / Sub‑phase | Requires | Notes |
|---|---|---|
| 0.1 TUI tool contract | — | Spec + audit only |
| 0.2 Kill‑tree unify | — | Hard dependency for supervisor + cancellation |
| 0.3 build_index JSONL cleanup | 0.2 (kill‑tree) | For abort correctness |
| 0.4 bench harness cleanup | 0.2 + 1.1/1.3 | Uses shared decoder + kill‑tree |
| 0.5 setup cleanup | 1.1/1.2 | Needs progress context + protocol strictness |
| 0.6 bootstrap cleanup | 1.1/1.2 | Same as setup |
| 0.7 stdout guard | — | Can ship early; used by all |
| 1.1 protocol v2 spec | — | Foundation for 1.2/1.3 |
| 1.2 context propagation | 1.1 | Adds env + display wiring |
| 1.3 progress stream decoder | 1.1 | Used by bench + supervisor |
| 2.1 supervisor protocol spec | 1.1 | Requires v2 protocol definitions |
| 2.2 supervisor implementation | 0.2 + 1.1–1.3 | Needs kill‑tree + decoder |
| 2.3 dispatch refactor | 1.1 | Needs stable manifest fields |
| 2.4 artifacts pass | 2.2 + 2.3 | Uses dispatch registry + job lifecycle |
| 3.1 Rust crate skeleton | — | Can begin early |
| 3.2 supervisor integration | 2.2 | Needs working supervisor |
| 3.3 UI behaviors | 3.1 + 2.3 | Needs manifest fields for palette |
| 4.1–4.3 cancellation hardening | 2.2 + 3.2 | Requires live supervisor + UI |
| 5.1 install + wrapper | 3.1 | Needs crate skeleton |
| 5.2 CI artifacts | 5.1 | Depends on build outputs |

### Cross-cutting constraints (apply to all phases)
- **Protocol strictness**: if a line is not v2 JSONL, it must be wrapped as a `log` event.
- **Line length cap**: enforce a maximum line size (e.g., 1MB) in the shared decoder to prevent memory blowups.
- **Stdout discipline**: any tool that writes JSON to stdout must never run children in `stdio: 'inherit'`.
- **Test determinism**: tests must run without network access unless explicitly mocked.

### Protocol versioning + migration
- v1 remains supported for legacy tools; supervisor accepts v1 but wraps into v2 envelope.
- v2 is strict: missing `proto` or `event` becomes `log` (never fatal).
- Version bump rules: breaking field changes require `@v3` and dual‑emit during migration window.

### Packaging constraints
- Rust TUI ships as standalone binary plus thin wrapper in `bin/`.
- Supervisor is invoked via wrapper to guarantee PATH and Node version consistency.
- Artifact naming must include platform and version (e.g., `poc-tui-vX.Y.Z-win32-x64.zip`).

---

## Sub-phase 0: Preparation — Tooling normalization + kill-tree unification

### Objective
Before introducing the supervisor/TUI, make the existing CLI tools behave **ideally** for a terminal-owned orchestrator:
- deterministic **non-interactive** execution paths
- clean separation of **stdout JSON** vs **stderr logs/progress**
- consistent **progress JSONL** emission (or at least no JSON ambiguity)
- unified, shared **process-tree termination** logic used everywhere (src/tools/tests)

### Why this must come first
The supervisor + TUI cannot be “correct by construction” if:
- tools write JSON summaries to stdout while child installers also write to stdout (breaks parsing)
- cancellation uses multiple incompatible kill-tree implementations
- tools rely on `stdio: 'inherit'` and assume they own the terminal

### 0.0 Current-state inventory (audit targets)
Use this list to remove ambiguity about which tools already emit JSONL progress and which still need cleanup.

**JSONL-clean candidates (verify + keep clean)**
- `tools/build/lmdb-index.js`
- `tools/build/tantivy-index.js`
- `tools/build/sqlite-index.js` (and `tools/build/sqlite/runner.js`)
- `tools/ci/build-artifacts.js`
- `tools/download/extensions.js`

**Mixed emitters (must be cleaned for JSONL mode)**
- `build_index.js` (JSONL + raw stderr writes)
- `tools/bench/language-repos.js` and `tools/bench/language/process.js` (JSONL + raw lines)

**No progress flags yet (must add + normalize)**
- `tools/setup/setup.js`
- `tools/setup/bootstrap.js`
- `tools/tooling/install.js` and `tools/tooling/detect.js` (when invoked by setup/bootstrap)

### 0.0.1 JSON stdout inventory (must audit child stdio)
**Scope**: tools with `--json` (or `--format json`) that **emit JSON to stdout**.  
**Goal**: verify any child process use **never** runs with `stdio: 'inherit'` when JSON is expected.

**JSON stdout + child processes (direct or indirect)**
- `build_index.js` (JSON stdout; **no direct spawn**, but verify any nested runners do not inherit)
- `tools/setup/setup.js` (**child: yes** via `runCommandBase`; defaults to `stdio: 'inherit'` unless JSON)
- `tools/setup/bootstrap.js` (**child: yes** via `runCommand/runCommandOrExit`; uses `stdio: 'inherit'` today)
- `tools/tooling/install.js` (**child: yes** via `spawnSync`, currently uses `stdio: 'inherit'`)
- `tools/triage/context-pack.js` (**child: yes** via `spawnSubprocessSync` → `search.js`)
- `tools/ci/run-suite.js` (**child: yes** via `spawnSubprocess`)
- `tools/reports/combined-summary.js` (**child: yes** via `spawnSubprocessSync`)
- `tools/reports/compare-models.js` (**child: yes** via `spawnSubprocessSync`)
- `tools/reports/report-code-map.js` (**child: yes** via `spawnSync('dot', ...)`)
- `tools/bench/vfs/cold-start-cache.js` (**child: yes** via `spawnSync`)
- `tools/ingest/ctags.js` (**child: yes** via `spawn`)
- `tools/ingest/gtags.js` (**child: yes** via `spawn`)
- `tools/ingest/scip.js` (**child: yes** via `spawn`)
- `tools/bench/language-repos.js` (**child: yes**, indirect via `tools/bench/language/process.js`)
- `tools/bench/language/process.js` (not JSON tool itself, but spawns benchmark jobs and must be JSONL‑safe)

**JSON stdout + no direct child spawn detected**
- `tools/analysis/structural-search.js` (JSON or JSONL via `--format`)
- `tools/analysis/explain-risk.js`
- `tools/eval/run.js`
- `tools/index/validate.js`
- `tools/index/cache-gc.js`
- `tools/index/report-artifacts.js`

---

**JSON file writers or pass-through (not stdout)**
- `tools/docs/script-inventory.js` (writes JSON file)
- `tools/docs/repo-inventory.js` (writes JSON file)
- `tools/ci/capability-gate.js` (writes JSON file)
- `tools/mcp/tools/search-args.js` (builds args; no stdout JSON)
- `tools/mcp/tools/handlers/downloads.js` (passes `--json` to verify-extensions)
- `tools/mcp/tools/handlers/artifacts.js` (passes `--json` to cache-gc)
- `tools/api/server.js` / `tools/api/router/search.js` (server/pass-through)

**Action**: for each **child** tool above, enforce piped stdio in JSON modes and add a regression test in Sub‑phase 0.T2/0.T4.

### Tasks

#### 0.1 Define the “TUI-ready tool contract” and audit tool surfaces
- **(Spec)** Add a spec: `docs/specs/tui-tool-contract.md`  
  - Define required behaviors for any tool the TUI will run:
    - Flags: `--progress {off,log,tty,jsonl,auto}`, `--json`, `--non-interactive` (where relevant)
    - Output rules:
      - stdout: **only** final machine output when `--json`
      - stderr: logs/progress (and in JSONL mode, only protocol events)
    - Exit codes:
      - success: 0
      - cancelled: **130** (standardized for all supervisor‑invoked tools)
      - “expected failures” vs “tool bug” (document what is what)
    - Cancellation:
      - tools must respond to SIGINT/SIGTERM by aborting ongoing work, then exiting promptly
      - nested child processes must be terminated as a tree
- **(Code audit)** Inventory the top-level scripts the TUI will drive in Milestone 1 and enumerate required changes:
  - `build_index.js`
  - `tools/bench/language-repos.js` (+ `tools/bench/language/process.js`)
  - `tools/setup/setup.js`
  - `tools/setup/bootstrap.js`
  - “support tools” invoked by the above where `--json` is expected to be consumed:
    - `tools/tooling/install.js`
    - `tools/download/dicts.js`
    - `tools/download/models.js`
    - any script that currently emits JSON on stdout while using `stdio:'inherit'` for child processes
- **(Doc)** Add a short developer note in `docs/` describing:
  - “stdout is for data, stderr is for humans/protocol”
  - where to add new commands to the dispatch registry

#### 0.2 Unify process-tree termination into `src/shared/` and update all call sites
**Problem today**
- `src/shared/subprocess.js` kills Windows trees with immediate `/F`.
- `tests/helpers/kill-tree.js` does a staged graceful→forced kill.
- `tools/bench/language/process.js` has its own reduced kill helper and on POSIX it does **not** kill process groups.

**(Code)** Create a single shared implementation:
  - Add `src/shared/kill-tree.js` exporting:
  - `killProcessTree(pid, opts) -> Promise<{terminated:boolean, forced:boolean, method?:string}>`
  - `killChildProcessTree(child, opts) -> Promise<...>` convenience (accepts `ChildProcess`)
  - Options:
    - `graceMs` (default 2000–5000, consistent with existing defaults)
    - `killSignal` (default `SIGTERM` on POSIX)
    - `forceSignal` (default `SIGKILL` on POSIX)
    - `useProcessGroup` / `detached` behavior (to decide `pid` vs `-pid`)
- Implement semantics:
  - **Windows**
    1) run `taskkill /PID <pid> /T` (no `/F`)
    2) wait `graceMs`
    3) run `taskkill /PID <pid> /T /F`
    4) return `{terminated, forced}`
  - **POSIX**
    1) send `killSignal` to **`-pid` when `useProcessGroup === true`**, else `pid`
    2) wait `graceMs`
    3) if still running, send `forceSignal` to same target
    4) return `{terminated, forced}`
- **(Refactor)** Replace kill logic in `src/shared/subprocess.js`
  - Remove the internal `killProcessTree(child, ...)` function.
  - Import the shared helper and call it on timeout/abort (fire-and-forget is acceptable; correctness is the priority).
  - Preserve current behavior regarding process groups:
    - default `detached=true` on POSIX
    - when `killTree !== false` and `detached===true`, use `useProcessGroup=true`
- **(Refactor)** Update all call sites that currently use either implementation:

  **Call sites to update (with current locations)**
  - `src/shared/subprocess.js`  
    - internal kill-tree function at/near line ~103; invoked on timeout/abort at/near lines ~268 and ~284.
  - `tests/helpers/kill-tree.js`  
    - staged kill-tree implementation; replace with a re-export from `src/shared/kill-tree.js` or delete and update imports.
    - `tests/runner/run-execution.js`  
      - imports `../helpers/kill-tree.js` and calls it during timeout (at/near line ~105).
  - `tools/bench/language/process.js`  
    - local `killProcessTree(pid)` (at/near line ~29); replace with shared helper and ensure POSIX uses process groups.
    - `tools/bench/language-repos.js`  
      - SIGINT/SIGTERM handlers call `processRunner.killProcessTree(active.pid)` (at/near lines ~236 and ~246); ensure this uses the shared helper.

- **(Doc)** Update any docs that describe kill semantics to reference the new shared module:
  - `docs/specs/subprocess-helper.md`
  - `docs/testing/test-runner-interface.md`
  - `docs/language/benchmarks.md`

**Primary touchpoints**
- `src/shared/kill-tree.js` (new)
- `src/shared/subprocess.js` (refactor)
- `tests/helpers/kill-tree.js` → re-export or delete
- `tests/runner/run-execution.js`
- `tools/bench/language/process.js`
- `tools/bench/language-repos.js`

#### 0.3 Refactor `build_index.js` for “clean JSONL” and stable final output
**Current issues**
- `build_index.js` uses `createDisplay(... progressMode: argv.progress ...)` (good), but also writes human summary lines directly to stderr after closing display (`DONE_LABEL`, detail lines).
- In `--progress jsonl`, those direct writes become “stray non-protocol lines” (the supervisor can wrap them, but this is not ideal).

**(Code)** Changes in `build_index.js`
- Add a single “output mode resolver”:
  - if `argv.progress === 'jsonl'`: **no raw stderr writes**; everything goes through `display.*` or protocol events.
  - if `argv.json === true`: stdout emits a single JSON summary object (see contract), stderr emits logs/progress only.
- Replace the post-close `writeLine()` summary behavior:
  - In JSONL mode:
    - emit a **`job:end`** protocol event with `result.summary` (no raw stderr lines).
  - In human/TTY mode:
    - keep the colored DONE banner.
- Ensure cancellation semantics are stable:
  - SIGINT/SIGTERM should set abort signal (already does)
  - on abort, exit **130** and emit a final `job:end` with `status:"cancelled"`

**Primary touchpoints**
- `build_index.js`
- `src/shared/cli/display.js`
- `src/shared/cli/progress-events.js`

#### 0.4 Refactor bench harness for TUI compatibility (`tools/bench/language-repos.js`)
**Current issues**
- Cancellation path uses the bench runner’s local kill helper which is not process-group aware on POSIX.
- The runner parses progress events using the current `parseProgressEventLine(line)` without a strict protocol marker.
- End-of-run `console.error(...)` summaries may still print even when in JSONL mode (should route via display or be gated).

**(Code)** Changes in:
- `tools/bench/language/process.js`
  - Replace chunk→line logic with shared `progress-stream` module once introduced (or implement a minimal shared decoder now).
  - Replace local kill-tree with `src/shared/kill-tree.js`.
  - Ensure parse rule becomes: **progress JSONL or wrap as log**.
- `tools/bench/language-repos.js`
  - Gate any raw `console.error` emissions when `argv.progress === 'jsonl'`:
    - replace with `display.log/error` so they are protocol events only
- Ensure JSON output (`--json`) remains stdout‑only and contains no interleaved junk.

**Primary touchpoints**
- `tools/bench/language-repos.js`
- `tools/bench/language/process.js`
- `src/shared/cli/progress-stream.js`

#### 0.5 Refactor `tools/setup/setup.js` to be “supervisor-friendly”
**Current issues**
- In `--json` mode, it tends to run child commands with `stdio:'pipe'`, which hides streaming progress.
- In non-JSON mode it uses `stdio:'inherit'`, which is incompatible with the “stdout-only JSON” contract if we want both streaming logs and a JSON summary.
- It uses a sync-ish command runner (`tools/cli-utils.js`) rather than a streaming runner.

**(Code)** Changes in `tools/setup/setup.js`
- Add `--progress`, `--verbose`, `--quiet` flags (mirror other tools).
- Create a `display = createDisplay({ progressMode: argv.progress, ... })` (stderr).
- Replace `log()/warn()` to route through `display.log/warn/error`.
- Refactor command execution to preserve stdout-only JSON:
  - Run child commands with `stdio: ['ignore','pipe','pipe']`.
  - Stream child stdout/stderr into `display` (so the user sees progress/logs in TUI).
  - Capture child stdout only when we explicitly need to parse it (e.g., `tooling-detect --json`).
- Ensure all child node tools are invoked with `--progress jsonl` when the parent is in JSONL mode (propagate progress mode).

**(Optional but ideal)** Split setup into:
- `setup --plan --json` (no side effects; returns structured plan)
- `setup --apply --json` (executes selected steps)
This enables the TUI to present/edit the plan before applying.

#### 0.6 Refactor `tools/setup/bootstrap.js` similarly
- Add `--progress`, `--json`, and ensure:
  - stdout JSON (if requested) is clean
  - child command outputs do not leak to stdout
  - progress is emitted as JSONL when requested
- Replace `stdio:'inherit'` child runs with pipe+forwarding (same reasoning as setup).

**Primary touchpoints**
- `tools/setup/setup.js`
- `tools/setup/bootstrap.js`
- `tools/tooling/install.js`
- `tools/tooling/detect.js`

#### 0.7 Normalize log routing and output safety across toolchain
- **(Code)** Ensure all tools invoked by setup/bootstrap (tooling install/detect, downloads) use:
  - `createDisplay()` for logs/progress
  - `--progress jsonl` pass-through
  - stderr-only output in JSONL mode
- **(Code)** Add a small helper to enforce “stdout is data”:
  - e.g., `src/shared/cli/stdout-guard.js` with a `withJsonStdoutGuard(fn)` wrapper
  - fail fast if any non-JSON bytes are written to stdout in `--json` mode

---

### Testing

#### 0.T1 Unit tests: kill-tree behavior (shared helper)
- **New test file(s)** (Node):
  - `tests/shared/kill-tree.posix.test.js` (skipped on win32)
  - `tests/shared/kill-tree.windows.test.js` (skipped on non-win32)
- **What to test**
  - POSIX: spawn a detached process group that ignores SIGTERM for a short interval, assert:
    - first SIGTERM sent, then SIGKILL after grace
    - return `{terminated:true, forced:true}`
  - Windows: spawn a child that spawns a grandchild, assert:
    - `taskkill /T` terminates tree (or `/F` after grace)
    - return values match reality (best-effort; Windows is inherently variable)
- **Pass criteria**
  - Tests do not leak orphan processes after completion.
  - Helper returns consistent termination metadata across platforms.

#### 0.T2 Tool contract tests (stdout/stderr discipline)
- **New integration tests**
  - `tests/tools/setup-json-output.test.js`
  - `tests/tools/bootstrap-json-output.test.js`
- **What to test**
  - Run each tool with `--json --non-interactive --progress jsonl` (or equivalent):
    - Assert stdout parses as a **single JSON document** (no extra lines).
    - Assert stderr is either:
      - valid JSONL protocol lines only (once protocol v2 lands), or
      - at minimum does not contain stdout JSON fragments.
- **Pass criteria**
  - Machine output is stable and parseable.
  - Progress/log output is streamable and does not corrupt stdout.

#### 0.T3 Bench harness cancellation regression
- **Test**: run a fixture bench job that spawns a long-lived child; send SIGTERM to parent; ensure tree terminates.
- **Pass criteria**
  - Bench script exits with the configured “cancelled” exit code.
  - No leftover child processes remain.

#### 0.T4 Tool stdout/stderr separation guards
- Add regression tests for setup/bootstrap/build_index in `--json` mode:
  - ensure stdout is a single JSON object
  - ensure stderr contains logs/progress only

---

## Sub-phase 1: Formalize progress protocol + shared parsing (strict boundary)

### Objective
Turn the existing “parse JSON else treat as log” convention into a **strict, versioned protocol** that:
- never misclassifies random JSON as a progress event
- carries enough context for supervision (jobId/runId)
- is reusable across Node scripts and the Rust TUI

### Tasks

#### 1.1 Progress protocol v2 (spec + enforcement)
- **(Spec)** Add `docs/specs/progress-protocol-v2.md`
  - Require:
    - `proto: "poc.progress@2"`
    - event allowlist (at minimum): `task:start`, `task:progress`, `task:end`, `log`, plus `job:*` events for supervisor (including `job:artifacts`)
    - field requirements per event type
    - rule: *one JSON object per line; no multi-line JSON in protocol stream*
  - Define how job/task identity is represented:
    - `jobId` (required for any event emitted under supervisor)
    - `runId` (optional but recommended for end-to-end correlation)
    - `taskId` uniqueness within a job
  - Define required fields per event type (minimum):
    - `log`: `level`, `message`, `stream`, `ts`, `seq`, `jobId?`, `taskId?`
    - `task:start`: `taskId`, `name`, `stage`, `ts`, `seq`, `jobId`
    - `task:progress`: `taskId`, `current`, `total`, `unit?`, `percent?`, `ts`, `seq`, `jobId`
    - `task:end`: `taskId`, `status`, `durationMs?`, `error?`, `ts`, `seq`, `jobId`
    - `job:start`: `jobId`, `command`, `args`, `cwd`, `ts`, `seq`
    - `job:end`: `jobId`, `status`, `exitCode`, `durationMs`, `result?`, `ts`, `seq`
    - `job:artifacts`: `jobId`, `artifacts[]`, `ts`, `seq`
  - Require `seq` monotonicity **per job** (if `jobId` exists) to allow stable ordering in TUI.
- **(Spec examples)** include concrete JSONL examples for each event type:
  - `log`:
    - `{"proto":"poc.progress@2","event":"log","ts":"2026-02-04T12:00:00.000Z","seq":42,"level":"info","stream":"stderr","message":"indexing started","jobId":"job-1"}`
  - `task:start`:
    - `{"proto":"poc.progress@2","event":"task:start","ts":"2026-02-04T12:00:00.010Z","seq":1,"jobId":"job-1","taskId":"code:scan","name":"Scanning code","stage":"code"}`
  - `task:progress`:
    - `{"proto":"poc.progress@2","event":"task:progress","ts":"2026-02-04T12:00:00.120Z","seq":2,"jobId":"job-1","taskId":"code:scan","current":24,"total":120,"unit":"files","percent":20}`
  - `task:end`:
    - `{"proto":"poc.progress@2","event":"task:end","ts":"2026-02-04T12:00:01.200Z","seq":3,"jobId":"job-1","taskId":"code:scan","status":"ok","durationMs":1190}`
  - `job:start`:
    - `{"proto":"poc.progress@2","event":"job:start","ts":"2026-02-04T12:00:00.000Z","seq":0,"jobId":"job-1","command":"build_index","args":["--progress","jsonl"],"cwd":"C:/repo"}`
  - `job:end`:
    - `{"proto":"poc.progress@2","event":"job:end","ts":"2026-02-04T12:00:10.000Z","seq":500,"jobId":"job-1","status":"ok","exitCode":0,"durationMs":10000,"result":{"summary":{"chunks":120}}}`
  - `job:artifacts`:
    - `{"proto":"poc.progress@2","event":"job:artifacts","ts":"2026-02-04T12:00:10.010Z","seq":501,"jobId":"job-1","artifacts":[{"kind":"index","label":"sqlite","path":"...","exists":true,"bytes":12345,"mtime":"2026-02-04T12:00:09.000Z","mime":"application/x-sqlite3"}]}`
- **(Code)** `src/shared/cli/progress-events.js`
  - `formatProgressEvent(eventName, payload, { context })`:
    - inject `proto`, `ts`, `seq`, and context fields (jobId/runId)
  - `parseProgressEventLine(line, { strict })`:
    - strict mode requires `proto` + allowlisted `event`
    - non-strict mode may be retained for backward compatibility, but must never accept arbitrary JSON
  - **Touchpoints for `seq` + `ts` fields**:
    - `src/shared/cli/progress-events.js` (default `ts`, increment `seq`)
    - `src/shared/cli/display.js` (when emitting `task:*` + `log` events)
    - `src/shared/cli/progress-stream.js` (when wrapping non‑protocol lines into `log`)
    - `tools/tui/supervisor.js` (inject `seq` for job events + wrapped logs)
    - `tools/bench/language/process.js` (decoder wrapper emits `log` events)
    - `tools/bench/language-repos.js` (direct `display` calls should not bypass `seq`)

#### 1.2 Context propagation (jobId/runId injection)
- **(Code)** `src/shared/cli/display.js`
  - Add a `context` option (object) and/or env-based context:
    - read `PAIROFCLEATS_PROGRESS_CONTEXT` (JSON string) once at init
  - Ensure `writeProgressEvent(...)` always includes merged context in JSONL mode
- **(Code)** Document how tools should set context:
  - Supervisor sets env var for children
  - Tools that spawn children should forward env var
- **(Code)** Add `PAIROFCLEATS_PROGRESS_CONTEXT` to `src/shared/env.js` allowlist
- **(Doc)** Document `PAIROFCLEATS_PROGRESS_CONTEXT` in `docs/config/contract.md` (env var surface)

#### 1.3 Shared stream decoder: “chunks → lines → event-or-log”
- **(Code)** Add `src/shared/cli/progress-stream.js`
  - Provide a small library that:
    - accepts chunks from stdout/stderr
    - normalizes CRLF/CR to LF
    - preserves partial-line carry buffers per stream
    - for each completed line:
      - try `parseProgressEventLine(line, { strict:true })`
      - else emit a `log` event wrapper (include original stream and jobId)
    - enforces `maxLineBytes` (default 1MB) and emits a `log` event when truncation occurs
- **(Refactor)** Replace duplicated logic:
  - Update `tools/bench/language/process.js` to use it
  - Supervisor will use it for all spawned jobs
  - (Optional) any other tool that decodes child output should use it

### Testing

#### 1.T1 Strict parser unit tests
- **Test cases**
  - Accept valid v2 event lines
  - Reject:
    - JSON without `proto`
    - JSON with unknown `proto`
    - JSON with unknown `.event`
    - invalid JSON
- **Pass criteria**
  - No false positives: a line like `{"ok":true}` must never become a progress event.

#### 1.T2 Stream decoder tests (chunk boundary correctness)
- **Test cases**
  - JSON split across two chunks → reconstructed correctly
  - CR-only outputs (some Windows tools) → normalized correctly
  - Interleaved stdout/stderr with partial lines → no cross-stream corruption
- **Pass criteria**
  - Every emitted object is a valid v2 protocol event.
  - No dropped characters; no duplicated lines.

#### 1.T3 Tool “clean JSONL” regression tests
- Run `build_index.js --progress jsonl ...` and `node tools/bench/language-repos.js --progress jsonl ...` in a fixture mode:
  - stderr must be all valid v2 JSONL events (once upgraded)
- Pass criteria:
  - no stray human lines in JSONL mode

#### 1.T4 Decoder line-size cap test
- Emit a single line larger than maxLineBytes and assert:
  - decoder truncates safely
  - emits a `log` event indicating truncation

#### 1.T5 Context propagation test
- Set `PAIROFCLEATS_PROGRESS_CONTEXT={"jobId":"j1","runId":"r1"}` and emit a JSONL event.
- Assert every emitted event includes the merged `jobId`/`runId`.

---

## Sub-phase 2: Node supervisor MVP (Rust TUI ↔ Node boundary)

### Objective
Implement a standalone Node supervisor that:
- accepts JSONL **requests** on stdin
- emits strict protocol **events** on stdout
- spawns/supervises repo scripts reliably, including cancellation

### Tasks

#### 2.1 Supervisor protocol (spec)
- **(Spec)** Add `docs/specs/node-supervisor-protocol.md`
  - Request ops (minimum):
    - `hello` / handshake
    - `job:run` (includes command, args, cwd, env, capture strategy)
    - `job:cancel`
    - `shutdown`
  - Event types:
    - `supervisor:hello`
    - `job:start`, `job:spawn`, `job:end`
    - passthrough progress `task:*` and `log`
  - `supervisor:hello` payload must include:
    - `protoVersion` (exact string, e.g., `poc.supervisor@1`)
    - `progressProto` (e.g., `poc.progress@2`)
    - `pid`, `platform`, `cwd`
    - `versions` (node, app version, optional git sha)
    - `capabilities` (supported commands + optional feature flags)
  - Define timeouts + escalation:
    - cancel → graceful wait → forced kill → `job:end status="cancelled"`

#### 2.2 Implementation: `tools/tui/supervisor.js`
- **Job table + lifecycle**
  - Maintain `Map<jobId, JobState>` with:
    - `abortController`
    - `childPid`, `spawnedAt`, `status`
    - bounded stdout capture buffer for “final JSON” parsing
  - Track per-job `seq` counters for ordering (used by progress events).
- **Limits & safety**
  - max stdout capture bytes (default 1MB)
  - max line size for decoder (shared `progress-stream` limit)
  - per-job log ring buffer size (e.g., 5k lines) for UI performance
- **Spawn strategy**
  - Use `spawnSubprocess()` with:
    - `stdio: ['ignore','pipe','pipe']`
    - `detached:true` on POSIX so we can kill process groups
    - `signal` wired to job abort controller
- **Output normalization**
  - For each stdout/stderr chunk:
    - run shared `progress-stream` decoder
    - emit only v2 protocol events to stdout
  - Ensure wrapped `log` events include `seq` and `stream` (`stdout`/`stderr`).
- **Context propagation**
  - Set `PAIROFCLEATS_PROGRESS_CONTEXT={"jobId":..., "runId":...}` in child env
  - Include `capabilities` in `supervisor:hello` by reading shared dispatch manifest.
- **Result capture**
  - Option A (simplest): if `job:run.captureStdoutAs=="json"`, buffer stdout and JSON.parse at end
  - Option B: always buffer up to N bytes and attempt parse if it looks like JSON
  - If JSON parse fails, emit `job:end` with `error` and include truncated stdout in `result.rawStdout` (bounded).
- **Robust shutdown**
  - On supervisor stdin close:
    - cancel all running jobs
    - wait bounded time
    - force-exit if necessary

**Supervisor failure modes (explicit handling)**
- child spawn fails → emit `job:end status="failed"` with `error.code="spawn_failed"`.
- child exits before `job:spawn` → still emit `job:end` with exitCode.
- malformed JSON from child → wrap as `log` event, do not crash supervisor.
- internal supervisor exception → emit `log level=error`, exit non-zero.

**Primary touchpoints**
- `tools/tui/supervisor.js` (new)
- `src/shared/subprocess.js` (spawn + abort wiring)
- `src/shared/kill-tree.js` (tree kill helper)
- `src/shared/cli/progress-stream.js` (line decoding)
- `src/shared/cli/progress-events.js` (strict parsing)
- `src/shared/cli/display.js` (context merge)

#### 2.3 Refactor dispatcher/env logic out of `bin/pairofcleats.js`
- **Why**: the supervisor must run the same jobs as the CLI entrypoint without drift, and search flags must not be blocked by dispatcher allowlists.
- **(Spec)** Follow `docs/specs/dispatcher-rewrite-and-search-reconciliation.md`.

**2.3.1 Immediate reconciliation (search flags)**
- **(Code)** In `bin/pairofcleats.js`:
  - remove `validateArgs(...)` from the `search` command handler
  - remove the manual backend allowlist (currently rejects `sqlite-fts`, `tantivy`, `memory`, `-n`)
  - pass all `rest` args through to `search.js` unchanged
- **(Tests)** Add a new integration test:
  - `node bin/pairofcleats.js search --help --backend tantivy` → exit 0
  - `node bin/pairofcleats.js search --help -n 10` → exit 0

**2.3.2 Shared dispatcher module**
- **(Code)** Create `src/shared/dispatch/`:
  - `registry.js` (command catalog + descriptions + expected outputs + artifact kinds)
  - `resolve.js` (argv → command resolution)
  - `env.js` (spawn env resolution; keep build_index runtime-envelope special case)
  - `manifest.js` (exports JSON manifest for the TUI)
- **(Code)** Update:
  - `bin/pairofcleats.js` to use shared dispatch
  - `tools/tui/supervisor.js` to use shared dispatch
- **(Code)** Update search option source-of-truth:
  - `src/retrieval/cli-args.js` should explicitly define the full search option surface (used by manifest + strict mode)
  - backend enum pulled from `src/storage/backend-policy.js`

**2.3.3 Manifest surface for TUI**
- Add new commands:
  - `pairofcleats dispatch list --json`
  - `pairofcleats dispatch describe <command> --json`
- Ensure `dispatch describe search` includes:
  - backend enum values: `auto`, `sqlite`, `sqlite-fts` (`fts`), `lmdb`, `tantivy`, `memory`
  - full search flag surface grouped for UI (see spec)
- Ensure each command description includes:
  - `supportsProgress` (jsonl/tty/log/off)
  - `supportsJson` and `supportsNonInteractive`
  - `artifacts` list (expected kinds + labels for preview)
  - `defaultArgs` (safe defaults for UI run palette)
- **Touchpoints for capability fields**
  - `src/shared/dispatch/registry.js` (single source of truth for `supports*`, `defaultArgs`, `artifacts`)
  - `src/shared/dispatch/manifest.js` (ensure fields are serialized)
  - `bin/pairofcleats.js` (dispatch describe uses shared manifest)
  - `tools/tui/supervisor.js` (`supervisor:hello` includes manifest summary)
  - `crates/pairofcleats-tui/` (run palette reads `supports*`, `defaultArgs`)
- **(Tests)** Add:
  - `tests/dispatch/manifest-list.test.js`
  - `tests/dispatch/manifest-describe-search.test.js`

**2.3.4 Optional strict mode (CI/hardening)**
- Add `PAIROFCLEATS_DISPATCH_STRICT=1` (or `--strict`) to enforce unknown-flag detection **only** when requested.
- In strict mode:
  - validate against the registry’s option list
  - for search, rely on the explicit option definitions in `src/retrieval/cli-args.js`

#### 2.4 Supervisor artifacts indexing pass (post-job)
- **(Spec)** Follow `docs/specs/supervisor-artifacts-indexing-pass.md`.
- **(Code)** Add a supervisor-side artifacts pass:
  - emit `job:artifacts` **after** `job:end`
  - artifact record shape:
    - `kind`, `label`, `path`, `exists`, `bytes`, `mtime`, `mime`
  - enforce performance budgets (no unbounded directory recursion)
  - only stat known paths; never glob the repo root
- **(Code)** Implement job-specific extractors:
  - `build_index.js` (index dirs, build_state.json, crash logs, sqlite/lmdb/tantivy outputs)
  - `search.js` (metrics dir + files from `recordSearchArtifacts()`)
  - `tools/setup/setup.js` (config file, dict/model/extension dirs)
  - `tools/bench/language-repos.js` (bench results dir + report JSON)
- **(Code)** Centralize extractor mapping in the dispatch registry so the TUI can preview artifacts before running.
- **(Code)** Add a `--artifacts json` option to supervisor for dump-only mode (used by tests).

### Testing

#### 2.T1 Supervisor stream discipline integration test
- Start supervisor, run a fixture job that emits:
  - progress JSONL events
  - plain log lines
  - non-protocol JSON
- Assert supervisor stdout:
  - is **only** JSONL v2 events
  - includes `jobId` on every event

#### 2.T2 Cancellation integration test (tree kill)
- Fixture job spawns a child + grandchild and sleeps.
- Send `job:cancel`.
- Assert:
  - `job:end` emitted exactly once
  - status is `cancelled`
  - processes terminate within bounded time

#### 2.T3 Env parity test vs CLI dispatcher
- For representative commands (index build, setup, bootstrap):
  - ensure supervisor resolves same script + env variables as `bin/pairofcleats.js`
- Pass criteria:
  - no “works in CLI but not in TUI” divergence

#### 2.T4 Artifacts pass smoke tests
- Run a small `build_index.js` and `search.js` via supervisor:
  - assert `job:artifacts` emitted
  - assert artifact list includes expected paths (index dirs, metrics files)
- Pass criteria:
  - artifacts are stable and do not require scanning the entire repo

#### 2.T5 Dispatch manifest tests
- `pairofcleats dispatch list --json` returns a stable command catalog.
- `pairofcleats dispatch describe search --json` includes backend enum + flag groups.

#### 2.T6 Search flag passthrough test
- `node bin/pairofcleats.js search --help --backend tantivy` exits 0
- `node bin/pairofcleats.js search --help -n 10` exits 0

---

## Sub-phase 3: Rust Ratatui TUI skeleton (terminal ownership + job UI)

### Objective
Create the Rust TUI that owns the terminal, talks to the supervisor, and renders:
- job list + job detail
- task table (taskId/name/current/total/status)
- log view (per job)

### Tasks

#### 3.1 Rust crate and core architecture
- Add `crates/pairofcleats-tui/`:
  - `ratatui`, `crossterm`, `tokio`, `serde`, `serde_json`, `anyhow`
- Add a workspace root `Cargo.toml` if one does not exist.
- Module layout (suggested):
  - `protocol/` (JSONL decoding + strongly typed events)
  - `supervisor/` (process spawn, request writer, event reader)
  - `model/` (jobs/tasks/log buffers)
  - `ui/` (widgets, layout)
  - `app.rs` (event loop)
- Command palette should be sourced from the supervisor `capabilities` + dispatch manifest (no hard-coded command lists in Rust).

#### 3.2 Supervisor integration
- Spawn `node tools/tui/supervisor.js` with piped stdin/stdout
- Perform `hello` handshake and validate protocol version
- Create:
  - async reader task: decode lines → events → channel
  - async writer: send requests for run/cancel/shutdown
- Ensure supervisor is restarted safely if it exits unexpectedly:
   - mark all running jobs failed
   - surface a clear UI error

#### 3.3 UI behaviors (MVP)
- Views:
  - Left: job list (status, start time, duration)
  - Right top: tasks (sorted by stage + recent updates)
  - Right bottom: logs (ring buffer, tailing)
  - Optional panel: artifacts list for the selected job (paths + sizes)
- UI model rules:
  - job list ordered by most recent activity
  - tasks grouped by `stage` then `name`
  - logs capped to N lines per job (configurable)
- Keybindings (minimum):
  - `r`: open “run command” palette (choose setup/index/search/bootstrap)
  - `c`: cancel selected job
  - `q`: quit (cancel all jobs, shutdown supervisor)
  - `?`: toggle help overlay (keybindings + status legend)
- Ensure TUI never relies on subprocess TTY:
  - always run jobs with piped stdio via supervisor

### Testing

#### 3.T1 Protocol decoding tests (Rust)
- Feed recorded JSONL streams into decoder:
  - job lifecycle + task updates + logs
- Assert model updates:
  - tasks created/updated/ended correctly
  - logs appended with correct job association

#### 3.T2 Headless smoke test
- Run TUI in a “headless” mode (no raw mode / no alternate screen) that:
  - starts supervisor
  - sends hello
  - sends shutdown
- Pass criteria:
  - exits 0
  - no panics
  - supervisor process does not remain running

#### 3.T3 Cancel path integration (Rust + supervisor)
- Start a long-running fixture job
- Issue cancel
- Assert model receives `job:end status=cancelled`

---

## Sub-phase 4: Cancellation hardening + cleanup correctness (end-to-end)

### Objective
Make cancellation robust under real-world failure modes:
- subprocesses that ignore SIGTERM
- children that spawn grandchildren
- supervisor shutdown while jobs are running
- UI crash/quit paths

### Tasks

#### 4.1 Supervisor escalation policies
- Ensure cancel logic uses shared kill-tree semantics (Sub-phase 0) and:
  - applies a bounded grace period
  - escalates to forced kill
  - emits clear termination metadata on `job:end`

#### 4.2 UI shutdown correctness
- On `q`:
  - cancel all running jobs
  - wait bounded time for `job:end` events
  - send supervisor shutdown
  - restore terminal state even if errors occur
- On `Ctrl+C`:
  - first press → cancel active job (or all jobs if none selected)
  - second press within grace window → force-exit (after restoring terminal)

#### 4.3 “Never hang” guarantees
- Add watchdog timeouts:
  - if supervisor does not respond, TUI exits after restoring terminal
  - if a job does not end after forced kill, mark failed and continue
- Add a hard cap on supervisor shutdown time (e.g., 10s total)

### Testing

#### 4.T1 “ignore SIGTERM” fixture
- Fixture job traps SIGTERM and sleeps
- Cancel job
- Assert:
  - forced kill occurs
  - job ends

#### 4.T2 “UI dies mid-job” fixture
- Simulate abrupt TUI termination (panic in test mode) and ensure:
  - supervisor is terminated by OS process tree rules or explicit cleanup handler
  - no orphan jobs remain (best-effort; document platform caveats)

---

## Sub-phase 5: Install/distribution (compile-on-install + prebuilt fallback)

### Objective
Make `pairofcleats-tui` easy to run after `npm install`, with secure fallback mechanisms:
- optional compile-on-install for developers
- prebuilt binaries for everyone else
- wrapper that provides clear instructions when binary is missing

### Tasks

#### 5.1 Installer + wrapper
- Implement `tools/tui/install.js` (see `docs/specs/tui-installation.md`)
  - opt-in compile: `PAIROFCLEATS_TUI_BUILD=1` or `npm_config_build_from_source=true`
  - allow opt-out: `PAIROFCLEATS_TUI_DISABLE=1`
  - optional profile: `PAIROFCLEATS_TUI_PROFILE=release|debug`
  - else download prebuilt for `{platform, arch}` and verify sha256
  - write `bin/native/manifest.json` describing installed binary and method
  - follow the same extraction safety limits as `tools/download/extensions.js`
- Implement `bin/pairofcleats-tui.js`
  - resolve `bin/native/pairofcleats-tui[.exe]`
  - exec it with args (inherit stdio)
  - if missing, print concise guidance:
    - re-run install with `PAIROFCLEATS_TUI_BUILD=1`
    - download prebuilt
    - fallback to `pairofcleats` Node CLI
- (Optional) add `tools/tui/download.js` to download prebuilt binaries explicitly
- Update `package.json`:
  - `bin.pairofcleats-tui`
  - `scripts.postinstall = "node tools/tui/install.js"`
- **Config surface (if downloads are configurable)**:
  - extend `.pairofcleats.json` with `tui.install.*` keys
  - document in `docs/config/schema.json` + `docs/config/contract.md`
- **Docs**
  - add `pairofcleats-tui` to `docs/guides/commands.md`
  - add a short `docs/guides/tui.md` with install + troubleshooting

**Primary touchpoints**
- `bin/pairofcleats-tui.js`
- `tools/tui/install.js`
- `package.json`
- `docs/specs/tui-installation.md`

#### 5.2 CI pipeline for artifacts
- Build for supported targets (at minimum: win32-x64, linux-x64, darwin-x64/arm64 if supported)
- Upload:
  - binaries
  - sha256 sums
  - manifest
- Ensure version aligns with `package.json` and `bin/native/manifest.json`

### Testing

#### 5.T1 Installer unit tests
- Simulate:
  - cargo present → build succeeds
  - cargo missing → download path taken
  - download sha mismatch → installer aborts with clear message
  - network unavailable → installer does not fail npm install
  - `PAIROFCLEATS_TUI_DISABLE=1` → installer no-ops cleanly
- Pass criteria:
  - correct binary selection and verified install metadata

#### 5.T2 Wrapper behavior tests
- If manifest exists → wrapper execs binary
- If missing → wrapper prints instructions and exits non-zero (or falls back to Node CLI if desired)

---

## Milestone 1 “Done” definition (updated)
Milestone 1 is complete when:

1) **Preparation complete**
- `build_index.js`, `tools/setup/setup.js`, `tools/setup/bootstrap.js`, and `tools/bench/language-repos.js` obey the “TUI tool contract”:
  - `--json` produces clean stdout JSON only
  - `--progress jsonl` produces protocol-safe stderr output (no stray lines)
- A unified `src/shared/kill-tree.js` exists and all call sites use it.

2) **Protocol + supervisor**
- Supervisor emits strict JSONL and can run at least:
  - `node tools/setup/setup.js --non-interactive --json --progress jsonl`
  - `node build_index.js --progress jsonl`
- Cancellation works and is covered by an integration test.
- Supervisor emits `job:artifacts` for completed jobs.
- `pairofcleats search` accepts all supported flags (no dispatcher allowlist).

3) **Rust TUI**
- TUI:
  - starts supervisor
  - runs a job
  - renders tasks + logs
  - cancels a job
  - exits without corrupting terminal state

