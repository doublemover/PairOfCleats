# Shared Module Creation: #424

- Issue: `#424`
- Title: `Identify and create shared subprocess, toolchain, command-resolution, and installer helper modules`
- Created: `2026-03-26`

## What landed

- New canonical shared owner: [command-invocation.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\subprocess\command-invocation.js)
- Migrated shared/tooling callers:
  - [cli-utils.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\cli-utils.js)
  - [command-resolver.js](C:\Users\sneak\Development\DOUBLECLEAT\src\index\tooling\command-resolver.js)
  - [sourcekit-package-resolution.js](C:\Users\sneak\Development\DOUBLECLEAT\src\index\tooling\preflight\sourcekit-package-resolution.js)
  - [bootstrap.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\setup\bootstrap.js)
  - [install.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\tooling\install.js)
  - [package-vscode.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\package-vscode.js)

## Duplicate clusters addressed

1. Windows wrapper and PATH-shim resolution duplicated across tool probes, installers, and package scripts.
2. Bare-command subprocess launching and env-merging duplicated in both shared tooling helpers and runtime preflight/probe code.
3. Toolchain/package scripts maintaining their own `npm`/wrapper probing semantics instead of sharing the same invocation contract.

## Why this approach is best

- The real duplication was not raw subprocess spawning. It was the higher-level decision about when a bare command like `npm` must be resolved through a Windows shim or explicit wrapper-aware invocation.
- Hoisting that logic into one shared helper removes repeated `cmd.exe`, `.cmd`, PATH, and env-merging branches without forcing every caller to reimplement the same wrapper policy.
- Keeping the abstraction under `src/shared/subprocess` is the right ownership boundary because both `src/**` runtime code and `tools/**` surfaces need the same invocation behavior.

## Migrations completed

- [cli-utils.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\cli-utils.js)
  - `runCommand()` and `runSubprocessOrExit()` now use the shared resolved subprocess wrapper.
- [command-resolver.js](C:\Users\sneak\Development\DOUBLECLEAT\src\index\tooling\command-resolver.js)
  - tooling probes no longer carry local Windows shim handling.
- [sourcekit-package-resolution.js](C:\Users\sneak\Development\DOUBLECLEAT\src\index\tooling\preflight\sourcekit-package-resolution.js)
  - SourceKit preflight now uses the shared resolved async subprocess path.
- [bootstrap.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\setup\bootstrap.js)
  - JSON-mode child streaming no longer has its own `npm`-specific Windows branch.
- [install.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\tooling\install.js)
  - dropped local wrapper-path resolution; requirement probes and installs now rely on shared command helpers.
- [package-vscode.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\package-vscode.js)
  - dropped bespoke `npm` probing in favor of the shared probe contract.

## What intentionally stayed local

- product-specific install plan selection
- provider-specific probe argument selection
- archive packaging semantics

Those are still caller-owned because this issue was about command invocation and wrapper normalization, not collapsing every subprocess call into one generic workflow helper.

## Historical follow-up notes

These are not active roadmap tasks. Reopen this family only from a fresh subprocess wrapper audit, portability bug, or measured duplication signal:

- migrate editor/release/setup command-wrapper logic to [command-invocation.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\subprocess\command-invocation.js) only when current code still repeats that exact seam
- add a shared toolchain probe envelope only if multiple live scripts need the same structured `required tool missing / timeout / spawn error` contract
