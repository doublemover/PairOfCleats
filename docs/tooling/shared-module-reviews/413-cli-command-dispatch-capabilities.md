# Shared Module Review: #413

Issue: `#413`  
Scope: `src/shared` CLI, command-registry, dispatch, capability, completions, legacy entrypoint, and tooling-bin helpers assigned to `#413` in the shared-module ledger.

## Overall Assessment

This shared surface is mostly healthy and already acts as the repo's canonical command and CLI contract layer. The main cleanup needs are targeted rather than structural:

- split [display.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cli/display.js)
- split [render.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cli/display/render.js)
- split [command-registry.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/command-registry.js)
- split [runtime-capability-manifest.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/runtime-capability-manifest.js)
- move or relocate [env.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/dispatch/env.js)
- collapse thin dispatch projection wrappers around `src/shared/dispatch/manifest.js` and [registry.js](/src/shared/dispatch/registry.js)

## Runtime-Risk Notes

- [display.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cli/display.js): runtime display orchestrator currently mixes safe-stream guards, task state, task lifecycle, render scheduling, and JSONL log routing.
- [render.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/cli/display/render.js): palette derivation, layout, animation, and terminal row-diff behavior all live in one large renderer.
- [runtime-capability-manifest.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/runtime-capability-manifest.js): CLI flags, API route specs, editor command specs, MCP tool exposure, and runtime probes all converge here.

## Maintainability Notes

- `src/shared/dispatch/manifest.js` was a very thin projection over dispatch registry data.
- [registry.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/dispatch/registry.js) is effectively a filtered clone of command-registry metadata.
- [command-aliases.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/command-aliases.js) is intentionally tiny today and should stay that way unless package-script replacements genuinely expand.

## File Ledger

| File | Classification | Review Note |
| --- | --- | --- |
| `src/shared/capabilities.js` | `keep`, `document`, `test` | Keep as the optional runtime capability probe facade. |
| `src/shared/cli-completions.js` | `keep`, `document`, `test` | Keep as the shell-completion projection over the canonical command registry. |
| `src/shared/cli-options.js` | `split`, `document`, `test` | Split static option-set declarations from validation helpers. |
| `src/shared/cli.js` | `keep`, `document`, `test` | Healthy canonical yargs wrapper used across CLI and tool surfaces. |
| `src/shared/cli/ansi-utils.js` | `keep`, `document`, `test` | Keep as the low-level ANSI helper layer. |
| `src/shared/cli/display.js` | `split`, `document`, `test` | Split stream safety, task-state mutation, and event routing behind the createDisplay facade. |
| `src/shared/cli/display/bar.js` | `keep`, `document`, `test` | Keep as a focused bar-rendering helper. |
| `src/shared/cli/display/colors.js` | `keep`, `document`, `test` | Keep as the display color primitive layer. |
| `src/shared/cli/display/progress.js` | `keep`, `document`, `test` | Keep progress math separate from raw rendering. |
| `src/shared/cli/display/render.js` | `split`, `document`, `test` | Split theme or palette resolution, layout calculation, and row-diff rendering. |
| `src/shared/cli/display/terminal.js` | `keep`, `document`, `test` | Keep as the terminal-kit adapter boundary. |
| `src/shared/cli/display/text.js` | `keep`, `document`, `test` | Keep as the CLI display text-formatting helper layer. |
| `src/shared/cli/noop-task.js` | `keep`, `document`, `test` | Keep as the no-op task fallback. |
| `src/shared/cli/progress-events.js` | `keep`, `document`, `test` | Keep as the authoritative progress protocol contract. |
| `src/shared/cli/progress-stream.js` | `keep`, `document`, `test` | Keep as the shared progress-line decoder. |
| `src/shared/cli/stdout-guard.js` | `keep`, `document`, `test` | Keep as the JSON-mode stdout contract guard. |
| `src/shared/command-aliases.js` | `keep`, `document`, `test` | Keep intentionally tiny unless package-script replacements become a larger surface. |
| `src/shared/command-registry.js` | `split`, `document`, `test` | Keep as the single source of truth, but split registry data from query/projection helpers. |
| `src/shared/dispatch/env.js` | `move`, `document`, `test` | Remove the src/shared-to-tools/shared dependency seam by moving helpers or relocating this wrapper. |
| `src/shared/dispatch/manifest.js` | `merge`, `document`, `test` | Collapse this thin projection into a smaller dispatch facade. |
| `src/shared/dispatch/registry.js` | `merge`, `document`, `test` | Reduce cloned dispatch metadata by collapsing closer to command-registry or one dispatch facade. |
| `src/shared/dispatch/resolve.js` | `keep`, `document`, `test` | Keep as the thin dispatch request resolver. |
| `src/shared/legacy-cli-entrypoint.js` | `keep`, `document`, `test` | Keep as the legacy-entrypoint compatibility shim until wrappers are fully retired. |
| `src/shared/runtime-capability-manifest.js` | `split`, `document`, `test` | Split static surface specs from manifest assembly. |
| `src/shared/tooling-bin-dirs.js` | `keep`, `document`, `test` | Keep as the canonical platform-aware tooling-bin search helper. |
