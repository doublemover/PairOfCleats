# Shared Module Creation: #425

- Issue: `#425`
- Title: `Identify and create shared search, risk, context-pack, and payload-normalization helper modules across surfaces`
- Created: `2026-03-26`

## What landed

- New canonical shared owner: [search-request.js](/src/shared/search-request.js)
- Compatibility wrapper preserved during migration as `tools/shared/search-request.js`
- Shared risk filter alias normalizer extended in: [risk-filters.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\risk-filters.js)

## Duplicate clusters addressed

1. Cross-surface search payload shaping was owned by `tools/shared/search-request.js` even though `src/**`, API, and MCP surfaces depended on it.
2. Risk/context-pack filter alias handling was duplicated across CLI analysis and context-pack surfaces.

## Why this approach is best

- `search-request` is a true cross-surface contract. Moving ownership into `src/shared` fixes the layering problem without forcing every tool caller to migrate at once.
- `risk-filters.js` already owned normalization and validation. Adding `buildRiskFilterInput()` there keeps alias handling adjacent to the rest of the risk filter contract instead of leaving every caller to reinterpret `flow-id`, `flow_id`, and `flowId`.
- Keeping `tools/shared/search-request.js` as a thin wrapper during migration preserved compatibility while making the canonical owner explicit.

## Migrations completed

- [search.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router\search.js)
- [validation.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\validation.js)
- [search-args.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\search-args.js)
- [tools.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools.js)
- [triage.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\handlers\triage.js)
- [args.js](C:\Users\sneak\Development\DOUBLECLEAT\src\retrieval\federation\args.js)
- [explain-risk.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\analysis\explain-risk.js)
- [delta-risk.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\analysis\delta-risk.js)
- [context-pack.js](C:\Users\sneak\Development\DOUBLECLEAT\src\integrations\tooling\context-pack.js)

## What intentionally stayed local

- [search-contract.js](C:\Users\sneak\Development\DOUBLECLEAT\extensions\vscode\search-contract.js)

That file is still a VS Code-specific adapter with CommonJS/editor-setting concerns. It should be reviewed later, but it was not the right seam to hoist in this issue.

## Follow-on cleanup

- reduce remaining wrapper-only imports of `tools/shared/search-request.js` when those surfaces are already `src/**` or otherwise safe to point at the shared owner directly
- continue hoisting other cross-surface payload builders when later H32 scans identify a clear canonical owner
