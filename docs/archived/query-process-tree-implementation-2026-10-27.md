# Query failure drain and Windows descendant observation — 2026-10-27

Source `5b093bb96534213791e7633ac73105628e6123de`, tree
`eba0e058bd82473ab0442c10dd2bc5fdace5fa9a`, branch
`codex/pr557-audit-repairs-20261012`. Windows x64, Node 26.12.1.
Unpublished source; functional/performance qualification remains deferred.

The aggregate benchmark query executor now uses the existing settled-concurrency
owner. Failed work stops further task execution, already-started queries settle,
then the pool and phase observer close. Primary and secondary cleanup failures
remain in the original failure graph with diagnostic counters. This repairs the
prior early rejection/pool-close ordering without retries, reduced backend
coverage, raised deadlines or relaxed resource admission.

A separate read-only Windows observer uses bounded hidden noninteractive
PowerShell/CIM through the existing subprocess owner. It preserves decimal UTC
creation ticks, parentage, byte-valued working sets, observed orphan incarnations,
observer exclusion, unresolved ancestry and incomplete resident-byte states.
Unrelated command lines/paths/environment are never retained. Census/selected
process/sample/event/lifetime/phase/output limits are explicit. Failed or noisy
observer output is unavailable, never a qualified zero. An unsettled observer
retains the original resource failure and cannot trigger another observer.

Phase scans, pool start/close events, observed process lifetimes and reappearance,
missed worker lifetimes, sampling gaps, capacity limits and observer cost remain
in the report. The existing parent/known-worker RSS metric remains separate.
Tree scan sums are sampled lower bounds, not atomic instantaneous high-water
marks; short-lived or inaccessible work is not fabricated. Other platforms are
unsupported by this observer. Benchmark wall time includes observation overhead.

Thirteen cases are authored, **unexecuted**, covering descendant/exclusion,
creation precision/PID reuse, orphan retention/ambiguity, partial/invalid data,
phase/lifetime gaps, bounds, serialized observations, unavailable/unsettled
observers, unsupported platform, command admission and actual query failure drain
with a blocked sibling and secondary close failure. The existing run-plan caller
fixture explicitly supplies no OS observer to its fake workers.

Format/ESLint, changed-JavaScript syntax, config budget, script inventory and
whitespace checks passed. The exact embedded PowerShell literal also parsed with
zero syntax errors through the PowerShell parser; it was not executed. No CIM
query, project functional fixture, real process census or benchmark ran here.

#1675 remains open for actual Windows parent/worker/native-descendant lifecycle,
observer availability/close behavior, gap/cap coverage, output parity and serial
resource/performance qualification. Existing aggregate admission still needs its
final-source checks. #1663 retained-reference retirement and #1733 representative
SQLite trials remain separate outstanding work. See the
[measurement contract](../contracts/benchmark-process-tree-memory.md).
