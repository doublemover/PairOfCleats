# Shared-Module Scan: #418

- Issue: `#418`
- Title: `Scan CLI, setup, download, install, doctor, dispatch, and maintenance tooling for missed shared-module adoption`
- Scan date: `2026-03-26`

## Summary

This tooling surface already has a strong local shared layer:

- [cli-utils.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\cli-utils.js)
- [cli-display.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\cli-display.js)
- [download-utils.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\download-utils.js)
- [input-parsers.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\input-parsers.js)
- [json-file.js](/src/shared/json-file.js)
- [dict-utils.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\dict-utils.js)
- [direct-execution.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\direct-execution.js)
- [windows-cmd.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\subprocess\windows-cmd.js)

The strongest missed-adoption seams are:

- tool entrypoints still using direct `process.argv[1] === fileURLToPath(import.meta.url)` checks
- setup/bootstrap tools still carrying bespoke Windows wrapper launching
- repeated runtime env shaping across setup, triage, analysis, and bench tools

## Adoption Matrix

### 1. Direct-execution guards in tool entrypoints

Shared module to prefer:
- [direct-execution.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\direct-execution.js)

Representative local implementations:
- [index-diff.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\index-diff.js)
- [index-snapshot.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\index-snapshot.js)
- [doctor.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\tooling\doctor.js)
- [explain-risk.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\analysis\explain-risk.js)
- [delta-risk.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\analysis\delta-risk.js)
- [graph-caps-harness.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\bench\graph-caps-harness.js)
- [context-pack-latency.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\bench\graph\context-pack-latency.js)
- [neighborhood-index-dir.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\bench\graph\neighborhood-index-dir.js)

Best action:
- Use the shared direct-execution helper unless a script intentionally wants basename-style launcher behavior.

### 2. Windows wrapper launching in setup/bootstrap scripts

Shared modules to prefer:
- [windows-cmd.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\subprocess\windows-cmd.js)
- [cli-utils.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\cli-utils.js)

Representative local implementations:
- [bootstrap.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\setup\bootstrap.js)
- [rebuild-native.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\setup\rebuild-native.js)
- [map-iso-serve.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\analysis\map-iso-serve.js)

Best action:
- Reuse the shared wrapper resolution and command-running path, leaving only the script-specific command choice local.

Why this is best:
- Windows wrapper behavior has already been corrected centrally. Local re-implementations are pure drift risk.

### 3. Runtime env shaping across tools

Shared modules to prefer:
- [dict-utils.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\dict-utils.js)
- [runtime-envelope/resolve.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\runtime-envelope\resolve.js)

Representative local implementations:
- [setup.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\setup\setup.js)
- [bootstrap.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\setup\bootstrap.js)
- [context-pack.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\triage\context-pack.js)
- [ingest.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\triage\ingest.js)
- [map-iso-serve.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\analysis\map-iso-serve.js)
- [language-matrix.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\bench\language-matrix.js)
- [run-loop.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\bench\language-repos\run-loop.js)
- [model-bakeoff.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\bench\embeddings\model-bakeoff.js)

Best action:
- Keep using shared runtime-config/env helpers and reduce direct `process.env` shaping to local payload overrides only.

### 4. Healthy no-adopt areas

These already follow the intended tools/shared pattern and should mostly stay local:

- [extensions.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\download\extensions.js)
- [dicts.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\download\dicts.js)
- [install.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\tooling\install.js)
- [uninstall.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\tooling\uninstall.js)

Rationale:
- they already reuse the right tools/shared helpers
- the remaining behavior is script-specific policy, not missing low-level shared logic

## Recommended Follow-On Issues

- `#420`: apply similar cleanup to editor/integration surfaces
- `#424`: if subprocess/toolchain/helper cleanup still feels fragmented after H31
- `#426`: if repeated JSON/report/file IO glue still shows up after selective adoption
