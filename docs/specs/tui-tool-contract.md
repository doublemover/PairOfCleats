# TUI Tool Contract (Supervisor-Compatible CLI Behavior)

This spec defines the minimum requirements for any CLI tool that will be executed under the Node supervisor and Rust TUI.

## Goals
- Deterministic, machine-readable output when requested.
- Strict separation of stdout data vs stderr logs/progress.
- Predictable cancellation semantics and exit codes.
- Compatibility with JSONL progress protocol v2.

## Required flags
Tools that produce machine output or long-running work MUST support:
- `--progress {off,log,tty,jsonl,auto}`
- `--json` (when they have a meaningful machine-readable result)
- `--non-interactive` (if they would otherwise prompt)

## Output rules
- **stdout**
  - When `--json` is used: emit exactly **one** JSON object on stdout.
  - No additional stdout lines in `--json` mode.
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

## Progress context propagation
- Tools SHOULD merge `PAIROFCLEATS_PROGRESS_CONTEXT` into every JSONL event.
- The value is a JSON string containing `runId` and `jobId`.

## Child process propagation
- When a tool invokes another tool in JSONL mode:
  - Propagate `--progress jsonl`.
  - Forward `PAIROFCLEATS_PROGRESS_CONTEXT` to the child.
  - Use piped stdio and forward child output into the parent display.

## Exit codes
- `0`: success
- `130`: user cancel
- `1`: expected failure (validation, missing inputs, etc)

## Test coverage (minimum)
- JSON output discipline (`--json` emits one object, no extra lines)
- JSONL discipline (`--progress jsonl` emits only protocol lines)
- Cancellation exit code is 130
