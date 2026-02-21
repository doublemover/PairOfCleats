# TUI Installation and Distribution Spec

Status: active  
Last updated: 2026-02-21T00:00:00Z

## Scope

Define deterministic installation and launch behavior for `pairofcleats-tui`:

- one canonical target catalog
- deterministic artifact manifest/checksum outputs
- deterministic install layout
- strict wrapper validation before launch
- replayable supervisor event logs with run correlation

## Canonical target catalog

`tools/tui/targets.json` is the only target mapping source for:

- `tools/tui/build.js`
- `tools/tui/install.js`
- `bin/pairofcleats-tui.js`

Required entry fields:

- `triple`
- `platform`
- `artifactName`

`schemaVersion` must remain `1` until a deliberate version bump.

## Build artifacts contract

`node tools/tui/build.js --smoke` emits:

- `dist/tui/tui-artifacts-manifest.json`
- `dist/tui/tui-artifacts-manifest.json.sha256`

Manifest guarantees:

- deterministic target ordering (by `triple`)
- repo-relative POSIX artifact paths
- per-target `sha256` when artifact exists
- embedded checksum for `tools/tui/targets.json`

Installers and wrappers treat the manifest checksum file as required integrity input.

## Install contract

`node tools/tui/install.js` behavior:

1. Resolve target triple from `--target` or host platform/arch.
2. Validate target against `tools/tui/targets.json`.
3. Validate `dist/tui/tui-artifacts-manifest.json` against `dist/tui/tui-artifacts-manifest.json.sha256`.
4. Validate artifact row and expected sha256 for chosen target.
5. Install into deterministic layout.
6. Emit `install-manifest.json` with source + binary metadata.

Default layout:

- `.cache/tui/install-v1/<triple>/bin/<artifactName>`
- `.cache/tui/install-v1/<triple>/install-manifest.json`
- `.cache/tui/install-v1/<triple>/logs/`

Deterministic policy:

- keep exactly one binary filename per target in `bin/`
- keep stable directory names (`install-v1`, `<triple>`, `bin`, `logs`)
- verify installed checksum immediately after copy
- enforce executable metadata before writing final install manifest

## Wrapper launch contract

`bin/pairofcleats-tui.js` must fail fast when any validation fails:

- missing/invalid install manifest
- target/artifact mismatch
- missing/non-executable binary
- checksum mismatch

When valid, wrapper launches binary and injects:

- `PAIROFCLEATS_TUI_RUN_ID`
- `PAIROFCLEATS_TUI_EVENT_LOG_DIR`

Wrapper hints must always include an actionable install/repair command.

## Observability and replay

Node supervisor reads:

- `PAIROFCLEATS_TUI_RUN_ID` (optional override)
- `PAIROFCLEATS_TUI_EVENT_LOG_DIR` (required for file replay logging)

When log dir is set, supervisor writes:

- `<eventLogDir>/<runId>.jsonl` (exact protocol stream replay)
- `<eventLogDir>/<runId>.meta.json` (session metadata)
- `<eventLogDir>/<runId>.runtime.jsonl` (runtime telemetry stream)

Replay requirement:

- log file lines must match emitted stdout protocol events for the same run.

## Related docs

- `docs/specs/tui-build-and-release.md`
- `docs/specs/tui-tool-contract.md`
- `docs/specs/node-supervisor-protocol.md`
- `docs/specs/progress-protocol-v2.md`
