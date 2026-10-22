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

- `[R]` search a repository and inspect results/source
- `[r]` run the search command's help as a job
- `[s]` select a repository/workspace and inspect or edit settings
- `[b]` open typed index/workspace workflows, inspect readiness and preview a launch
- `[c]` cancel selected job
- `[v]` inspect the selected job's outcome, captured result and recorded artifacts
- `[q]` graceful shutdown
- `[Ctrl+C]` global graceful shutdown, including help, palette and search overlays;
  queued interactions are discarded before supervisor shutdown. Plain `[c]` retains
  selected-job cancellation outside overlays.
- `[Tab]` cycle focus between jobs, tasks, and logs
- `[1]`, `[2]`, `[3]` focus jobs, tasks, or logs directly
- `[` / `]` (bracket keys), or arrows while jobs have focus, select the previous/next visible job
- `[g]` resume following newly updated jobs
- `[f]` cycle the active panel filter
- `[/]` filter text in the active panel
- `[x]` clear the active search
- `[p]` toggle live log follow / pause the log viewport
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

Explicit job selection pins its identity as new events arrive; log pause/follow
and viewport scrolling do not change that pin. `>` marks the selected row even
without color. Tasks and job-specific logs belong to the selected job; session
logs remain visible. Filters can hide a selection but cannot silently replace it.
Cancel requires a visible running selection and the verified supervised control
channel. An evicted selection or a reused completed job ID is unavailable until
explicitly reselected; old task/log history cannot become the replacement's data.
`[g]` releases the pin and selects the latest visible job. Recovery restores a
selection only when that job is known in the current session.

Quit and terminal errors request supervisor shutdown, drain final job events, and
reap the supervisor within its ten-second grace. The native lifetime guard then
contains any remaining owned descendants. Snapshots save the resulting final job
statuses; an interrupted supervisor cannot leave a saved job marked running.
Linux, macOS, and Windows require separate native lifecycle receipts.

## Job inspection

Press `[v]` or choose **Inspect selected job result and artifacts** in the palette. Inspection pins the
visible selected job. `[1]`, `[2]` and `[3]` select summary, result and artifact
pages; `[Tab]` cycles pages and `[Esc]` returns. Arrows, page keys and `[j]/[k]`
scroll or select artifacts, left/right pan, and `[Home]` resets the viewport.

The summary separates process status from result completeness and shows the
reported exit/signal, cancellation or timeout cause, attempt/retry counts,
duration, last recorded PID and capture metadata. Unreported legacy fields stay
unreported. Pending or interrupted work cannot become a complete JSON result.
Invalid and truncated JSON have no parsed body; a truncated text capture is
explicitly a prefix. Payloads above the native 256 KiB retention limit are omitted
without changing the producer's capture status. The view retains eight jobs,
64 artifacts/64 KiB of metadata per job, and at most 8192 display lines.

Artifacts show their recorded provenance, path, existence, size and modification
time. Current disk availability remains unverified: files can change after the
inventory was recorded. On the artifact page, `[o]` asks for confirmation before
opening a verified file or directory with the trusted VS Code launcher; `[y]`
copies its canonical path. Clipboard launchers use the existing command authority
policy: Windows PowerShell, macOS `pbcopy`, or Linux `wl-copy`/`xclip` on PATH.
Missing or untrusted launchers report an error. These actions hand a verified
path to an external application; that application controls its subsequent use.

`[e]` exports a verified file to an explicit new filename within the selected
job's repository. The parent directory must exist. Existing names are never
overwritten; directories do not offer file export. Bytes, checksum and exact
opened-file identity are rechecked, including the published export. Missing,
changed, linked or expired selections fail without selecting another artifact.
`[Esc]` cancels a confirmation or the current action, retaining the selected job.
Actions require a controllable live supervisor; replayed observation JSON cannot
authorize them. The action registry retains eight job instances and 64 artifacts
per instance, admits files up to 8 MiB and 16 MiB total per inventory, and permits
one action at a time. Larger artifacts retain observations without actions.
Superseded job identities cannot inherit an older inspector's data.
Result bodies stay outside layout snapshots and ordinary runtime telemetry;
supervisor event recordings contain captured results as described below.

## Repository search

Press `[R]` or select **Search a repository and inspect results** in the palette.
`[Tab]` and `[Shift+Tab]` move between repository, query, mode, backend, top,
snapshot, as-of and shared-filter fields. `[Ctrl+U]` clears a field. The form uses
the canonical search schema and defaults supplied by the supervisor. Shared
filters accept a JSON object with the same predicates as the API; duplicate
fields and simultaneous snapshot/as-of selection are rejected. `[Enter]` submits.
If the form opens during startup, it loads its schema when the verified supervisor
handshake arrives; reopening is unnecessary.

The results view preserves canonical mode groups, ranks, scores, paths, ranges,
freshness and output-budget evidence. Arrows or `[j]/[k]` select a hit; `[Enter]`
loads its bounded working-tree source. `[n]` requests the next supported cursor
page and `[e]` edits the query. A filter-only query can enumerate cursor pages;
ranked text queries retain the CLI's top-k behavior. Empty results, unavailable
source, index incompatibility and incomplete capture are reported explicitly.

In source view, arrows and page keys scroll, left/right pan, `[Home]` resets the
viewport and `[r]` refreshes current bytes. `[Esc]` returns to results. `[o]`
previews opening the selected file/line with the installed `code` launcher;
`[Enter]` confirms and `[Esc]` cancels. The operator rechecks source bytes,
repository containment and command trust before launch. Changed or unsafe paths
require a fresh preview and cannot inherit an earlier confirmation.

`[Esc]` cancels an in-flight request and waits for its actual outcome. Changing
scope or replacing a query invalidates old results and rejects late responses.
`[Ctrl+C]` shuts down the native client, supervisor and owned query children.
Search requires a controllable supervisor advertising `supportsSearch`; passive
and replay sessions cannot execute requests. Drafts and source text stay outside
saved layout snapshots and ordinary telemetry. The native launcher records
supervisor events in its selected/default observability directory; these recordings
include returned search data, so retain them with the same care as source files.
Direct supervisor launches record events only when an event-log directory is supplied.

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

`[b]` opens the registry-backed index catalog for the selected repository or
workspace. It exposes build, watch, validation, reports, statistics, all snapshot
subcommands and workspace builds with their stable/operator support tiers. Select
a command, edit its fields as JSON, and use `[Delete]` to restore an unset value.
False, zero and repeated array values retain their types. Unset fields use CLI
defaults. Scope, progress, result capture and diagnostic-only flags are managed
explicitly; the catalog records why each managed field is unavailable for editing.

`[p]` validates and prepares a launch preview. Review the exact canonical argv,
scope and selected embedding assets before `[Enter]` confirms; `[Esc]` discards
the preview. Provider, embedding mode and model configuration use Settings and
the existing build/setup contracts. There is no separate embeddings command.
Asset presence is distinct from provider initialization and inference qualification.
Previews expire after five minutes, are usable once, and are rechecked before a
child starts. Scope replacement, workspace membership changes, configuration
changes and missing model assets invalidate the launch. The session retains at
most 16 previews, each capped at 768 KiB, and admits at most 32 workspace repos.

The result page shows the owned job ID; `[c]` requests cancellation of that job.
Process status, capture completeness, current generation, producer validation,
promotion and current artifact validation are separate evidence. A published
sparse index missing SQLite remains unready. Completing a later canonical stage
can qualify the same generation without inventing a new generation identity.
`[t]` checks the currently published artifacts; publication observations remain
bounded and cancellable. Preview preparation does not rescan the old index to
authorize a repair. Recorded artifacts remain available through Job inspection.
These controls require a live controllable supervisor advertising
`supportsIndexWorkflows`; passive/replay sessions cannot launch work.

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

Rejected settings edits remain volatile and bound to the selected scope, field
and inspected revision. Schema rejection returns to the editor with the input
intact. A stale revision retains unsaved input but requires Ctrl-r reload and a
new validation preview before saving. Explicit discard, scope selection and a
successful save clear the draft. Draft text is excluded from snapshots and logs.
Flow control queues complete logical events with a hard 2,048 pending-frame
allowance. Partially sent chunk groups stay pinned until their remaining frames
drain. Ordinary logs/progress cannot evict task lifecycle events; progress for
the same queued task coalesces only within its current start/end boundary.
An explicit task:start begins a new instance; stale task:progress cannot revive
a terminal task. If lifecycle-only pressure exhausts the finite allowance,
lifecycleDropped is reported in the next runtime metrics/credit receipt and the
native UI marks formerly active tasks unknown instead of claiming current state.

Live ingress uses a bounded 4,096-frame channel and monotonic stamps taken when
the reader admits a parsed frame. eventLagMsEwma measures that local residence
through dispatch, including a reader waiting on channel admission. It does not
estimate age from producer wall clocks or queue length. nativeInboundPending
counts local pending frames (including the single waiting reader), separately
from supervisor queueDepthEwma. Unknown measurements serialize null and display
a question mark. Reassembled events do not add a second ingress sample; passive
replay does not invent live latency. Each main-loop protocol drain admits at most
128 frames or four milliseconds before returning to input/render work.

Terminal keys retain raw FIFO identity until dispatch. Each key is interpreted
against the modal state produced by its predecessor, including the owned
recordings UI. The 25 ms dispatch bound does not reinterpret queued text as a
global shortcut. Ctrl+C still clears pending interaction and enters the existing
owned shutdown path. Source/Rust/producer regressions for these changes are
authored; build, clippy, capture and ConPTY qualification remain deferred.

Saved-session seeks reconstruct at most 128 recorded transport frames per UI tick,
with a cooperative 4 ms reduction budget. Superseded targets coalesce, identical
positions do no reconstruction, and the session note shows the processed position
and pending target. Live-channel draining and input/render dispatch get their normal
turns between reconstruction ticks. Individual event decoding and checkpoint copying
remain bounded operations, not preemptible work or a hard 4 ms frame guarantee.

Replay checkpoints occur every 256 processed frames. At most eight are retained,
with an 8 MiB conservative allocation charge; an oversized state is not cached.
They retain only reducer-derived state, never full AppModel objects, file handles,
input queues, control outboxes or a duplicate recording event vector. Immutable
inspection result records are shared and copied only on later record mutation.
User filters, viewport offsets and selected job identity remain outside checkpoint
restoration. Missing selected jobs remain explicitly unavailable. Detach restores
the separate live model and drops all replay checkpoints. The original 32,768-event
and 8 MiB recording admission bounds are unchanged.

These source bounds and authored maximum-recording/reducer controls still require
Windows Rust, ConPTY, real input/live-channel and measured memory qualification.

The live ingress turn uses the same 128-frame/4-ms cooperative admission bound
before recordings, due drawing and input dispatch. Credits count consumed frames
only. Known native backlog or pending replay reconstruction selects a zero-time
terminal poll; the 20-ms idle wait applies only when both are absent. This avoids
an artificial idle delay between sustained batches without reordering events.

Frame admission compares a compact render key. Collection owners advance a
content revision for log/alert append or eviction, job/task replacement and
replay-state restoration; view, active-overlay and workload/session inputs remain
explicit. Key construction does not scan or serialize retained log/job/task
collections. Render-duration feedback, clocks, credits and input bookkeeping do
not invalidate it. Source regressions cover a full 2,048-entry log ring and
same-count replacements; buffer parity and allocation/latency measurements remain
unqualified until the deferred Windows validation pass.

Job/task panes filter identities first, clamp one viewport and only then build
formatted/styled rows. The job selection marker shares the same filtered sequence.
Empty searches avoid candidate row-text construction; nonempty searches normalize
the query once and still inspect eligible text. This bounds presentation work by
visible rows without claiming arbitrary uncached search is viewport-only work.
