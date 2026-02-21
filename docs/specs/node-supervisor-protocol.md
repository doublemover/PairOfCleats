# Node Supervisor Protocol (Rust TUI ↔ Node)

This spec defines the **stdio protocol** between the Rust Ratatui TUI (parent) and a dedicated Node **supervisor** (child). The supervisor is responsible for spawning and supervising *repo scripts* and emitting a **strict** JSONL progress stream.

> Related:
> - `docs/specs/progress-protocol-v2.md` (event schema)
> - `docs/specs/tui-tool-contract.md` (tool stdout/stderr + exit codes)
> - `docs/specs/supervisor-artifacts-indexing-pass.md` (artifact discovery + `job:artifacts`)
> - `bin/pairofcleats.js` (command dispatch + env shaping)
> - `src/shared/subprocess.js` + `src/shared/kill-tree.js` (spawn + tree kill)

---

## 1) Roles & responsibilities

### Rust TUI (parent)
- Owns terminal/TTY.
- Starts exactly one supervisor process per session.
- Sends JSONL requests to supervisor stdin.
- Reads JSONL events from supervisor stdout.
- On Ctrl+C or UI quit: requests `shutdown`.

### Node Supervisor (child)
- Owns job supervision:
  - spawn child processes
  - parse/wrap outputs into protocol events
  - cancellation and process-tree cleanup
- MUST write **only protocol JSONL** to stdout.

### Repo scripts (grandchildren)
- Can be any existing Node scripts:
  - some already emit progress JSONL via `createDisplay()` (`src/shared/cli/display.js`)
  - others are plain text / JSON-on-stdout
- Supervisor normalizes output into the protocol.

---

## 2) Process model

```
+---------------------+           stdin(JSONL)            +----------------------+
| Rust TUI (ratatui)  |  --------------------------------> | Node supervisor      |
| owns terminal       |           stdout(JSONL)           | owns subprocess trees|
| parses events       |  <-------------------------------- | spawns scripts       |
+---------------------+                                    +----------+----------+
                                                                      |
                                                                      | spawn
                                                                      v
                                                            +-------------------+
                                                            | repo script(s)    |
                                                            | (build_index, ...)|
                                                            +-------------------+
```

Supervisor MUST:
- cancel all active jobs when:
  - it receives `shutdown`, or
  - its stdin closes, or
  - it receives SIGTERM/SIGINT.

---

## 3) Wire format

### 3.1 Requests (Rust → Supervisor)
- JSON object per line on **stdin**.
- Must include:
  - `proto: "poc.tui@1"`
  - `op`: string

### 3.2 Events & responses (Supervisor → Rust)
- JSON object per line on **stdout**.
- MUST conform to **Progress Protocol v2** (`docs/specs/progress-protocol-v2.md`):
  - `proto: "poc.progress@2"`
  - `event`: allowlisted
  - `runId`, `seq`, `ts`, etc

> Supervisor may choose to also emit explicit `response:*` events, but for the MVP it’s fine to respond only via `job:*` events plus `log`.

---

## 4) Supervisor request API

### 4.1 `hello`
Rust → supervisor:
```json
{"proto":"poc.tui@1","op":"hello","client":{"name":"pairofcleats-tui","version":"0.1.0"}}
```

Supervisor MUST respond by emitting `event:"hello"` (progress protocol), containing capabilities.

### 4.2 `job:run`
Starts a new supervised job.

Request fields:
| Field | Type | Required | Notes |
|---|---|---:|---|
| `jobId` | string | ✅ | Provided by Rust; stable identifier for UI |
| `title` | string | ✅ | Human label (“Build index”, “Setup”, …) |
| `argv` | string[] | ✅ | “pairofcleats-style” argv, e.g. `["index","build","--repo","..."]` |
| `cwd` | string | ⛔️ | defaults to Rust-provided cwd |
| `repoRoot` | string | ⛔️ | if omitted, supervisor resolves via `resolveRepoRoot(cwd)` |
| `progressMode` | `"jsonl"`\|`"off"` | ⛔️ | default `"jsonl"` |
| `resultPolicy` | object | ⛔️ | see below |
| `envPatch` | object | ⛔️ | additional env vars |

#### Result policy
Some scripts (e.g. `tools/setup/setup.js --json`) emit a final JSON payload on stdout.
To support this, requests may include:

```json
"resultPolicy": {
  "captureStdout": "none" | "text" | "json",
  "maxBytes": 1000000
}
```

Defaults:
- `captureStdout: "none"` for large-output commands
- `captureStdout: "json"` for “setup/config dump” style commands

### 4.3 `job:cancel`
Cancels an active job. Must be idempotent.

```json
{"proto":"poc.tui@1","op":"job:cancel","jobId":"job-123","reason":"user_cancel"}
```

Supervisor behavior:
- If job is running:
  - initiate graceful cancellation
  - emit `job:end` with `status:"cancelled"` and `exitCode:130` when done
- If already ended:
  - no-op (optionally log)

### 4.4 `shutdown`
Graceful supervisor shutdown.

```json
{"proto":"poc.tui@1","op":"shutdown","reason":"ui_exit"}
```

Supervisor behavior:
- cancel all running jobs
- emit final `log` lines as needed
- exit 0

---

## 5) Job spawning & env resolution

### 5.1 Command resolution
Supervisor should reuse the existing CLI dispatcher behavior:

- `bin/pairofcleats.js` has:
  - `resolveCommand(primary, rest)` mapping high-level commands to scripts:
    - `index build|watch|validate`
    - `search`
    - `setup`
    - `bootstrap`
    - `service api`
    - `tooling doctor`
    - `lmdb build`
  - `runScript()` that:
    - resolves `repoRoot`
    - loads user config
    - resolves runtime env
    - **special-cases `build_index.js`** to compute a runtime envelope and derive env (`resolveRuntimeEnvelope()` and `resolveRuntimeEnvFromEnvelope()`).

**Spec requirement:** Extract these into a shared module so both:
- `bin/pairofcleats.js` (legacy CLI)
- `tools/tui/supervisor.js`
use the same resolution and env logic.

Suggested module: `src/shared/dispatch/pairofcleats-dispatch.js`.

### 5.2 Progress context propagation
To ensure child-emitted events include `jobId`:
- Supervisor SHOULD set:
  - `PAIROFCLEATS_PROGRESS_CONTEXT='{"runId":"...","jobId":"..."}'`
- `createDisplay()` SHOULD merge this into each event it emits.

This is a low-touch change to `src/shared/cli/display.js`. Add the env var to `src/shared/env.js` so it passes env usage guardrails.

---

## 6) Output parsing and wrapping

### 6.1 Decoder
Supervisor MUST treat child stdout and stderr as byte streams and decode into lines using the same rules as `tools/bench/language/process.js`:
- normalize `\r\n` and `\r` to `\n`
- maintain carry buffer per stream
- handle final flush

Recommended: implement shared module `src/shared/cli/progress-stream.js` and reuse it here and in the bench harness.

### 6.2 Parsing priority
For each decoded line:
1. Try `parseProgressEventLine(line, { strict: true })`
2. If not an event, wrap into `event:"log"`:
   - include `stream`, `pid`, `jobId`, `runId`
   - infer `level` by heuristics, else default

### 6.3 Emission discipline
- Supervisor stdout MUST only be protocol events.
- Supervisor stderr MAY be used for supervisor-local debug logs, but SHOULD be avoided (Rust owns terminal).

---

## 7) Cancellation & process-tree cleanup

### 7.1 Correctness requirements
- Cancel must terminate the entire subprocess tree.
- Must work on:
  - Windows (taskkill)
  - POSIX (SIGTERM/SIGKILL; prefer process group kills)

### 7.2 Preferred implementation approach
Use repo’s existing `spawnSubprocess()` (`src/shared/subprocess.js`) per job:
- provide `signal: abortController.signal`
- keep reference to child PID via `onSpawn(child)` callback
- on cancel, call `abortController.abort("cancel")`

**Windows behavior alignment**
- Shared helper `src/shared/kill-tree.js` must:
  - `taskkill /T` then `taskkill /T /F` after grace
- `src/shared/subprocess.js` should delegate to the shared helper so all call sites behave consistently.

### 7.3 Supervisor lifecycle
- On `shutdown` or stdin close:
  - cancel all jobs
  - wait up to a fixed timeout (e.g. 10s total)
  - then exit

---

## 8) Event mapping (supervisor output)

Supervisor MUST emit at least:
- `hello` once
- `job:start` when job accepted
- `job:spawn` when child started (pid known)
- forwarded child events (`task:*`, `log`)
- `job:end` exactly once, containing exit code/signal/duration and optional result
- `job:artifacts` after `job:end` when artifact indexing is enabled

---

## 9) Implementation sketch (repo mapping)

### New files
- `tools/tui/supervisor.js` — supervisor entrypoint
- `src/shared/dispatch/pairofcleats-dispatch.js` — extracted dispatch/env logic
- `src/shared/cli/progress-stream.js` — shared line decoder + protocol wrapper

### Modified files
- `bin/pairofcleats.js` — import and use shared dispatch module
- `src/shared/cli/progress-events.js` — strict parsing + proto + job events
- `src/shared/cli/display.js` — progress context merge (jobId/runId)

---

## 10) Test requirements
- Supervisor emits only strict JSONL to stdout (no stray prints).
- Cancellation test spawns a child that spawns a grandchild; cancel must kill both.
- Protocol tests ensure unknown JSON isn’t misparsed as events.

---

## 11) Observability contract

When `PAIROFCLEATS_TUI_EVENT_LOG_DIR` is set, supervisor must write replay artifacts:

- `<eventLogDir>/<runId>.jsonl` containing the exact emitted protocol stream
- `<eventLogDir>/<runId>.meta.json` with run/session metadata

`PAIROFCLEATS_TUI_RUN_ID` may be provided by the wrapper; otherwise supervisor generates one.
