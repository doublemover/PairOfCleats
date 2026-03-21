# TUI Guide

Status: active  
Last updated: 2026-02-21T00:00:00Z

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
- `[c]` cancel selected job
- `[q]` graceful shutdown
- `[j]/[k]` log viewport scroll
- `[n]/[m]` job viewport scroll
- `[u]/[i]` task viewport scroll

The live UI now exposes an explicit session header so operators can tell:

- attachment mode (`supervised`, `replay`, `external-observability`)
- source (`local-supervisor`, `event-log`, `passive-stream`)
- connection state
- run id and current scope
- last durable alert

Presentation behavior:

- narrow terminals stack jobs, tasks, and logs vertically instead of squeezing three unreadable columns
- runtime events are summarized into operator-facing text instead of raw JSON by default
- logs wrap/truncate to pane width, while job/task rows use concise status summaries
- no-color mode remains readable without relying on decorative styling

## Install layout

Default install root is repo-local:

- `.cache/tui/install-v1/<triple>/bin/<artifactName>`
- `.cache/tui/install-v1/<triple>/install-manifest.json`
- `.cache/tui/install-v1/<triple>/logs/`

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

For source-checkout validation of the TUI crate, run:

- `cargo fmt --check --manifest-path .\crates\pairofcleats-tui\Cargo.toml`
- `cargo check --locked --manifest-path .\crates\pairofcleats-tui\Cargo.toml`
- `cargo test --locked --manifest-path .\crates\pairofcleats-tui\Cargo.toml`
- `cargo clippy --locked --manifest-path .\crates\pairofcleats-tui\Cargo.toml -- -D warnings`

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

- default `.cache/tui/last-state.json`
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
