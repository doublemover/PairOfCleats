# Shared Module Creation: #428

- Issue: `#428`
- Title: `Identify and create shared test harness, fixture, and surface-parity helper modules`
- Created: `2026-03-26`

## What landed

- New canonical shared test helper: [json-gate.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\helpers\json-gate.js)

## Duplicate clusters addressed

1. CI smoke tests that repeatedly created a temp directory, passed a `--json` output path to a Node gate script, read the payload back, and cleaned up.

## Why this approach is best

- The repo already had good low-level helpers for process execution and test env shaping.
- The missing seam was the higher-level JSON gate lifecycle that glued those helpers together.
- Hoisting only that pattern keeps the helper readable and local to tests instead of inventing a broad test framework.

## Migrations completed

- [capability-gate.smoke.test.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\ci\capability-gate.smoke.test.js)
- [tooling-doctor-gate.smoke.test.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\ci\tooling-doctor-gate.smoke.test.js)
- [tooling-doctor-gate-require-provider-scope.test.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\ci\tooling-doctor-gate-require-provider-scope.test.js)
- [tooling-lsp-replay-gate.smoke.test.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\ci\tooling-lsp-replay-gate.smoke.test.js)

## What intentionally stayed local

- specialized analysis/API/MCP parity harnesses
- fixture-index bootstrap helpers
- service/indexer harnesses with richer local semantics

Those already have tighter domain ownership and would lose clarity if they were folded into a generic gate harness.

## Follow-on cleanup

- migrate other gate-style smoke tests where the same JSON output harness pattern appears
- keep higher-signal specialized harnesses separate unless a comparably tight repeated family emerges
