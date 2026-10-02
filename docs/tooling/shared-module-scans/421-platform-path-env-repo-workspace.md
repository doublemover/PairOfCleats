# Shared-Module Scan: #421

- Issue: `#421`
- Title: `Scan the full codebase for bespoke platform, path, env, and repo/workspace handling that should use existing shared modules`
- Scan date: `2026-03-26`

## Summary

The codebase already has the right shared anchors for several cross-cutting concerns:

- [direct-execution.js](../../../src/shared/direct-execution.js)
- [windows-cmd.js](../../../src/shared/subprocess/windows-cmd.js)
- [runtime-envelope/resolve.js](../../../src/shared/runtime-envelope/resolve.js)
- [dispatch-runtime-env.js](../../../bin/dispatch-runtime-env.js)
- [build-pointer.js](../../../src/shared/indexing/build-pointer.js)
- [repo-paths.js](../../../src/shared/repo-paths.js)
- [config.js](../../../src/workspace/config.js)
- [manifest.js](../../../src/workspace/manifest.js)
- [file-paths.js](../../../src/shared/file-paths.js)

The highest-value work is adopting those consistently, not inventing new abstractions first.

2026-05-21 follow-through status: the direct-execution candidate set is closed, MCP handlers now share repo/config/runtime bootstrap through `tools/mcp/tools/helpers.js`, integration tooling commands now use `getRepoRoot()` from `src/shared/repo-paths.js` for CLI repo-root identity, context-pack API/MCP/CLI request projection now routes through `src/shared/context-pack-request.js`, risk explain/delta API/MCP/CLI projection now routes through `tools/analysis/risk-request.js`, show-throughput current-build selection now routes `builds/current.json` through the shared build-pointer generation/canonical resolver, API federated workspace path/cache-root policy now routes through `tools/api/router/workspace-allowlist.js`, LSP Go/Rust/routing workspace-root relative normalization now routes through `normalizeWorkspaceRootRel()` in `src/index/tooling/workspace-model.js`, and ingest repo-relative path filtering now delegates containment/platform normalization to `src/shared/path-normalize.js` while keeping LSIF `/repo/...` virtual-root handling local. Remaining repo/workspace work should focus on allowlist/build-root interpretation outside those completed seams.

## Hotspots

### 1. Symlink-unsafe direct-execution guards

Best shared module:
- [direct-execution.js](../../../src/shared/direct-execution.js)

Representative local implementations:
- [status.js](../../../tools/workspace/status.js)
- [manifest.js](../../../tools/workspace/manifest.js)
- [build.js](../../../tools/workspace/build.js)
- [doctor.js](../../../tools/tooling/doctor.js)
- [index-snapshot.js](../../../tools/index-snapshot.js)
- [index-diff.js](../../../tools/index-diff.js)
- [diagnostics-report.js](../../../tools/reports/diagnostics-report.js)
- [cli.js](../../../src/retrieval/cli.js)
- [explain-risk.js](../../../tools/analysis/explain-risk.js)
- [delta-risk.js](../../../tools/analysis/delta-risk.js)
- [impact.js](../../../src/integrations/tooling/impact.js)

Best action:
- Replace exact `process.argv[1] === fileURLToPath(import.meta.url)` style checks with the shared helper unless the script intentionally wants basename-style launcher behavior.

Why this is best:
- This is already a proven bug class. The shared helper fixes symlinked launches without each script re-deriving URL/path comparison rules.

### 2. Windows wrapper resolution and shell fallback duplication

Best shared module:
- [windows-cmd.js](../../../src/shared/subprocess/windows-cmd.js)

Representative local implementations:
- [windows-cmd.js](../../../extensions/vscode/windows-cmd.js)
- [windows-cmd-core.cjs](../../../extensions/vscode/windows-cmd-core.cjs)
- [bootstrap.js](../../../tools/setup/bootstrap.js)
- [rebuild-native.js](../../../tools/setup/rebuild-native.js)
- [package-vscode.js](../../../tools/package-vscode.js)

Best action:
- Treat the shared Windows wrapper logic as canonical and reduce local copies to either thin adapters or vendored mirrors when packaging constraints require physical duplication.

Why this is best:
- Recent Windows wrapper bugs were fixed centrally. Leaving forks or ad hoc probes in place invites the same failures back.

### 3. Runtime env shaping and propagation drift

Best shared modules:
- [runtime-envelope/resolve.js](../../../src/shared/runtime-envelope/resolve.js)
- [dispatch-runtime-env.js](../../../bin/dispatch-runtime-env.js)
- [dict-utils.js](../../../tools/shared/dict-utils.js)

Representative local implementations:
- [map-iso-serve.js](../../../tools/analysis/map-iso-serve.js)
- [run-loop.js](../../../tools/bench/language-repos/run-loop.js)
- [language-matrix.js](../../../tools/bench/language-matrix.js)
- [model-bakeoff.js](../../../tools/bench/embeddings/model-bakeoff.js)
- [helpers.js](../../../tools/mcp/tools/helpers.js)
- [indexer-service.js](../../../tools/service/indexer-service.js)
- [context-pack.js](../../../tools/triage/context-pack.js)
- [ingest.js](../../../tools/triage/ingest.js)
- [backend.js](../../../src/retrieval/cli/load-indexes/backend.js)

Best action:
- Use the shared runtime env/envelope surfaces for policy and precedence. Keep direct `process.env` merging only for truly local payload injection or test-only setup.

Why this is best:
- `NODE_OPTIONS`, threadpool, and override precedence are already defined centrally. Reimplementing them at call sites is pure drift risk.

### 4. Build-root and generation-resolution duplication

Best shared module:
- [build-pointer.js](../../../src/shared/indexing/build-pointer.js)

Representative local implementations:
- [analysis.js](../../../tools/reports/show-throughput/analysis.js)
- [repo.js](../../../tools/dict-utils/paths/repo.js)
- [repo-cache-config.js](../../../src/shared/repo-cache-config.js)

Best action:
- Eliminate bespoke current-build resolution and route generation/build-root lookups through the shared build-pointer module.

Why this is best:
- Build-root freshness and generation identity have already been a correctness problem. One canonical resolver is safer than local fallbacks.

Current adoption:
- Show-throughput current-build selection now routes cache-scoped `builds/current.json` interpretation through the shared build-pointer generation/canonical resolver.
- Ingest adapters now route repo-relative containment and mixed-separator normalization through `src/shared/path-normalize.js`; `tools/ingest/shared.js` remains the local owner only for LSIF `/repo/...` virtual-root stripping. Evidence: `temp/validation/ingest-path-normalizer-helper-20260521.log`.

### 5. Repo/workspace allowlist and identity handling drift

Best shared modules:
- [repo-paths.js](../../../src/shared/repo-paths.js)
- [config.js](../../../src/workspace/config.js)
- [manifest.js](../../../src/workspace/manifest.js)

Representative local implementations:
- [router.js](../../../tools/api/router.js)
- [analysis.js](../../../tools/api/router/analysis.js)
- [index-diffs.js](../../../tools/api/router/index-diffs.js)
- [index-snapshots.js](../../../tools/api/router/index-snapshots.js)
- [extension.js](../../../extensions/vscode/extension.js)

Best action:
- Keep API trust and editor UX policy local, but centralize workspace identity normalization and manifest/build-root interpretation on shared workspace helpers.

Current adoption:
- Integration tooling command repo-root selection now routes through `getRepoRoot()` in `src/shared/repo-paths.js` for `suggest-tests`, `impact`, `graph-context`, `context-pack`, `architecture-check`, and `api-contracts`. Context-pack's federated workspace realpath membership check intentionally remains local because it enforces a separate allowlist/trust contract.
- API federated search now routes workspace path, repo, cache-root, and workspaceId validation through `tools/api/router/workspace-allowlist.js`. The policy remains API-local, but the path/cache-root interpretation no longer lives as ad hoc closures in the main router.

Why this is best:
- These surfaces have legitimate policy differences, but they should not each reinterpret workspace identity and build roots from scratch.

## Cases That Should Remain Local

- [trust-boundary.js](../../../tools/api/trust-boundary.js)
  - API authz and allowlist policy is product-specific and should stay API-local.
- [extension.js](../../../extensions/vscode/extension.js)
  - VS Code workspace selection and session UX are editor-local even if path/env helpers should converge.
- [targets.js](../../../tools/tui/targets.js)
  - Cargo target/output conventions are TUI-specific, though env/wrapper baselines should still come from shared helpers.
- [store-lazy-load.js](../../../tools/bench/graph/store-lazy-load.js)
  - Bench harnesses may intentionally allow basename-style execution patterns rather than exact module identity.

## Recommended Follow-On Issues

- `#416`: runtime/server adoption pass for the API and service-side seams
- `#418`: tooling/setup/bench adoption pass for env and direct-exec convergence
- `#420`: editor/extension adoption pass, especially the VS Code wrapper/runtime seams
- `#423`: only if repo/workspace/build-pointer adoption still feels fragmented after H31
- `#424`: only if subprocess/wrapper/runtime adoption still leaves awkward local seams after H31
