# Read-only command preparation — 2026-10-28

**UNVALIDATED source:** `da87a022ec8a3e75068b3ad69805b3bf38863338`, tree
`2fe3abcc03e0d8ae755c2b08bb06c1246ef2704c`, branch
`codex/pr557-audit-repairs-20261012`, Windows x64, Node 26.12.1.

Qualified invocation preparation must not launch children or acquire persistent
resources for a plan later discarded by cache selection. The existing command
profile resolver combined discovery/policy selection with version/help probes.
Using it during preparation would start work before the actual execution owner.

One private selection owner now serves both `resolveToolingCommandProfile` and
the internal read-only `resolveToolingCommandSelection`. It retains bounded
candidate discovery, canonical managed .NET host selection, repository/workspace
execution policy, requested/resolved arguments and explicit blocked outcomes.
Real preflight continues its existing probe, layout validation and provider mode
handling after that same selection. Read-only success has `probe.ok: null` and
zero attempted probes, never a fabricated successful runtime receipt. Its exposed
command/argument selection is immutable; fresh calls re-observe file metadata.

Eight `tooling/providers/command-selection-readonly/*` controls are authored,
**unexecuted**: explicit/path selection, argument immutability, missing and directory
candidates, denied repository execution, cancellation and fresh replacement bytes.
All subprocess entry points are instrumented to throw if called. Missing,
directory and untrusted selections compare directly with blocked real preflight.
Existing command profile/cache/doctor and authority tests remain required.

Format/ESLint, two JavaScript syntax checks, zero shared-module cycles and
whitespace passed. No functional fixture, child, native operation or benchmark
ran. This is a preparation prerequisite; built-in launch/environment/project
binding and SDK/doctor reconciliation remain #1146 source work. Current source
counts remain **481 pending / 144 partial / 93 unresolved** of 718 open issues.
Source is local/unpublished; publication front gate remains deferred.
