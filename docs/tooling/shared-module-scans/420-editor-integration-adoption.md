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

- [windows-cmd.js](../../../src/shared/subprocess/windows-cmd.js)
- [direct-execution.js](../../../src/shared/direct-execution.js)
- [cli-helpers.js](../../../src/integrations/tooling/cli-helpers.js)
- [stable-json.js](../../../src/shared/stable-json.js)
- [dict-utils.js](../../../tools/shared/dict-utils.js)

## Adoption Matrix

### 1. VS Code Windows wrapper policy

Shared module to prefer:
- [windows-cmd.js](../../../src/shared/subprocess/windows-cmd.js)

Representative local files:
- [windows-cmd.js](../../../extensions/vscode/windows-cmd.js)
- [windows-cmd-core.cjs](../../../extensions/vscode/windows-cmd-core.cjs)
- [extension.js](../../../extensions/vscode/extension.js)

Best action:
- Keep the extension files as a vendored mirror of the shared wrapper policy, not as an independently evolving implementation.

### 2. Integration CLI bootstrap and direct execution

Shared modules to prefer:
- [direct-execution.js](../../../src/shared/direct-execution.js)
- [cli-helpers.js](../../../src/integrations/tooling/cli-helpers.js)

Representative local files:
- [api-contracts.js](../../../src/integrations/tooling/api-contracts.js)
- [architecture-check.js](../../../src/integrations/tooling/architecture-check.js)
- [context-pack.js](../../../src/integrations/tooling/context-pack.js)
- [graph-context.js](../../../src/integrations/tooling/graph-context.js)
- [impact.js](../../../src/integrations/tooling/impact.js)

Best action:
- Use the shared direct-execution helper for entrypoint gating.
- Keep changed-input parsing and similar repo-relative normalization on the existing integration CLI helper surface.

### 3. TUI low-level helper reuse

Shared modules to prefer:
- [dict-utils.js](../../../tools/shared/dict-utils.js)
- [runtime-envelope/resolve.js](../../../src/shared/runtime-envelope/resolve.js)
- [stable-json.js](../../../src/shared/stable-json.js)
- [windows-cmd.js](../../../src/shared/subprocess/windows-cmd.js)

Representative local files:
- [build.js](../../../tools/tui/build.js)
- [install.js](../../../tools/tui/install.js)
- [targets.js](../../../tools/tui/targets.js)
- [build-support.js](../../../tools/tui/build-support.js)
- [artifacts.js](../../../tools/tui/supervisor/artifacts.js)
- [protocol-flow.js](../../../tools/tui/supervisor/protocol-flow.js)

Best action:
- Share low-level runtime/config/wrapper/serialization behavior where the fit is exact.
- Keep supervisor state, session protocol, and UI behavior local.

### 4. Integration code still pulling in tool-side dict-utils

Representative files:
- [api-contracts.js](../../../src/integrations/tooling/api-contracts.js)
- [architecture-check.js](../../../src/integrations/tooling/architecture-check.js)
- [context-pack.js](../../../src/integrations/tooling/context-pack.js)
- [graph-context.js](../../../src/integrations/tooling/graph-context.js)
- [impact.js](../../../src/integrations/tooling/impact.js)
- [index-records.js](../../../src/integrations/triage/index-records.js)
- [sqlite.js](../../../src/integrations/core/build-index/sqlite.js)

Best action:
- Do not expand this dependency.
- Treat it as a later migration target for a proper src-shared repo/workspace/cache-root/generation surface.

## Editor-Specific Exceptions

These should remain mostly local:

- [extension.js](../../../extensions/vscode/extension.js)
  - VS Code command registration, session UX, and managed process orchestration are editor-specific.
- [tools/tui/supervisor](../../../tools/tui/supervisor)
  - session protocol and state machine are TUI-specific
- [sublime/PairOfCleats](../../../sublime/PairOfCleats)
  - Python plugin implementation should stay local; only payload semantics should align
- [providers/lsp](../../../src/integrations/tooling/providers/lsp)
  - already uses many shared low-level primitives and remains domain-specific above that layer

## Recommended Follow-On Issues

- `#423`: replace the integration-to-tools/shared dict-utils seam with a proper shared repo/workspace/generation family
- `#424`: if wrapper/runtime cleanup across VS Code and TUI still feels fragmented
- `#425`: if integration payload builders for search/risk/context-pack still repeat too much
- `#428`: if editor/API/CLI parity helper extraction becomes justified
