# TUI Guide

Status: active  
Last updated: 2026-02-21T00:00:00Z

## Commands

- Build manifest/checksums: `pairofcleats tui build`
- Install target binary: `pairofcleats tui install`
- Run supervisor directly: `pairofcleats tui supervisor`
- Launch native TUI wrapper: `pairofcleats-tui`

## Typical flow

1. `pairofcleats tui build`
2. `pairofcleats tui install`
3. `pairofcleats-tui`

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

## Observability

Wrapper injects:

- `PAIROFCLEATS_TUI_RUN_ID`
- `PAIROFCLEATS_TUI_EVENT_LOG_DIR`

Supervisor writes replay logs:

- `<eventLogDir>/<runId>.jsonl`
- `<eventLogDir>/<runId>.meta.json`

Set a custom event log directory with:

- `pairofcleats tui install --event-log-dir <path>`
- or `PAIROFCLEATS_TUI_EVENT_LOG_DIR=<path>`

## Related specs

- `docs/specs/tui-installation.md`
- `docs/specs/tui-build-and-release.md`
- `docs/specs/node-supervisor-protocol.md`
- `docs/specs/progress-protocol-v2.md`
