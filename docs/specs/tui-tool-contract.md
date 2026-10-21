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
  - Enforce with a **stdout guard** (fail fast if non‑JSON bytes are written) via `src/shared/cli/stdout-guard.js`.
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

## Internal settings requests

See also the internal search operator below. Native workflow acceptance is
tracked separately from a supervisor operation's contract checks.

The local `poc.tui@1` supervisor advertises `supportsSettings` when it implements
`settings:run`. A request contains only `proto`, `op`, a bounded `jobId`, `method`
and `params`. Methods are `select`, `inspect`, `preview`, `commit` and `cancel`;
their strict shapes are owned by `src/contracts/schemas/tui-settings.js` and its
validator. Selection returns an opaque scope ID. Inspection returns verified file
and schema revisions; previews bind those revisions to a bounded, expiring nonce.
Commits require confirmation, with literal `RESET` additionally required for reset.

These operations use the existing job registry, cancellation and shutdown owner,
emit ordinary `job:start` / `job:end` progress events with `internal: true`, and
return `{method,data}` with `resultState: complete` on completion. A completed
validation request may return `data.ok: false`; it has not saved anything. Raw
request parameters, configuration source and subprocess/parser error messages
never enter operation events. Errors expose bounded codes. Results are limited
to 1 MiB, operations have a 15-second lifetime, and canonical inspection children
retain their 10-second limit. Existing progress chunking handles larger records.
No retries are introduced. Cancellation cannot undo an atomic save or completed
scope selection. The supervisor rejects new work once shutdown begins.

The native view routes its own request IDs before foreground job selection and
accepts settings only in a controllable supervised session. Configuration preview
and observed runtime/provider qualification remain distinct.

## Native job selection and input ownership

Native job selection is separate from viewport scrolling and log follow. Manual
selection stays pinned under concurrent job updates and filtering. Cancellation
requires a visible running selection in a verified controllable supervised
session; expired/reused identities must be reselected. Task identity is the exact
job/task pair, including delimiter characters, and logs retain their job owner.
Starting another instance of a completed job ID clears its prior task/log view
and cannot rearm an old selection. Distinct key presses retain FIFO order;
the 40 ms debounce applies only to hardware repeat. Enqueueing input cannot reset
the separate dispatch clock. Release events and repeated global interrupts keep
their existing suppression/shutdown semantics.

## Internal search requests

The local supervisor advertises `supportsSearch` for `search:run`. The strict
envelope contains `proto: "poc.tui@1"`, `op`, a bounded `jobId`, `method` and
`params`; its owner is `src/contracts/schemas/tui-search.js`. The methods are:

- `describe`: `{}`. Returns a copy of the canonical search predicate schema,
  result modes, defaults and operator limits. Operator-owned repository/output/
  cursor fields are excluded; callers cannot mutate the shared validator.
- `query`: `{ repoPath, search }`. The predicate object uses the canonical API
  search validator and shared CLI argument builder. It retains all shared filters,
  mode/backend/top selection and snapshot/as-of exclusivity. Repository identity,
  output selection and continuation tokens belong to the operator; those fields
  cannot be supplied inside `search`.
- `continue`: `{ resultId }`. Only the current query's last canonical cursor can
  advance. Ranked text searches retain the CLI's top-k behavior; filter-only
  queries expose supported continuation. Repeated hit identities are rejected.
- `source`: `{ resultId, hitId }`. Only a hit from the current query can select a
  file. The existing contained-descriptor/excerpt owner enforces repository and
  symlink authority, verifies current bytes, and labels indexed/current drift as
  unchanged, changed or unknown. Missing and oversized files have explicit
  unavailable results. Historical index selection does not reconstruct source
  bytes; the preview identifies its working-tree policy.
- `open`: `{ resultId, hitId, sourceHash, editor: "code", confirmed: true }`.
  Requires the selected preview's current hash and explicit confirmation. The
  operator rechecks contained source bytes and lexical/physical command trust
  before launching `code --reuse-window --goto file:line:1`. Missing, stale,
  symlinked or untrusted targets fail before execution. The tracked launcher has
  a five-second deadline and bounded capture; disposal joins its cleanup.

Responses bind an opaque result/scope identity and query generation to ordered
  per-mode ranks, scores, paths, ranges, canonical freshness/pagination and output
  budget evidence. Query replacement aborts prior work and rejects late results.
  Source extraction is capped at 16 KiB/4096 tokens; the canonical source read remains
  capped at 64 MiB. A query retains at most 500 hits/768 KiB. Incomplete JSON or
  capture fails rather than becoming a successful partial result; canonical
  output-budget omissions remain visible. These are internal resource bounds,
  with no new repository configuration or CLI options.

Operations use the existing job cancellation, output, timeout and shutdown
  owners. `job:spawn` records an actual child PID; awaited cancellation/disposal
  joins child cleanup. The strict shared JSON request boundary preserves the
  existing settings limits. The native `[R]` composer, ranked results, cursor
  continuation, source viewport and confirmed editor navigation use this same
  owner. Query/source identity guards reject superseded replies; scope changes
  invalidate the view. `/` remains panel text filtering. Native ConPTY cases
  exercise real keys, supervisor/CLI children and terminal cleanup on Windows;
  portable contract tests and Rust rendering tests do not replace native platform
  execution or the separately privileged file-symlink authority cohort.
