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
- [repo-cache-config.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\repo-cache-config.js)
- [dict-utils.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\dict-utils.js)
- [env.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\dispatch\env.js)
- [runtime-envelope.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\runtime-envelope.js)
- [build-pointer.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\indexing\build-pointer.js)
- [config.js](C:\Users\sneak\Development\DOUBLECLEAT\src\workspace\config.js)
- [manifest.js](C:\Users\sneak\Development\DOUBLECLEAT\src\workspace\manifest.js)
- [indexer-service-helpers.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\service\indexer-service-helpers.js)
- [helpers.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\helpers.js)

The remaining work is mainly adoption:

- API route lifecycle helpers are still partly duplicated across router files.
- MCP handlers still repeat config/runtime bootstrap despite an existing helper surface.
- Service build-root/index-dir/env handling is still split across multiple runtime files.
- [pairofcleats-tui.js](C:\Users\sneak\Development\DOUBLECLEAT\bin\pairofcleats-tui.js) still bypasses the shared dispatch/runtime env path used by the main CLI.

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
- Hoist more parsing, repo/workspace resolution, and client-error classification onto the current API helper layer before introducing any new generic HTTP helper family.

Why this is best:
- The recent API 500-misclassification bugs happened exactly here. The current API-local helpers are close to the real semantics already.

### 2. API cache/build identity and workspace interpretation drift

Shared modules to prefer:
- [repo-cache-config.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\repo-cache-config.js)
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
- [repo-cache-config.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\repo-cache-config.js)
- [search-request.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\search-request.js)

Representative local implementations:
- [analysis.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\handlers\analysis.js)
- [artifacts.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\handlers\artifacts.js)
- [bootstrap.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\handlers\bootstrap.js)
- [downloads.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\handlers\downloads.js)
- [indexing.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\handlers\indexing.js)
- [search.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\handlers\search.js)
- [triage.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\handlers\triage.js)

Best action:
- Expand the existing MCP helper surface and use it for repeated config/runtime/search bootstrap rather than letting each handler accumulate its own setup logic.

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
- Tighten the existing service helper family first so execution, progress-monitoring, and replay all derive buildRoot/indexDir the same way.

Why this is best:
- These surfaces already share service-specific assumptions. Fixing that seam locally is safer than prematurely hoisting service runtime behavior into a generic global module.

### 5. Service subprocess env shaping

Shared modules to prefer:
- [runtime-envelope.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\runtime-envelope.js)
- [dict-utils.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\dict-utils.js)

Representative local implementations:
- [indexer-service.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\service\indexer-service.js)
- [job-executor.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\service\indexer-service\job-executor.js)
- [subprocess-log.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\service\subprocess-log.js)

Best action:
- Keep service-local payload envs, but treat runtime envelope/env precedence as shared policy.

### 6. TUI launcher bypasses shared dispatch/runtime env

Shared modules to prefer:
- [env.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\dispatch\env.js)
- [runtime-envelope.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\runtime-envelope.js)

Representative local implementation:
- [pairofcleats-tui.js](C:\Users\sneak\Development\DOUBLECLEAT\bin\pairofcleats-tui.js)

Best action:
- Start from the same dispatch/runtime env baseline as [pairofcleats.js](C:\Users\sneak\Development\DOUBLECLEAT\bin\pairofcleats.js), then layer TUI-specific variables on top.

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
