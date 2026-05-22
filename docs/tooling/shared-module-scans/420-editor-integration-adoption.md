# Shared-Module Scan: #420

- Issue: `#420`
- Title: `Scan editor, extension, and integration surfaces for missed shared-module adoption`
- Scan date: `2026-03-26`

## Summary

The main adoption opportunities here are:

- keep the VS Code Windows wrapper files aligned with the shared wrapper policy
- reduce repeated direct-execution and repo-root/index bootstrap logic in integration CLIs
- share more low-level runtime/config/wrapper helpers across TUI surfaces without flattening the TUI’s session model

The strongest current shared anchors are:

- [windows-cmd.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\subprocess\windows-cmd.js)
- [direct-execution.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\direct-execution.js)
- [cli-helpers.js](C:\Users\sneak\Development\DOUBLECLEAT\src\integrations\tooling\cli-helpers.js)
- [stable-json.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\stable-json.js)
- [dict-utils.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\dict-utils.js)

## Adoption Matrix

### 1. VS Code Windows wrapper policy

Shared module to prefer:
- [windows-cmd.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\subprocess\windows-cmd.js)

Representative local files:
- [windows-cmd.js](C:\Users\sneak\Development\DOUBLECLEAT\extensions\vscode\windows-cmd.js)
- [windows-cmd-core.cjs](C:\Users\sneak\Development\DOUBLECLEAT\extensions\vscode\windows-cmd-core.cjs)
- [extension.js](C:\Users\sneak\Development\DOUBLECLEAT\extensions\vscode\extension.js)

Best action:
- Keep the extension files as a vendored mirror of the shared wrapper policy, not as an independently evolving implementation.

### 2. Integration CLI bootstrap and direct execution

Shared modules to prefer:
- [direct-execution.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\direct-execution.js)
- [cli-helpers.js](C:\Users\sneak\Development\DOUBLECLEAT\src\integrations\tooling\cli-helpers.js)

Representative local files:
- [api-contracts.js](C:\Users\sneak\Development\DOUBLECLEAT\src\integrations\tooling\api-contracts.js)
- [architecture-check.js](C:\Users\sneak\Development\DOUBLECLEAT\src\integrations\tooling\architecture-check.js)
- [context-pack.js](C:\Users\sneak\Development\DOUBLECLEAT\src\integrations\tooling\context-pack.js)
- [graph-context.js](C:\Users\sneak\Development\DOUBLECLEAT\src\integrations\tooling\graph-context.js)
- [impact.js](C:\Users\sneak\Development\DOUBLECLEAT\src\integrations\tooling\impact.js)

Best action:
- Use the shared direct-execution helper for entrypoint gating.
- Keep changed-input parsing and similar repo-relative normalization on the existing integration CLI helper surface.

### 3. TUI low-level helper reuse

Shared modules to prefer:
- [dict-utils.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\shared\dict-utils.js)
- [runtime-envelope/resolve.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\runtime-envelope\resolve.js)
- [stable-json.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\stable-json.js)
- [windows-cmd.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\subprocess\windows-cmd.js)

Representative local files:
- [build.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\tui\build.js)
- [install.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\tui\install.js)
- [targets.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\tui\targets.js)
- [build-support.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\tui\build-support.js)
- [artifacts.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\tui\supervisor\artifacts.js)
- [protocol-flow.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\tui\supervisor\protocol-flow.js)

Best action:
- Share low-level runtime/config/wrapper/serialization behavior where the fit is exact.
- Keep supervisor state, session protocol, and UI behavior local.

### 4. Integration code still pulling in tool-side dict-utils

Representative files:
- [api-contracts.js](C:\Users\sneak\Development\DOUBLECLEAT\src\integrations\tooling\api-contracts.js)
- [architecture-check.js](C:\Users\sneak\Development\DOUBLECLEAT\src\integrations\tooling\architecture-check.js)
- [context-pack.js](C:\Users\sneak\Development\DOUBLECLEAT\src\integrations\tooling\context-pack.js)
- [graph-context.js](C:\Users\sneak\Development\DOUBLECLEAT\src\integrations\tooling\graph-context.js)
- [impact.js](C:\Users\sneak\Development\DOUBLECLEAT\src\integrations\tooling\impact.js)
- [index-records.js](C:\Users\sneak\Development\DOUBLECLEAT\src\integrations\triage\index-records.js)
- [sqlite.js](C:\Users\sneak\Development\DOUBLECLEAT\src\integrations\core\build-index\sqlite.js)

Best action:
- Do not expand this dependency.
- Treat it as a later migration target for a proper src-shared repo/workspace/cache-root/generation surface.

## Editor-Specific Exceptions

These should remain mostly local:

- [extension.js](C:\Users\sneak\Development\DOUBLECLEAT\extensions\vscode\extension.js)
  - VS Code command registration, session UX, and managed process orchestration are editor-specific.
- [tools/tui/supervisor](C:\Users\sneak\Development\DOUBLECLEAT\tools\tui\supervisor)
  - session protocol and state machine are TUI-specific
- [sublime/PairOfCleats](C:\Users\sneak\Development\DOUBLECLEAT\sublime\PairOfCleats)
  - Python plugin implementation should stay local; only payload semantics should align
- [providers/lsp](C:\Users\sneak\Development\DOUBLECLEAT\src\integrations\tooling\providers\lsp)
  - already uses many shared low-level primitives and remains domain-specific above that layer

## Recommended Follow-On Issues

- `#423`: replace the integration-to-tools/shared dict-utils seam with a proper shared repo/workspace/generation family
- `#424`: if wrapper/runtime cleanup across VS Code and TUI still feels fragmented
- `#425`: if integration payload builders for search/risk/context-pack still repeat too much
- `#428`: if editor/API/CLI parity helper extraction becomes justified
