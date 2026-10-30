# Provider declaration observation — 2026-10-28

**UNVALIDATED source:** `a4cdca2d3f2e9587c028f8f703e1502fc383b406`, tree
`0c4d069f3aadabfacb5fbf95f16cbff8733f590c`, branch
`codex/pr557-audit-repairs-20261012`, Windows x64, Node 26.12.1.

Profile observation retained caller-owned arrays/project objects while awaiting
root and file reads. A caller could replace commands, inventories, expected
source hashes, negative entries or project context mid-observation. Negative
dependency reads and executable resolution also inspected/swallowed errors
without first requiring their original resource observation to settle.

The observer now captures bounded canonical declaration bytes before its first
asynchronous operation. Declared file inventories must fit the original file
allowance before any filesystem observation; the existing per-read and aggregate
byte bounds remain. Commands/capabilities and tool/source/project/SDK/dependency/
variant/target/VFS inputs cannot change across awaits. Negative observation and
verification use the common failure owner before code inspection. Unconfirmed
executable resolution propagates its original prerequisite instead of becoming
ordinary non-durable output. Settled missing executable/negative outcomes retain
their existing conservative meaning. Profile format stays version 1; LSP semantic
producer 61 invalidates earlier observation-dependent replay.

Nine `tooling/providers/provider-profile-declaration-lifetime/*` controls are
authored, **unexecuted**: interleaved mutation of the complete declaration, file
budget before I/O, pending/markerless/settled negative observations, fresh negative
verification, pending executable resolution, frozen caller input and diagnostic
ordering. The snapshot case compares the actual receipt with an independently
observed original baseline. No compiler, installer, probe or child is launched.
Existing profile/source/SDK/dependency and orchestrator execution controls remain.

Format/ESLint, three JavaScript syntax checks, whitespace and zero shared-module
cycles passed; inventory regeneration produced no drift. No functional fixture,
native campaign or benchmark ran. #1146 remains partial for actual built-in
invocation/context binding and SDK/doctor reconciliation. Counts remain **481
pending / 144 partial / 93 unresolved** of 718 open issues. Source remains local
and unpublished while functional validation and the publication gate are deferred.
