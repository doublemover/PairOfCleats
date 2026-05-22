# Shared-Module Scan: #416

- Issue: `#416`
- Title: `Scan runtime and server surfaces for missed adoption of existing shared modules`
- Scan date: `2026-03-26`

## Summary

This surface already has strong shared anchors:

- [body.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router\body.js)
- [paths.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router\paths.js)
- [response.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\response.js)
- [trust-boundary.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\trust-boundary.js)
- [repo-cache-config.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\repo-cache-config.js)
- [dict-utils.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\dict-utils.js)
- [dispatch-runtime-env.js](C:\Users\sneak\Development\DOUBLECLEAT\bin\dispatch-runtime-env.js)
- [runtime-envelope/resolve.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\runtime-envelope\resolve.js)
- [build-pointer.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\indexing\build-pointer.js)
- [config.js](C:\Users\sneak\Development\DOUBLECLEAT\src\workspace\config.js)
- [manifest.js](C:\Users\sneak\Development\DOUBLECLEAT\src\workspace\manifest.js)
- [indexer-service-helpers.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\service\indexer-service-helpers.js)
- [helpers.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\helpers.js)

Current follow-through status:

- API snapshot/diff route-id decoding now shares `decodeRoutePathSegment()` from `tools/api/router/request-helpers.js`; broader route lifecycle parsing remains a candidate only where it preserves API-local trust/response semantics.
- API `/status` and `/status/stream` repo-resolution failures now share `classifyRepoResolveError()` and `resolveRepoOrSendError()` from `tools/api/router/request-helpers.js`, so invalid repo paths continue to return `INVALID_REQUEST` while forbidden repo paths return `FORBIDDEN` across JSON and SSE status envelopes.
- MCP handlers now share `resolveMcpRepoContext()` from `tools/mcp/tools/helpers.js` for artifact-aware repo resolution, config loading, runtime config, and runtime env derivation.
- MCP analysis handlers now share handler-local observability envelope construction for risk explain, context pack, and risk delta, while preserving tool-specific progress labels and error mapping.
- Risk explain/delta API, MCP, and CLI surfaces now share pure request projection through `tools/analysis/risk-request.js`; API response status mapping, MCP `createError()` semantics, progress events, and index existence checks remain local.
- Service embedding queue path handling now shares build-root/index-dir inference and backend-stage directory resolution through `tools/service/indexer-service-helpers.js`; the same helper owner now also centralizes service runtime-env resolution, repo-config mtime cache invalidation, runtime cache key normalization, UV threadpool diagnostics, and service build-state snapshot reads for progress monitoring/replay diagnostics.
- [pairofcleats-tui.js](C:\Users\sneak\Development\DOUBLECLEAT\bin\pairofcleats-tui.js) now uses the shared dispatch/runtime env baseline through `bin/tui-wrapper-env.js` before layering TUI-specific variables.

## Adoption Matrix

### 1. API route lifecycle duplication

Shared modules to prefer:
- [body.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router\body.js)
- [paths.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router\paths.js)
- [response.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\response.js)
- [trust-boundary.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\trust-boundary.js)

Representative local implementations:
- [router.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router.js)
- [analysis.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router\analysis.js)
- [index-snapshots.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router\index-snapshots.js)
- [index-diffs.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router\index-diffs.js)

Best action:
- Continue hoisting only narrow parsing, repo/workspace resolution, and client-error classification onto the current API helper layer before introducing any new generic HTTP helper family. Route-id decoding and status-route repo error classification are complete.

Why this is best:
- The recent API 500-misclassification bugs happened exactly here. The current API-local helpers are close to the real semantics already.

### 2. API cache/build identity and workspace interpretation drift

Shared modules to prefer:
- [repo-cache-config.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\repo-cache-config.js)
- [config.js](C:\Users\sneak\Development\DOUBLECLEAT\src\workspace\config.js)
- [manifest.js](C:\Users\sneak\Development\DOUBLECLEAT\src\workspace\manifest.js)

Representative local implementations:
- [router.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router.js)
- [cache.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router\cache.js)
- [server.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\server.js)

Best action:
- Keep trust and HTTP response semantics local, but stop re-shaping build identity and workspace/build-root interpretation at router call sites.

### 3. MCP handler bootstrap duplication

Shared modules to prefer:
- [helpers.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\helpers.js)
- [dict-utils.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\dict-utils.js)
- [repo-cache-config.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\repo-cache-config.js)
- [search-request.js](/src/shared/search-request.js)

Representative local implementations:
- [analysis.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\handlers\analysis.js)
- [artifacts.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\handlers\artifacts.js)
- [bootstrap.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\handlers\bootstrap.js)
- [downloads.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\handlers\downloads.js)
- [indexing.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\handlers\indexing.js)
- [search.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\handlers\search.js)
- [triage.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\handlers\triage.js)

Best action:
- Completed for repo/config/runtime bootstrap: `resolveMcpRepoContext()` now centralizes artifact-aware repo resolution, config loading, runtime config, and runtime env derivation for repeated handler setup.
- Completed for MCP analysis observability: risk explain, context pack, and risk delta now share handler-local analysis envelope construction without moving MCP transport errors or progress text into a generic helper. Search-specific payload shaping remains a separate candidate only if it preserves the existing MCP search contract.

### 4. Service build-root and job normalization drift

Shared modules to prefer:
- [indexer-service-helpers.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\service\indexer-service-helpers.js)
- [build-pointer.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\indexing\build-pointer.js)

Representative local implementations:
- [indexer-service.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\service\indexer-service.js)
- [job-executor.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\service\indexer-service\job-executor.js)
- [progress-monitor.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\service\indexer-service\progress-monitor.js)
- [embedding-replay.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\service\embedding-replay.js)

Best action:
- Completed for embedding execution/replay path normalization: the existing service helper family now derives buildRoot/indexDir and backend-stage directories consistently for embedding jobs.
- Completed for progress/replay build-state reads: `tools/service/indexer-service-helpers.js` now owns `build_state.json` path and snapshot parsing for both `indexer-service/progress-monitor.js` and `embedding-replay.js`.

Why this is best:
- These surfaces already share service-specific assumptions. Fixing that seam locally is safer than prematurely hoisting service runtime behavior into a generic global module.

### 5. Service subprocess env shaping

Shared modules to prefer:
- [runtime-envelope/resolve.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\runtime-envelope\resolve.js)
- [dict-utils.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\dict-utils.js)

Representative local implementations:
- [indexer-service.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\service\indexer-service.js)
- [job-executor.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\service\indexer-service\job-executor.js)
- [subprocess-log.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\service\subprocess-log.js)

Best action:
- Completed for the indexer service: `tools/service/indexer-service-helpers.js` now owns `createServiceRuntimeEnvResolver()` and `logThreadpoolInfo()`, so runtime envelope/env precedence, repo-config mtime cache invalidation, and startup UV diagnostics are shared inside the service owner while service-local payload envs remain local.

### 6. TUI launcher bypasses shared dispatch/runtime env

Shared modules to prefer:
- [dispatch-runtime-env.js](C:\Users\sneak\Development\DOUBLECLEAT\bin\dispatch-runtime-env.js)
- [runtime-envelope/resolve.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\runtime-envelope\resolve.js)

Representative local implementation:
- [pairofcleats-tui.js](C:\Users\sneak\Development\DOUBLECLEAT\bin\pairofcleats-tui.js)

Best action:
- Completed: `bin/tui-wrapper-env.js` starts from the same dispatch/runtime env baseline as [pairofcleats.js](C:\Users\sneak\Development\DOUBLECLEAT\bin\pairofcleats.js), then layers TUI-specific variables on top.

## Cases That Should Remain Local

- [trust-boundary.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\trust-boundary.js)
  - API-specific authz and redaction semantics should stay API-local.
- [sse.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\sse.js)
  - SSE framing is transport-specific.
- [transport.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\transport.js)
  - MCP transport framing/queueing belongs to MCP.
- [queue.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\service\queue.js)
  - Queue durability and lease semantics are service-specific.
- [config.js](C:\Users\sneak\Development\DOUBLECLEAT\src\workspace\config.js)
  - This is already one of the authoritative shared anchors and should be adopted rather than relocated.
- [manifest.js](C:\Users\sneak\Development\DOUBLECLEAT\src\workspace\manifest.js)
  - This is already the shared workspace/build-pointer manifest interpreter.

## Recommended Follow-On Issues

- `#418`: tooling/setup/bench follow-ons that are not limited to runtime/server surfaces
- `#420`: extension/integration parallels to the same runtime/env/bootstrap seams
- `#422`: if the current API-local helper layer proves insufficient, create a stronger shared HTTP/request helper family
- `#423`: if repo/workspace/build-root adoption still feels fragmented after H31
- `#424`: if subprocess/runtime/bootstrap adoption still leaves too much local glue after H31
