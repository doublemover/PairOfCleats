# Shared Module Creation: #423

- Issue: `#423`
- Title: `Identify and create shared repo, workspace, cache-root, and generation-context helper modules`
- Created: `2026-03-26`

## What landed

- New canonical shared owner: [repo-paths.js](../../../src/shared/repo-paths.js)
- Tool adapter preserved: [repo.js](../../../tools/dict-utils/paths/repo.js)
- Compatibility shim narrowed: [dict-utils.js](../../../src/shared/dict-utils.js)

## Duplicate clusters addressed

1. `src/**` product code importing tool-side repo/build helpers.
2. `tools/dict-utils/paths/repo.js` owning correctness-critical repo/cache/build semantics instead of just tool defaults.
3. `src/shared/dict-utils.js` acting as a blind cross-layer passthrough.

## Why this approach is best

- The build-pointer logic was already shared and correctness-critical, but the repo/cache/current-build entrypoints above it were still tool-owned.
- Hoisting only the repo/cache/build family into `src/shared` fixes the real ownership seam without pulling config loading or unrelated tool behavior into `src/shared`.
- Keeping `tools/dict-utils/paths/repo.js` as a thin adapter preserves CLI/tool call sites while stopping new `src/**` code from depending on `tools/shared`.

## Migrations completed

- [config.js](../../../src/workspace/config.js)
- [manifest.js](../../../src/workspace/manifest.js)
- [cli-index.js](../../../src/retrieval/cli-index.js)
- [plan-runner.js](../../../src/retrieval/cli/run-search/plan-runner.js)
- [status.js](../../../src/integrations/core/status.js)
- [index.js](../../../src/integrations/core/build-index/index.js)
- [stages.js](../../../src/integrations/core/build-index/stages.js)
- [index-records.js](../../../src/integrations/triage/index-records.js)
- [architecture-check.js](../../../src/integrations/tooling/architecture-check.js)
- [api-contracts.js](../../../src/integrations/tooling/api-contracts.js)
- [context-pack.js](../../../src/integrations/tooling/context-pack.js)
- [graph-context.js](../../../src/integrations/tooling/graph-context.js)
- [impact.js](../../../src/integrations/tooling/impact.js)
- [suggest-tests.js](../../../src/integrations/tooling/suggest-tests.js)
- [cache.js](../../../src/index/type-inference-crossfile/cache.js)

## What intentionally stayed tool-local

- config loading and normalization
- runtime env shaping
- tool directory / tooling config lookup

Those still live in `tools/shared` because this issue was about repo/workspace/cache-root/generation ownership, not a full tool-config hoist.

## Historical follow-up notes

These are not active roadmap tasks. Reopen this family only from a fresh H32/shared-module audit, governance failure, or import-graph regression:

- move `src/**` callers from `tools/shared/dict-utils.js` only when a current scan proves the edge still exists and has a direct shared owner
- remove compatibility exports from [dict-utils.js](../../../src/shared/dict-utils.js) only after live consumers and generated ledgers prove they are unused
