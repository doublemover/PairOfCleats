# Shared-Module Scan: #421

- Issue: `#421`
- Title: `Scan the full codebase for bespoke platform, path, env, and repo/workspace handling that should use existing shared modules`
- Scan date: `2026-03-26`

## Summary

The codebase already has the right shared anchors for several cross-cutting concerns:

- [direct-execution.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\direct-execution.js)
- [windows-cmd.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\subprocess\windows-cmd.js)
- [runtime-envelope.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\runtime-envelope.js)
- [env.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\dispatch\env.js)
- [build-pointer.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\indexing\build-pointer.js)
- [config.js](C:\Users\sneak\Development\DOUBLECLEAT\src\workspace\config.js)
- [manifest.js](C:\Users\sneak\Development\DOUBLECLEAT\src\workspace\manifest.js)
- [files.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\files.js)

The highest-value work is adopting those consistently, not inventing new abstractions first.

## Hotspots

### 1. Symlink-unsafe direct-execution guards

Best shared module:
- [direct-execution.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\direct-execution.js)

Representative local implementations:
- [status.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\workspace\status.js)
- [manifest.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\workspace\manifest.js)
- [build.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\workspace\build.js)
- [doctor.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\tooling\doctor.js)
- [index-snapshot.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\index-snapshot.js)
- [index-diff.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\index-diff.js)
- [diagnostics-report.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\reports\diagnostics-report.js)
- [cli.js](C:\Users\sneak\Development\DOUBLECLEAT\src\retrieval\cli.js)
- [explain-risk.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\analysis\explain-risk.js)
- [delta-risk.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\analysis\delta-risk.js)
- [impact.js](C:\Users\sneak\Development\DOUBLECLEAT\src\integrations\tooling\impact.js)

Best action:
- Replace exact `process.argv[1] === fileURLToPath(import.meta.url)` style checks with the shared helper unless the script intentionally wants basename-style launcher behavior.

Why this is best:
- This is already a proven bug class. The shared helper fixes symlinked launches without each script re-deriving URL/path comparison rules.

### 2. Windows wrapper resolution and shell fallback duplication

Best shared module:
- [windows-cmd.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\subprocess\windows-cmd.js)

Representative local implementations:
- [windows-cmd.js](C:\Users\sneak\Development\DOUBLECLEAT\extensions\vscode\windows-cmd.js)
- [windows-cmd-core.cjs](C:\Users\sneak\Development\DOUBLECLEAT\extensions\vscode\windows-cmd-core.cjs)
- [bootstrap.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\setup\bootstrap.js)
- [rebuild-native.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\setup\rebuild-native.js)
- [package-vscode.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\package-vscode.js)

Best action:
- Treat the shared Windows wrapper logic as canonical and reduce local copies to either thin adapters or vendored mirrors when packaging constraints require physical duplication.

Why this is best:
- Recent Windows wrapper bugs were fixed centrally. Leaving forks or ad hoc probes in place invites the same failures back.

### 3. Runtime env shaping and propagation drift

Best shared modules:
- [runtime-envelope.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\runtime-envelope.js)
- [env.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\dispatch\env.js)
- [dict-utils.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\dict-utils.js)

Representative local implementations:
- [map-iso-serve.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\analysis\map-iso-serve.js)
- [run-loop.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\bench\language-repos\run-loop.js)
- [language-matrix.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\bench\language-matrix.js)
- [model-bakeoff.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\bench\embeddings\model-bakeoff.js)
- [helpers.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\mcp\tools\helpers.js)
- [indexer-service.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\service\indexer-service.js)
- [context-pack.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\triage\context-pack.js)
- [ingest.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\triage\ingest.js)
- [backend.js](C:\Users\sneak\Development\DOUBLECLEAT\src\retrieval\cli\load-indexes\backend.js)

Best action:
- Use the shared runtime env/envelope surfaces for policy and precedence. Keep direct `process.env` merging only for truly local payload injection or test-only setup.

Why this is best:
- `NODE_OPTIONS`, threadpool, and override precedence are already defined centrally. Reimplementing them at call sites is pure drift risk.

### 4. Build-root and generation-resolution duplication

Best shared module:
- [build-pointer.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\indexing\build-pointer.js)

Representative local implementations:
- [analysis.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\reports\show-throughput\analysis.js)
- [repo.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\dict-utils\paths\repo.js)
- [repo-cache-config.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\repo-cache-config.js)

Best action:
- Eliminate bespoke current-build resolution and route generation/build-root lookups through the shared build-pointer module.

Why this is best:
- Build-root freshness and generation identity have already been a correctness problem. One canonical resolver is safer than local fallbacks.

### 5. Repo/workspace allowlist and identity handling drift

Best shared modules:
- [config.js](C:\Users\sneak\Development\DOUBLECLEAT\src\workspace\config.js)
- [manifest.js](C:\Users\sneak\Development\DOUBLECLEAT\src\workspace\manifest.js)

Representative local implementations:
- [router.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router.js)
- [analysis.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router\analysis.js)
- [index-diffs.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router\index-diffs.js)
- [index-snapshots.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\router\index-snapshots.js)
- [extension.js](C:\Users\sneak\Development\DOUBLECLEAT\extensions\vscode\extension.js)

Best action:
- Keep API trust and editor UX policy local, but centralize workspace identity normalization and manifest/build-root interpretation on shared workspace helpers.

Why this is best:
- These surfaces have legitimate policy differences, but they should not each reinterpret workspace identity and build roots from scratch.

## Cases That Should Remain Local

- [trust-boundary.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\api\trust-boundary.js)
  - API authz and allowlist policy is product-specific and should stay API-local.
- [extension.js](C:\Users\sneak\Development\DOUBLECLEAT\extensions\vscode\extension.js)
  - VS Code workspace selection and session UX are editor-local even if path/env helpers should converge.
- [targets.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\tui\targets.js)
  - Cargo target/output conventions are TUI-specific, though env/wrapper baselines should still come from shared helpers.
- [store-lazy-load.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\bench\graph\store-lazy-load.js)
  - Bench harnesses may intentionally allow basename-style execution patterns rather than exact module identity.

## Recommended Follow-On Issues

- `#416`: runtime/server adoption pass for the API and service-side seams
- `#418`: tooling/setup/bench adoption pass for env and direct-exec convergence
- `#420`: editor/extension adoption pass, especially the VS Code wrapper/runtime seams
- `#423`: only if repo/workspace/build-pointer adoption still feels fragmented after H31
- `#424`: only if subprocess/wrapper/runtime adoption still leaves awkward local seams after H31
