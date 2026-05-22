# Shared Module Review: #413

Issue: `#413`  
Scope: `src/shared` CLI, command-registry, dispatch, capability, completions, legacy entrypoint, and tooling-bin helpers assigned to `#413` in the shared-module ledger.

## Overall Assessment

This shared surface is mostly healthy and already acts as the repo's canonical command and CLI contract layer. The P2 cleanup items from this review are now complete:

- keep [display.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cli/display.js) as the public `createDisplay()` facade after the task state and progress-event split
- keep [render.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cli/display/render.js) as the display row assembler after palette/theme state, layout calculation, and terminal row-diff writing moved to focused display-internal owners
- keep the command-registry split centered on `src/shared/command-registry-data.js` and `src/shared/command-registry-query.js`; the old root facade is removed
- keep [runtime-capability-manifest.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/runtime-capability-manifest.js) as the public manifest API after flag and surface assembly moved to `src/shared/runtime-capability/surfaces.js`
- keep `bin/dispatch-runtime-env.js` as the CLI-entrypoint runtime-env owner; the old `src/shared/dispatch/env.js` file is removed
- keep [registry.js](/src/shared/dispatch/registry.js) as a thin compatibility facade over dispatch query helpers owned by `src/shared/command-registry-query.js`

## Runtime-Risk Notes

- [display.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cli/display.js): public display orchestrator now delegates task-state mutation to `src/shared/cli/display/state.js`, JSONL log/task event writing to `src/shared/cli/display/events.js`, safe-stream handling to `stream.js`, terminal resolution to `terminal.js`, and rendering to `render.js`.
- [render.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cli/display/render.js): display row assembly now delegates task ordering/layout to `layout.js`, palette/theme state to `palette.js`, and terminal row-diff rendering to `frame.js`.
- [runtime-capability-manifest.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/runtime-capability-manifest.js): the public manifest API now delegates static specs to `runtime-capability-specs.js`, helper builders to `runtime-capability/builders.js`, and flag/surface projection to `runtime-capability/surfaces.js`.

## Maintainability Notes

- `src/shared/dispatch/manifest.js` is gone; keep future dispatch projection cleanup centered on the live `src/shared/dispatch/registry.js` and command-registry query owners.
- [registry.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/dispatch/registry.js) is now a thin facade over dispatch registry helpers owned by `src/shared/command-registry-query.js`.
- The old `src/shared/cli-completions.js` root helper has moved to `tools/cli/completions-renderer.js`; shell-completion rendering is tool-owned and still reads canonical command-registry data.
- The old `src/shared/runtime-capability-builders.js` root helper has moved to `src/shared/runtime-capability/builders.js` so static manifest assembly helpers are no longer another root shared file.
- [command-aliases.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/command-aliases.js) is intentionally tiny today and should stay that way unless package-script replacements genuinely expand.

## File Ledger

| File | Classification | Review Note |
| --- | --- | --- |
| `src/shared/capabilities.js` | `keep`, `document`, `test` | Keep as the optional runtime capability probe facade. |
| `src/shared/cli-completions.js` | `removed`, `document`, `test` | Moved to `tools/cli/completions-renderer.js`; shell-completion rendering is a tool-owned projection over canonical command-registry data. |
| `src/shared/cli-options.js` | `split`, `document`, `test` | Split static option-set declarations from validation helpers. |
| `src/shared/cli.js` | `keep`, `document`, `test` | Healthy canonical yargs wrapper used across CLI and tool surfaces. |
| `src/shared/cli/ansi-utils.js` | `keep`, `document`, `test` | Keep as the low-level ANSI helper layer. |
| `src/shared/cli/argv.js` | `keep`, `document`, `test` | Keep argv normalization small and explicit so command-specific validation stays in the owning CLI surface. |
| `src/shared/cli/display.js` | `keep`, `document`, `test` | Keep as the public createDisplay facade; task state, event routing, stream safety, terminal adapter behavior, and rendering are now delegated to display-internal modules. |
| `src/shared/cli/display/events.js` | `keep`, `document`, `test` | Keep as the display-internal progress-event writer for JSONL log and task events. |
| `src/shared/cli/display/bar.js` | `keep`, `document`, `test` | Keep as a focused bar-rendering helper. |
| `src/shared/cli/display/colors.js` | `keep`, `document`, `test` | Keep as the display color primitive layer. |
| `src/shared/cli/display/frame.js` | `keep`, `document`, `test` | Keep as the display-internal owner for frame construction and terminal row-diff writes. |
| `src/shared/cli/display/layout.js` | `keep`, `document`, `test` | Keep as the display-internal owner for task ordering, label sizing, ETA/rate/detail layout, and adaptive bar-width selection. |
| `src/shared/cli/display/palette.js` | `keep`, `document`, `test` | Keep as the display-internal owner for palette scheme state, task color assignment, shade scales, and background inheritance. |
| `src/shared/cli/display/progress.js` | `keep`, `document`, `test` | Keep progress math separate from raw rendering. |
| `src/shared/cli/display/render.js` | `keep`, `document`, `test` | Keep as the display row assembler over layout, palette, progress, bar, and frame owners. |
| `src/shared/cli/display/state.js` | `keep`, `document`, `test` | Keep as the display-internal owner for task state, log coalescing state, reset preservation, and task mutation. |
| `src/shared/cli/display/terminal.js` | `keep`, `document`, `test` | Keep as the terminal-kit adapter boundary. |
| `src/shared/cli/display/text.js` | `keep`, `document`, `test` | Keep as the CLI display text-formatting helper layer. |
| `src/shared/cli/noop-task.js` | `keep`, `document`, `test` | Keep as the no-op task fallback. |
| `src/shared/cli/progress-events.js` | `keep`, `document`, `test` | Keep as the authoritative progress protocol contract. |
| `src/shared/cli/progress-stream.js` | `keep`, `document`, `test` | Keep as the shared progress-line decoder. |
| `src/shared/cli/stdout-guard.js` | `keep`, `document`, `test` | Keep as the JSON-mode stdout contract guard. |
| `src/shared/command-aliases.js` | `keep`, `document`, `test` | Keep intentionally tiny unless package-script replacements become a larger surface. |
| `src/shared/command-registry.js` | `removed`, `document`, `test` | Root facade removed after consumers moved to `command-registry-data.js` and `command-registry-query.js`. |
| `src/shared/dispatch/registry.js` | `keep`, `document`, `test` | Keep as a thin dispatch facade over query/projection helpers now owned by `src/shared/command-registry-query.js`. |
| `src/shared/dispatch/resolve.js` | `keep`, `document`, `test` | Keep as the thin dispatch request resolver. |
| `src/shared/cli/legacy-entrypoint.js` | `keep`, `document`, `test` | Keep as the CLI-family legacy-entrypoint compatibility shim until wrappers are fully retired. |
| `src/shared/runtime-capability-builders.js` | `removed`, `document`, `test` | Moved to `src/shared/runtime-capability/builders.js`; the public manifest assembler imports the narrow owner. |
| `src/shared/runtime-capability-manifest.js` | `keep`, `document`, `test` | Keep as the public manifest API over static specs, builder helpers, and `runtime-capability/surfaces.js`. |
| `src/shared/runtime-capability/surfaces.js` | `keep`, `document`, `test` | Keep as the runtime-capability owner for flag-set projection and API/MCP/TUI/editor surface assembly. |
| `src/shared/tooling-bin-dirs.js` | `keep`, `document`, `test` | Keep as the canonical platform-aware tooling-bin search helper. |
