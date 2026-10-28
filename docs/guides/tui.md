# TUI Guide

Status: active  
Last updated: 2026-10-22T00:00:00Z

## Install and first use from a source checkout

The application checkout contains the CLI and native build sources. Your target
repository contains the code you want to index and search; it may be elsewhere.
You do not need a globally installed `pairofcleats` command for this recipe.

Install the Node 26 version in `.nvmrc`, Python 3 and the platform C/C++ build
tools required by the native dependencies, then run `npm run bootstrap:ci` in
the application checkout. Native TUI builds additionally require rustup and
Rust **1.88.0** (the crate's `rust-toolchain.toml`), plus the target platform's
linker/SDK. On Windows use the MSVC C++ build tools and Windows SDK; on Linux
use a C/C++ linker toolchain; on macOS install the Xcode command line tools.
Install/build may download dependencies and toolchain components. A missing
staged host binary triggers a native build, so arrange these prerequisites first.

These commands use forward slashes and work in PowerShell and POSIX shells.
Start in the **application checkout**, replacing the absolute target path:

```text
node --version
npm run bootstrap:ci
node bin/pairofcleats.js tui install
node bin/pairofcleats.js index build --repo /absolute/path/to/target --mode code
node bin/pairofcleats.js index validate --repo /absolute/path/to/target --mode code --json
node bin/pairofcleats-tui.js
```

For Windows, the repo argument can be `"C:/Projects/My target"`. Keep quotes
around paths containing spaces. Launch from the application checkout even when
the target is elsewhere; the native wrapper selects its installed host binary
and Node supervisor. `pairofcleats tui install` and `pairofcleats-tui` are the
equivalent short forms only when those wrappers are on PATH. Installation does
not make an unrelated Node executable on PATH the supported runtime.

In the TUI press `R`, select the absolute target repository in the Repository
field, and use Tab to enter a query, Mode `code`, and Top per mode `5`. Press
Enter to search. Arrows select a result; Enter shows source for that exact
result. `o` previews an external editor open, and Enter explicitly confirms
that preview. The trusted editor launcher must be available; source inspection
works independently. Esc returns to results. Press `q` outside overlays or
Ctrl+C anywhere for graceful shutdown; the supervisor drains and reaps owned
work before the terminal is restored.

Use `b` for a scoped index workflow when you need to build from the application:
choose the target directory, choose `index.build`, set the desired mode, press
`p` to inspect the scope/argv preview, then Enter to launch. Check the actual
validation/publication result before treating an index as ready. Opening a form
does not launch a build. Saved-session replay is passive and cannot run these
commands. Provider credentials belong in the existing trusted private handoff,
never in a query or command field.

This recipe and the interaction changes below are authored instructions.
Clean-checkout/package, native frame, Paste, ConPTY and platform qualification
must be recorded separately; source review is not an installation receipt.

## Commands

- Build and stage target artifacts explicitly: `pairofcleats tui build`
- Install target binary (auto-builds the host target when staging is missing): `pairofcleats tui install`
- Run supervisor directly: `pairofcleats tui supervisor`
- Launch native TUI wrapper: `pairofcleats-tui`

Use `pairofcleats tui build --smoke` when you want to validate or restage the host artifact explicitly without installing it yet.

Runtime controls:

- `[R]` search a repository and inspect results/source
- `[r]` run the search command's help as a job
- `[s]` select a repository/workspace and inspect or edit settings
- `[b]` open the typed command catalog, inspect readiness and preview a launch
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
- `[F1]` open contextual help from any form/overlay; Esc or F1 returns to it
- `[z]` maximize the focused pane / restore automatic density; narrow or short
  terminals automatically show one focused work pane, with Tab/1/2/3 access to all panes
- `[j]/[k]` log viewport scroll by displayed row, including inside wrapped entries
- `[n]/[m]` job viewport scroll
- `[u]/[i]` task viewport scroll

Help scrolls with arrows, PageUp/PageDown and Home/End. The action palette accepts
a text filter and shows shortcut hints and disabled reasons. Use arrows to
select within the filtered list. Mouse capture remains opt-in; clicking focuses
a visible pane or pins a rendered job, and the wheel scrolls the hovered pane.
Modal overlays consume mouse gestures before the panes behind them. Clicking
does not confirm a write, launch or external open.

Search and form text supports grapheme cursor editing with Left/Right, Home/End,
Backspace/Delete and Ctrl+U. Bracketed paste inserts data in the active editor;
newlines/tabs become spaces, other control characters are discarded, and
oversized input is rejected atomically. Paste cannot submit or confirm a form.
Settings/workflow fields are bounded to 4096 bytes; repository search fields to
8192. Settings Delete on the field list previews removal of only that override;
Enter still confirms the canonical diff. Removal restores the next effective
configuration layer or policy, which can differ from a static schema default.

The selected activity line retains canonical producer `current`, `total`, `unit`
and stage facts when supplied. Unknown totals remain indeterminate. Live elapsed
and last-progress ages update at one second intervals while selected work is
active; terminal outcomes freeze timing. Replay displays recorded observations
without live aging. Silence alone is not proof of a stall, useful work or readiness.

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

Use `[/]` to filter field names, arrows to select and `[Enter]` to edit a schema
literal. Strings need no JSON quotes; `[e]` explicitly opens advanced JSON.
`[Space]` cycles an enum or toggles a boolean and opens its review; `[a]` adds a
bounded string-array item. `[Ctrl+U]` clears the draft. `[Enter]` validates and displays a diff; a second
`[Enter]` confirms publication. `[Esc]` discards the draft or cancels its preview.
`[r]` reloads actual configuration. Invalid values and stale file/schema revisions
cannot be saved; reload after an external edit. Unrelated fields and comments
survive ordinary edits. Sensitive fields and launch-policy-controlled values stay
read only; use a private editor for credentials or raw provider commands/arguments.

Settings also checks search's existing ANN candidate bounds and positive RRF
constant after canonical repository authority and trusted configuration merging.
Conflicts produce field-specific errors before a save token is issued; current
effective constraints are checked again before publication. To reduce an ANN
maximum below the default cap, lower the cap first, then the maximum. No value is
silently clamped. Default `config validate` remains a raw schema check;
`config validate --effective` checks the effective combination without probing
runtime readiness.

`[R]` previews replacement with the canonical default template. Review the diff
and backup location, type literal `RESET`, then press `[Enter]`. Reset preserves
the original bytes in its backup, including an undecodable original file. The
preview explicitly reports whether an existing backup would be replaced.

An in-flight request accepts `[Esc]` cancellation and waits for its actual outcome;
a save or scope selection that already completed remains committed. `[Ctrl+C]`
uses global graceful shutdown. Settings require a controllable supervisor advertising
`supportsSettings`; passive/replay sessions cannot execute these actions. Settings
drafts/responses stay outside saved layout snapshots and foreground job selection.

`[b]` opens the registry-backed command catalog for the selected repository or
workspace. It exposes index/workspace workflows alongside setup/doctor/tooling,
loopback API, owned MCP protocol health, scoped multi-repo indexer work/status,
canonical storage observation/cleanup review, cache GC, graph/context/impact, architecture/test suggestions, risk
and report adapters. Unsupported entries explain their concrete missing adapter.
`[X]` deliberately enables experimental request-file semantic/runtime commands,
model comparison and a restricted search microbenchmark. Internal commands stay
hidden. See the [catalog contract](../contracts/tui-command-catalog.md) for ownership
limits and the machine-readable coverage owner. Select a command, edit literals
with Enter, toggle/cycle with Space, use `[e]` for advanced JSON or `[a]` for a
string-array item, and use `[Delete]` to restore an unset draft value.
False, zero and repeated array values retain their types. Unset fields use CLI
defaults. Scope, progress, result capture and diagnostic-only flags are managed
explicitly; the catalog records why each managed field is unavailable for editing.

`[p]` validates and prepares a launch preview. Review the canonical argv or named direct API owner,
scope and selected embedding assets before `[Enter]` confirms; `[Esc]` discards
the preview. Provider, embedding mode and model configuration use Settings and
the existing build/setup contracts. There is no separate embeddings command.
Semantic detail/trace/find/explain results accept `[n]` to continue in their
original owned process; `[Esc]` disposes the volatile continuation before leaving
that result. Producer cursors stay private, and query/generation scope cannot be
replaced on continuation. Runtime-evidence forms still show one page.
Indexer work requires a workspace and a contained service config whose inline
registered repositories are all enabled members. Cancellation affects only its
claimed executions. Storage cleanup apply reviews and retains the canonical
exact plan; protected/incomplete plans stay blocked and existing leases apply.
SQLite compaction and LMDB build preview the exact current generation and
canonical backend targets. They reject historical/snapshot and configured-path
overrides, legacy cache-root generations and `NODE_OPTIONS`. Finish or cancel
other active jobs first. Confirmation drains search/artifact/semantic owners and
uses the existing authenticated canonical child owner under exclusive cache
ownership. Old volatile inspection and continuation capabilities become stale.
Cancellation stops only that owned child. Cache admission resumes only after
authenticated native closure and actual child exit; unresolved closure remains
pending and fenced, and status reports that state without reading index files.
API status records a bounded loopback health response only after the owned
child's verified listen event. MCP status verifies protocol initialize and tool
inventory responses. Neither observation claims that a repository index is ready.
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

- narrow or short terminals show one focused work pane with direct pane switching; larger terminals show three columns
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

- `<cacheRoot>/tui/install-v1/<triple>/generations/<generationId>/<artifactName>`
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
- immutable generation manifest and source-build digest binding
- exact supervisor and Node/package runtime identity
- legacy fixed-path installs: build-manifest checksum when available

Install stages and verifies a complete generation before atomically selecting it.
Earlier binaries and shared logs are retained; installation never prunes unrelated
siblings or replaces a running executable. A failed promotion leaves the prior
complete selection available. Close a process holding the selecting manifest and
retry if Windows refuses publication. Later build output does not invalidate an
already verified generation. Reinstall after a runtime/package identity change.
Retained/interrupted generations require explicit owned cleanup; they are not
silently removed during an update.

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

Log offsets count wrapped display rows, so every retained line of a long entry is
reachable. Pausing keeps the bottom source position stable across matching and
unmatched arrivals; resize reflows that position rather than skipping whole
entries. Filtering and eviction clamp the stored offset to the retained matching
history. Follow resumes at the newest row. Wrapped byte spans share the existing
2 MiB presentation cache; an uncached oversized entry still exposes its full
history while materializing only the requested viewport. These source changes
still await native rendered-frame and terminal-lifetime qualification.

Native search failures use a separate [bounded recovery contract](../contracts/tui-search-failures.md). Failed first searches preserve their form, distinguish failure from admitted empty responses, and offer scoped recovery without automatic provisioning or command execution. Windows runtime qualification is pending checkpoint 240.
