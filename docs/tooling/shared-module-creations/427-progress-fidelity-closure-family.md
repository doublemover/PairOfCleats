# Shared Module Creation: #427

- Issue: `#427`
- Title: `Identify and create shared progress, fidelity, degradation, and closure-evidence helper modules`
- Created: `2026-03-26`

## What landed

- New canonical shared owner: [progress-events.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\progress-events.js)

## Duplicate clusters addressed

1. MCP runner and handler surfaces were building identical progress-event payloads by hand.

## Why this approach is best

- The repeated seam was the event envelope itself, not the underlying logging or observability systems.
- Hoisting only the shared progress-event reporter improves runtime consistency without flattening unrelated fidelity or closure-evidence logic into a generic framework.
- This keeps start/done/progress and streamed-line events aligned across MCP handlers while preserving domain-specific behavior in the handlers themselves.

## Migrations completed

- [runner.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\runner.js)
- [helpers.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\helpers.js)
- [triage.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\handlers\triage.js)
- [downloads.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\handlers\downloads.js)
- [indexing.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\handlers\indexing.js)
- [analysis.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\handlers\analysis.js)

## What intentionally stayed local

- fidelity and degraded-state semantics tied to specific providers or analysis domains
- closure-evidence merging and benchmark verdict policy
- runtime log formatting

Those domains still have stronger specialized owners and should not be forced into the progress helper.

## Follow-on cleanup

- extend the shared progress-event helper only when another surface shows the same tight repeated event-shape seam
- keep fidelity and closure-evidence helpers separate unless a future pass proves a comparable cross-surface contract
