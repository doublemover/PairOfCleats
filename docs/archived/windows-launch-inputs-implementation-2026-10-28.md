# Windows launch inputs — 2026-10-28

**UNVALIDATED source checkpoints**, branch
`codex/pr557-audit-repairs-20261012`, Windows x64, Node 26.12.1:

| Source | Tree | Change |
| --- | --- | --- |
| `1aa4537d1d980c0d7fe0e79285967b6612bb71e2` | `97b2af26069c9e70fcec5526aa5270acc5e59447` | Captured LSP arguments/cwd, selected environment/processor and hidden direct spawn |
| `86b96a410b7a009c3c880563cc033390b055e755` | `a83a44886ba144b4437248eaebc8e665c44b9451` | Operator/canary/structural consumers use selected child cwd |
| `78fff012f7a98afb5fbe65a10568de31eba5d463` | `e48e7b241a7198282f05e024934ff87be79ea2fd` | Preserve native file-URL/default cwd inputs |

The LSP client's wrapper resolver previously omitted its selected environment.
The shared Windows command processor also read ambient COMSPEC/SystemRoot even
when a caller supplied an explicit child environment. Relative wrapper and PATH
entries resolved against the parent cwd, while the child was launched elsewhere.
Caller-owned argument arrays could change between client construction and start.
Direct LSP spawn also omitted `windowsHide`, permitting unwanted console windows.

The actual client now snapshots arguments and absolute cwd at construction,
retains its existing copied environment and resolves Windows wrappers from those
inputs. Each spawn receives a separate environment copy, so an observer cannot
mutate a later transport generation's private environment. Native and wrapper
launches set `windowsHide: true`; shell quoting and verbatim-argument transport
remain with the existing owner. Shared async/sync wrapper callers pass the actual
child cwd, and COMSPEC/SystemRoot come from that selected environment. File URLs,
null/default cwd and explicit relative paths preserve native working-directory
semantics. LSP semantic producer 60 invalidates earlier launch-dependent replay.

The operator command selector now uses the same bounded discovery owner with the
selected repository cwd and returns its absolute selected path before existing
trust/stat checks. Name preference and denied repository execution remain.
Canary and structural wrapper callers forward their known cwd. Structural's
duplicate relative-PATH translation was removed because the shared owner now
performs that exact resolution; its child-cwd-first local command selection stays.
No test or supported wrapper branch was removed.

Fourteen `tooling/lsp/launch-input-snapshot/*` and five
`tui/operator-command-working-directory/*` controls are authored, **unexecuted**.
They cover immutable arguments/environment/cwd, explicit child PATH/processor,
relative paths, selected SystemRoot, hidden options, restart-copy isolation,
invalid arguments, URL/default cwd, operator name order, absence and untrusted
execution. Client controls throw at the actual spawn observer before dispatch;
they create no real process or console. Existing Windows literal-argument,
injection, shim/opaque-wrapper, structural timeout and native operator controls
remain required. No desktop-window or process-lifetime pass is claimed.

Format/ESLint and whitespace passed for all three batches. Five/four/three syntax
checks passed respectively; shared-module scans found zero cycles for the import
batches, and generated script inventories did not change. No functional fixture,
child, native campaign or benchmark ran. These fixes strengthen #1146's actual
launch boundary; built-in qualified invocation preparation, dependency/context
binding and SDK/doctor reconciliation remain source work. Broader Windows native,
descendant/performance and complete issue acceptance remain unqualified. Counts
remain **481 pending / 144 partial / 93 unresolved** of 718 open issues.
Source is local/unpublished; the publication gate remains deferred.
