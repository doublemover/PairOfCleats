# Stage-closeout repair — 2026-10-27

Qualified source: `45e216edcf2184d3d22ab58ec8feb0ad52aa6610`, tree
`71e3e6ff3d87eb6c83c56b98dfdd15262a261ba1`, branch
`codex/pr557-audit-repairs-20261012`, PR #572. Windows x64, Node 26.12.1.

## Completed issue #1397

The actual Stage1 integration exposed two remaining defects beyond the earlier
capsule: termination errors lost their original late-close observer, permanently
blocking explicit runtime reconciliation, and cancellation could race ahead of
started subprocess cleanup through the ordinary queue abort path.

The existing tracking owner now binds receipts to the original registered close
promises and tree-attempt outcomes. Public audit edits and copied reports cannot
replace that observer. Rejected async/sync tree attempts retain their original
exceptions and remain blocked after direct-child close. Incomplete selections
cannot claim another in-flight attempt's lifetime. The Tree-sitter scheduler uses
the existing settled-work concurrency owner, preserving started failures through
cancellation with the original signal contract and zero retries.

The new fixture executes real `runStage`, scheduler, scoped child, cache lease,
writer lock and closeout registry. A selective termination fault returns false
for that fixture child; all other child cleanup retains its actual implementation.
The child continues a heartbeat behind the held lock. Timeout and cancellation
both preserve the original error and refuse competing writer admission. A real
delayed close does not itself invalidate/release the lease. Explicit original
runtime reconciliation admits the next writer, and repeated old teardown cannot
release the newer lock. No full index or unrelated process is involved.

## Proof and checks

**14 affected fixtures pass**, plus the complete cheap front gate, including
**40/40 gate cases**. Final stage controls assert the expected withheld-release
diagnostics and reject Node deprecation/experimental/syntax warnings. Formatting,
configuration/environment checks, generated freshness, command/workflow contracts
and whitespace checks pass. Fixtures use one job/thread, a 30-second deadline,
zero retries and native-status redo disabled. Final observations have no failures,
timeouts, skips or native crashes.

Loading only the previous `729a1b58f` termination validator makes the final real
stage regression fail after the actual delayed close: explicit reconciliation
rejects `ERR_INDEX_RUNTIME_STORAGE_PENDING`. The current validator passes the
same scenario. Original failing integration/cancellation observations remain in
the [structured receipt](stage-closeout-repairs-2026-10-27.json), alongside exact
source/tree, all final cases, gate commands, issue closure and census.

The coverage includes confirmed parser degradation, frozen errors and secondary
diagnostic failures; zero/nonzero-failure unconfirmed receipts; actual delayed
close; native tree rejection; original-handle/PID replacement; and all four
overlapping-runtime parser/LSP/preflight controls. The timer fixture's captured
native promise is observed after its actual microtask; its failed receipt remains
unchanged. Failed outcomes are never rewritten into successful attempts.

Dependencies, patches and the Node pin are unchanged. Previously clean required
native/patch verification remains recorded; current readiness and actual native
fixtures pass. The task child still omits only the inherited selector for a
missing trusted-config file. User/global settings are unchanged.

Raw `.tmp/tasks/stage-closeout-20261027/`, earlier
`.tmp/tasks/p1-closeout-20261027/` and `.testLogs/` receipts are historical
author-workspace evidence, absent in clean checkouts.

## Remaining scope

The live census confirms **729 open issues**: 468 awaiting qualification, 147
partial/follow-up and 114 with unresolved implementation status. The
[owner queue](remaining-issue-batches-2026-10-26.json) records this closeout and
retains baseline classifications. Registered custom storage (#1574), Tantivy
immutable publication (#1627), the remaining owner batches and full Windows,
representative performance, optional backend/model, non-Windows and release
qualifications remain separate. No Linux or WSL checks were run.
