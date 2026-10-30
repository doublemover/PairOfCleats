# SQLite operation ownership implementation — 2026-10-27

**UNVALIDATED implementation:** source `47ca8bea98676b43aa86dfb53e23adbb94036bf3`,
tree `e33a6b1152d21cd71ab97b3d524e3e51d782903a`, branch
`codex/pr557-audit-repairs-20261012`; Windows x64, Node 26.12.1.
This source was committed locally while functional qualification is deferred at
the user's request. It is not a passing-test or hosted-CI receipt. Dependencies,
patches and native binaries were not changed or re-bootstrapped.

## Implemented span

- The production runner captures effective repository/cache/temp authority before
  source planning. Explicit-context artifact, bundle and incremental helpers use
  the same operation owner; inherited calls join bounded accepted child work.
- Existing repository/storage leases protect canonical resources and the captured
  temporary category through source/native work, publication and asynchronous
  heartbeat/display finalization. Native fallback paths use that captured category.
- Exact native/sidecar admission precedes access. Duplicate targets share admission;
  bounded candidate/mode work permits 256 unique resources in batches of at most
  64. A failed admission cannot be cleared for another native route.
- Original pending observations remain required. Resource metadata releases before
  enclosing categories; leaf metadata failure retains category exclusion. The
  non-enumerable recovery owner permits only explicit metadata reconciliation
  after real resources and accepted work settle.
- WAL publication captures original physical close before checkpointing and
  preserves frozen primary/cleanup errors. Sidecar cleanup joins both removals,
  retains warning failures and cannot soften pending resource ownership.
- Failure reporting and checkpoint flushing preserve original failures. A failed
  staging-main removal preserves its sidecars. Pending checkpoint/diagnostic work
  cannot become an ordinary warning followed by false resource settlement.
- Contradictory compact flags reject before source IO. Runner exit closures are
  removed once; known asynchronous finalization precedes completed phase marking.

No public CLI/config knob or deletion authority was added. Custom/external roots
remain protected; context-free benchmark helpers remain outside this adoption.

## Deferred qualification

Authored, not executed: seven `shared/storage/sqlite-operation-lifetime` cases,
five `storage/sqlite/build/storage-session-dispatch` cases, six
`storage/sqlite/sidecar-settlement` cases and three
`storage/sqlite/build/runner-finalizer-storage` cases. The existing exit-listener
fixture now supplies explicit owned context and distinguishes the one shared
lease-protocol hook from invocation-specific closures.

Pending execution includes those 21 cases, affected existing SQLite writer,
native-reader, generation-selection, cancellation, WAL, sidecar and error-contract
fixtures, controlled prior-owner regressions, and the required publication front
gate. Runs must retain one job/thread, 30-second fixture bounds, zero retries and
native-status redo disabled. No earlier source's green observations qualify this
implementation. Fix genuine failures; do not weaken assertions or contracts.

Completed static observations only: ESLint format, JavaScript syntax checks,
configuration budget, whitespace checks and static shared-module cycle analysis
(zero cycles). None exercises the new runtime lifecycle. No GUI, WSL, elevation,
physical link, security setting or user-cache cleanup was used.

## Remaining implementation

#1574 remains open for custom/external backend registration with producer and
publication identity, category-specific eligible deletion/requalification,
remaining adapters and all/multi-repo CLI/MCP acceptance. #1267 retains common
lifecycle/quota policy. Next owner work is #1627's source-pinned Tantivy publication.
Optional native-package execution and other-platform/release/model/performance
qualification remain separate. The active roadmap remains the sole status owner.
