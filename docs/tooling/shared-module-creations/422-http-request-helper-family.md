# Shared Module Creation: #422

- Issue: `#422`
- Title: `Identify and create shared HTTP/request helper modules for API-like surfaces`
- Created: `2026-03-26`

## What landed

- New bounded request-helper module: [request-helpers.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router\request-helpers.js)
- Migrated API route surfaces:
  - [router.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router.js)
  - [analysis.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router\analysis.js)
  - [index-snapshots.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router\index-snapshots.js)
  - [index-diffs.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router\index-diffs.js)

## Duplicate clusters addressed

1. Body-parse error mapping duplicated across API root routes and route modules.
2. Repo-resolution error mapping duplicated across analysis, snapshot, diff, and search routes.
3. Workspace-request classification duplicated in federated/context-pack paths.

## Why this approach is best

- The repeated logic was small but correctness-sensitive: 400 vs 403 vs 413 vs 415 semantics, plus consistent `INVALID_REQUEST`/`FORBIDDEN` payloads.
- Hoisting only those classifications into one helper fixes the real drift without building a generic router framework.
- Keeping the module under `tools/api/router` is the right boundary because these helpers depend on the HTTP response contract in [response.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\response.js); MCP JSON-RPC envelopes and editor clients intentionally stay separate.

## Migrations completed

- [analysis.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router\analysis.js)
  - now uses shared parse-body and repo-resolution helpers
- [index-snapshots.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router\index-snapshots.js)
  - now uses shared parse-body and repo-resolution helpers
- [index-diffs.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router\index-diffs.js)
  - now uses shared repo-resolution helpers
- [router.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router.js)
  - federated/search/search-stream/search POST now use the same request-helper classifications

## What intentionally stayed local

- SSE stream event envelopes and lifecycle handling
- JSON-RPC/MCP error mapping
- route-specific validation payload details
- request observability/header merge behavior

Those remain local because this issue was about stable invalid-request helpers, not a generic server abstraction.

## Follow-on cleanup

- migrate any remaining API GET/SSE repo-resolution branches if they start drifting
- consider a later narrow helper for request observability/header merge only if more duplication emerges
