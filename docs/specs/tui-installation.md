# TUI Installation and Distribution Spec

Status: active  
Last updated: 2026-10-23

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

Installers require the build-manifest checksum and its target catalog binding.
Generation-based wrappers validate the immutable install/source receipt, independently
of later build output. Legacy fixed-path installs retain their build checksum check.

## Install contract

`node tools/tui/install.js` behavior:

1. Resolve target triple from `--target` or host platform/arch.
2. Validate target against `tools/tui/targets.json`.
3. Validate `dist/tui/tui-artifacts-manifest.json` against `dist/tui/tui-artifacts-manifest.json.sha256`.
4. Validate artifact row and expected sha256 for chosen target.
5. Acquire the existing per-target install lock, and stage a fresh unique generation.
6. Verify copied bytes, target machine and executable metadata; bind the exact
   supervisor digest, Node version/ABI, package identity and source build receipt.
7. Durably write the generation's schema-2 `install-manifest.json`, revalidate its
   contents and binary, and atomically replace the current manifest with the same
   complete selection. No success is reported before publication and lock release.

Default layout:

- `<cacheRoot>/tui/install-v1/<triple>/generations/<generationId>/<artifactName>`
- `<cacheRoot>/tui/install-v1/<triple>/generations/<generationId>/install-manifest.json`
- `<cacheRoot>/tui/install-v1/<triple>/install-manifest.json`
- `<cacheRoot>/tui/install-v1/<triple>/logs/`

Default `cacheRoot` must follow the canonical PairOfCleats cache-root policy:

- `PAIROFCLEATS_CACHE_ROOT` when set
- otherwise `PAIROFCLEATS_HOME/cache` when `PAIROFCLEATS_HOME` is set
- otherwise platform default cache roots (`%LOCALAPPDATA%/PairOfCleats/cache`, `$XDG_CACHE_HOME/pairofcleats/cache`, or `~/.cache/pairofcleats/cache`)

Deterministic policy:

- keep the current selector and shared logs at stable paths outside generations
- serialize same-root/same-target installers through the existing file-lock owner
- verify all generation bytes and metadata before selecting them
- retain earlier complete generations, unrelated siblings and interrupted staging;
  no installer prunes a sibling, overwrites an in-use binary or kills a running TUI
- the old current manifest remains authoritative until atomic promotion; a crash
  afterwards leaves the new complete generation selected
- failed phases report staging/recovery context; Windows sharing refusal requires
  closing the handle holding the selecting manifest and retrying, without deletion
- retained generations need explicit retention/cleanup authority; automatic retirement
  is not part of installation

The fixed `bin/` schema-1 layout remains readable for existing installs. New installs
write schema 2 in the existing install-v1 namespace. Header validation proves only
format/architecture admission; native execution and Windows sharing behavior still
require platform qualification. Synthetic fixture headers are not executable proof.

## Wrapper launch contract

`bin/pairofcleats-tui.js` must fail fast when any validation fails:

- missing/invalid install manifest
- target/artifact mismatch
- missing/non-executable binary
- checksum mismatch

When valid, wrapper launches binary and injects:

- `PAIROFCLEATS_TUI_RUN_ID`
- `PAIROFCLEATS_TUI_INSTALL_ROOT`
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
