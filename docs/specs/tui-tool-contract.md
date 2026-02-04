# TUI Tool Contract (Supervisor-Compatible CLI Behavior)

This spec defines the minimum requirements for any CLI tool that will be executed under the Node supervisor and Rust TUI.

## Goals
- Deterministic, machine-readable output when requested.
- Strict separation of stdout data vs stderr logs/progress.
- Predictable cancellation semantics and exit codes.
- Compatibility with JSONL progress protocol v2.

## Scope (tools that must comply)
At minimum, any tool invoked by the supervisor/TUI MUST comply:
- `build_index.js`
- `tools/setup/setup.js`
- `tools/setup/bootstrap.js`
- `tools/bench/language-repos.js` (+ `tools/bench/language/process.js`)
- `search.js` (via `bin/pairofcleats.js search`)
- `tools/tooling/install.js`, `tools/tooling/detect.js`
- `tools/download/dicts.js`, `tools/download/models.js`, `tools/download/extensions.js`
- `tools/analysis/*` commands surfaced in the dispatch manifest

## Required flags
Tools that produce machine output or long-running work MUST support:
- `--progress {off,log,tty,jsonl,auto}`
- `--json` (when they have a meaningful machine-readable result)
- `--non-interactive` (if they would otherwise prompt)

## Output rules
- **stdout**
  - When `--json` is used: emit exactly **one** JSON object on stdout.
  - No additional stdout lines in `--json` mode.
  - Enforce with a **stdout guard** (fail fast if non‑JSON bytes are written).
- **stderr**
  - Human logs and progress only.
  - When `--progress jsonl`: stderr must emit **only** JSONL protocol events (v2).

## Cancellation
- Tools MUST respond to SIGINT/SIGTERM by:
  - aborting ongoing work,
  - emitting a final progress event (if in JSONL mode),
  - exiting with **code 130** (normalized cancel code).
- Child processes must be terminated as a tree (use shared kill-tree helper).

## Progress protocol v2
- When `--progress jsonl` is active, emitted events must conform to:
  - `docs/specs/progress-protocol-v2.md`
- Tools SHOULD use `createDisplay()` and never write raw lines directly to stderr in JSONL mode.
- All events MUST include `ts` and `seq` (monotonic per job when `jobId` exists).

## Progress context propagation
- Tools SHOULD merge `PAIROFCLEATS_PROGRESS_CONTEXT` into every JSONL event.
- The value is a JSON string containing `runId` and `jobId`.

## Child process propagation
- When a tool invokes another tool in JSONL mode:
  - Propagate `--progress jsonl`.
  - Forward `PAIROFCLEATS_PROGRESS_CONTEXT` to the child.
  - Use piped stdio and forward child output into the parent display.
  - **Never** use `stdio: 'inherit'` when `--json` or `--progress jsonl` is active.

## Exit codes
- `0`: success
- `130`: user cancel
- `1`: expected failure (validation, missing inputs, etc)
- `2`: tool bug or invariant violation (e.g., stdout guard tripped)

## Examples
**`--json` output (stdout only)**
```json
{"ok":true,"result":{"chunks":120,"files":42}}
```

**`--progress jsonl` log event (stderr only)**
```json
{"proto":"poc.progress@2","event":"log","ts":"2026-02-04T12:00:00.030Z","seq":6,"runId":"run-1","jobId":"job-1","level":"info","stream":"stderr","message":"indexing started"}
```

## Test coverage (minimum)
- JSON output discipline (`--json` emits one object, no extra lines)
- JSONL discipline (`--progress jsonl` emits only protocol lines)
- Cancellation exit code is 130
- Stdout guard triggers on non‑JSON bytes in `--json` mode
