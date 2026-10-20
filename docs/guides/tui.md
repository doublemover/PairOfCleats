# TUI Guide

Status: active  
Last updated: 2026-10-20T00:00:00Z

## Commands

- Build and stage target artifacts explicitly: `pairofcleats tui build`
- Install target binary (auto-builds the host target when staging is missing): `pairofcleats tui install`
- Run supervisor directly: `pairofcleats tui supervisor`
- Launch native TUI wrapper: `pairofcleats-tui`

## Typical flow

1. `pairofcleats tui install`
2. `pairofcleats-tui`

Use `pairofcleats tui build --smoke` when you want to validate or restage the host artifact explicitly without installing it yet.

Runtime controls:

- `[r]` queue job run
- `[s]` select a repository/workspace and inspect or edit settings
- `[c]` cancel selected job
- `[q]` graceful shutdown
- `[Ctrl+C]` global graceful shutdown, including help, palette and search overlays;
  queued interactions are discarded before supervisor shutdown. Plain `[c]` retains
  selected-job cancellation outside overlays.
- `[Tab]` cycle focus between jobs, tasks, and logs
- `[1]`, `[2]`, `[3]` focus jobs, tasks, or logs directly
- `[f]` cycle the active panel filter
- `[/]` open search for the active panel
- `[x]` clear the active search
- `[p]` toggle follow live / pause selection drift
- `[:]` or `[a]` open the action palette
- `[?]` open the in-app help overlay
- `[j]/[k]` log viewport scroll
- `[n]/[m]` job viewport scroll
- `[u]/[i]` task viewport scroll

Jobs and tasks scroll through their filtered rows with `[n]/[u]` and return with
`[m]/[i]`; offsets clamp to the available window. Logs show the newest wrapped
lines in chronological order. `[j]` moves toward older matching entries and `[k]`
returns toward newer ones. Pause preserves that filtered position as logs arrive;
resuming follow returns to the newest entry. History remains bounded by the ring.

Quit and terminal errors request supervisor shutdown, drain final job events, and
reap the supervisor within its ten-second grace. The native lifetime guard then
contains any remaining owned descendants. Snapshots save the resulting final job
statuses; an interrupted supervisor cannot leave a saved job marked running.
Linux, macOS, and Windows require separate native lifecycle receipts.

## Repository, workspace and settings

Press `[s]` or select **Repository / workspace and settings** in the action palette.
The selector accepts a repository directory or a workspace file; `[Tab]` changes
the kind and `[Ctrl+U]` clears the input. The current scope remains visible in the
session header and settings view. A new command captures its selected directory;
changing selection does not retarget an existing job.

After selection, the view loads the canonical schema and runs `config dump` in a
fresh child. Fields show repository overrides, recorded effective values and schema
defaults; `[p]` shows the canonical source/provenance and resolved policy record.
An absent value in the bounded dump is labelled unrecorded. This configuration
preview does not establish that a model, provider or runtime operation is ready.
Workspace configuration edits apply to the workspace directory's repository
configuration, rather than rewriting the workspace membership file.

Use `[/]` to filter field names, arrows to select and `[Enter]` to edit a JSON
value. `[Ctrl+U]` clears the draft. `[Enter]` validates and displays a diff; a second
`[Enter]` confirms publication. `[Esc]` discards the draft or cancels its preview.
`[r]` reloads actual configuration. Invalid values and stale file/schema revisions
cannot be saved; reload after an external edit. Unrelated fields and comments
survive ordinary edits. Sensitive fields and launch-policy-controlled values stay
read only; use a private editor for credentials or raw provider commands/arguments.

`[R]` previews replacement with the canonical default template. Review the diff
and backup location, type literal `RESET`, then press `[Enter]`. Reset preserves
the original bytes in its backup, including an undecodable original file. The
preview explicitly reports whether an existing backup would be replaced.

An in-flight request accepts `[Esc]` cancellation and waits for its actual outcome;
a save or scope selection that already completed remains committed. `[Ctrl+C]`
uses global graceful shutdown. Settings require a controllable supervisor advertising
`supportsSettings`; passive/replay sessions cannot execute these actions. Settings
drafts/responses stay outside saved layout snapshots and foreground job selection.

Result capture uses the requested byte cap, including Unicode bytes. Job completion
and result completeness are independent: `resultState` is `disabled`, `complete`,
`truncated`, or `invalid-json` (and `incomplete` for interrupted collection).
Truncated or invalid JSON returns no parsed result. `resultCapture` reports observed,
retained, dropped, and serialized output bytes. Disabled capture retains no result
bytes; progress and logs continue through the existing bounded protocol.

The live UI now exposes an explicit session header so operators can tell:

- attachment mode (`supervised`, `replay`, `external-observability`)
- source (`local-supervisor`, `event-log`, `passive-stream`)
- connection state
- run id and current scope
- last durable alert

Presentation behavior:

- narrow terminals stack jobs, tasks, and logs vertically instead of squeezing three unreadable columns
- runtime events are summarized into operator-facing text instead of raw JSON by default
- workload-specific summaries sit above the main panes so bench, indexing, and service sessions show the active repo, stage/queue state, and degraded conditions without log-reading first
- logs wrap/truncate to pane width, while job/task rows use concise status summaries
- no-color mode remains readable without relying on decorative styling
- filters and search operate on the focused panel so operators can isolate failures, active work, or specific provider text quickly
- follow mode can be paused so active sessions stop stealing focus while you inspect a failed job or log line
- the action palette and help overlay expose the available controls without leaving the terminal

Workload summaries:

- `Bench` sessions surface active repo, tier/lane, degraded providers, retained crash count, import/quality pressure, and the latest stall/timeout hints when available
- `Indexing` sessions surface repo, stage, mode, sqlite/validation/promotion state, heartbeat freshness, and artifact-write progress when available
- `Service` sessions surface service name, queue depth, active jobs/workers, retries, quarantine state, and shutdown posture when available

## Install layout

Default install root is under the PairOfCleats cache root:

- `<cacheRoot>/tui/install-v1/<triple>/bin/<artifactName>`
- `<cacheRoot>/tui/install-v1/<triple>/install-manifest.json`
- `<cacheRoot>/tui/install-v1/<triple>/logs/`

Default cache root follows the normal PairOfCleats cache-root policy:

- Windows: `%LOCALAPPDATA%/PairOfCleats/cache`
- Linux/macOS with `XDG_CACHE_HOME`: `$XDG_CACHE_HOME/pairofcleats/cache`
- otherwise: `~/.cache/pairofcleats/cache`

Override root with:

- `PAIROFCLEATS_TUI_INSTALL_ROOT`
- or `pairofcleats tui install --install-root <path>`

## Validation behavior

Before launch, wrapper verifies:

- target row from `tools/tui/targets.json`
- install manifest shape/target match
- binary existence + executable metadata
- installed checksum vs install manifest
- installed checksum vs build manifest (when available)

On failure, wrapper exits non-zero with repair hints.

## Local Rust verification

Use the crate's exact Rust toolchain from the repository root. `--manifest-path`
selects the manifest; the explicit toolchain selector keeps these checks on the
same compiler as the declared MSRV and CI.

For source-checkout validation of the TUI crate, run:

- `cargo +1.88.0 fmt --check --manifest-path .\crates\pairofcleats-tui\Cargo.toml`
- `cargo +1.88.0 check --locked --manifest-path .\crates\pairofcleats-tui\Cargo.toml`
- `cargo +1.88.0 test --locked --manifest-path .\crates\pairofcleats-tui\Cargo.toml`
- `cargo +1.88.0 clippy --locked --manifest-path .\crates\pairofcleats-tui\Cargo.toml -- -D warnings`

## Observability

Wrapper injects:

- `PAIROFCLEATS_TUI_RUN_ID`
- `PAIROFCLEATS_TUI_EVENT_LOG_DIR`

Supervisor writes replay logs:

- `<eventLogDir>/<runId>.jsonl`
- `<eventLogDir>/<runId>.meta.json`
- `<eventLogDir>/<runId>.runtime.jsonl`

Set a custom event log directory with:

- `pairofcleats tui install --event-log-dir <path>`
- or `PAIROFCLEATS_TUI_EVENT_LOG_DIR=<path>`

Session snapshot restore path:

- default `<cacheRoot>/tui/last-state.json`
- override with `PAIROFCLEATS_TUI_SNAPSHOT_PATH`

## Frame Capture Harness

For deterministic operator-view snapshots without launching the live TUI, run:

- `node tools/tui/capture-fixtures.js`

By default this replays fixture-backed sessions and writes frame artifacts under:

- `.testLogs/tui/frame-capture/`

Each fixture emits:

- `capture-manifest.json`
- one `*.frame.txt` file per capture + terminal variant
- one `*.frame.json` metadata file per capture + terminal variant

The metadata includes:

- terminal width/height
- color and unicode mode
- selected job and scroll offsets
- job/task/log counts
- style runs for non-default colors/modifiers

Use `node tools/tui/capture-fixtures.js --list` to see the bundled fixtures, or `--fixture <path>` / `--out-dir <path>` to target a specific capture set or output root.

## Related specs

- `docs/specs/tui-installation.md`
- `docs/specs/tui-build-and-release.md`
- `docs/specs/node-supervisor-protocol.md`
- `docs/specs/progress-protocol-v2.md`
- `docs/specs/tui-performance-and-backpressure.md`

## Session refinement recovery

The saved session restores the selected job, panel search strings, job/task/log filters, focused panel, follow setting, and scroll offsets. Older snapshots without these fields retain the normal defaults. An unfinished search draft is not committed by recovery; reopen search to refine the restored filter. This restores UI state, not running jobs or index freshness.
