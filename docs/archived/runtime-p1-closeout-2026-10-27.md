# Runtime ownership and P1 closeout — 2026-10-27

Qualified source: `3a1d088135d5a1abff87945fe6641773a8953090`, tree
`c446ac230972df6b418b2b718e4f22a9a7f0bef4`, branch
`codex/pr557-audit-repairs-20261012`, PR #572. Windows x64, Node 26.12.1.

## Completed scope

| Issue | Result |
| --- | --- |
| #1074 | Runtime cleanup stops its own admission, drains accepted work and releases only its parser/LSP references and exact preflight children. Shared pools, other workspaces and process-owned caches retain their original lifetime. |
| #1073 | The final receipt failure now has a real Piscina unwind witness: pending work settles, threads and queue reach zero, reverse cleanup continues and original ENOSPC/secondary cleanup failures remain observable. |
| #1050 | Existing two-pass UID allocation is qualified for forward/backward, cyclic, self, metadata, call-site and risk-sidecar references. Ambiguous identities reject before mutation. |
| #1072 | Existing bounded invalidation is qualified with zero/one stale-edge checks. The unchecked importer resolves the added target; unrelated resolved entries stay warm. |
| #1106 | Existing promotion refuses unreadable prior mode authority before pointer mutation, and preserves the exact prose generation during a readable code-only promotion. |
| #1107 | Existing search/root resolution refuses staging and repo-local/cache-root marker fallbacks when current mode authority is missing; explicit references retain separate admission. |

#1074's follow-up still needed source repair despite its qualification-pending
tracking label. Runtime scopes use the existing lifecycle and component disposal
owners. Equal parser policies construct one scoped pool for two runs. Actual
Python, native Tree-sitter workers, LSP and preflight transports remain usable by
B when A finishes or is cancelled. Distinct/shared workspaces and independent
host caches are covered. Retained A views reject new work after teardown.

Original asynchronous creation remains owned through cancellation. Shared child
tracking is independent of its creator file. Python replacement waits for actual
close and retains tree-cleanup failure; a pending executable probe cannot become
"Python unavailable". Scope drain deadlines retain the actual settlement observer.
Late native completion and category lease release remain separate. Explicit
original-owner reconciliation does not repeat disposal or rewrite failed outcomes.

The import-cache matrix initially lacked the extraction receipt now required by
production reuse. Its positive bundle now carries a receipt from the actual
scanner, retains the original import assertions and adds fingerprint-only
rejection. No source admission, deadline, assertion or cache contract was relaxed.

## Verification

**37 unique affected fixtures have passing final observations**, plus the
complete cheap front gate, including **40/40 gate cases**. Formatting/ESLint,
configuration/environment checks, generated freshness, command/workflow contracts
and whitespace checks pass. Fixtures use one job/thread, a 30-second deadline,
zero retries and native-status redo disabled. Final observations have no failures,
timeouts, skips or native crashes. The strengthened scope, timeout and
initialization controls are listed in the [contract](../contracts/runtime-worker-cleanup-admission.md).

The exact previous teardown module from `567b36acd` fails the same overlap
regression: A does not acknowledge its scope, B's parser admission closes and B's
preflight is cancelled. Other current modules stay fixed for this boundary
counterexample; no checkout reset or dependency rebuild is involved. The repaired
source passes. The initial logging-fixture failure and import-matrix failure are
preserved alongside their corrected observations.

Required dependencies, patches and the Node pin are unchanged. Previously clean
native/patch verification remains recorded; this batch also passes readiness and
executes real Python/native operations. The task child omits only the inherited
selector for a nonexistent trusted-config file. No global/user setting changed.

The [structured receipt](runtime-p1-closeout-2026-10-27.json) records source/tree,
all final fixture observations, front-gate commands, expected baseline failure,
initial failures, issue closures and live census. Raw `.tmp/tasks/p1-closeout-20261027/`
and `.testLogs/` paths are historical author-workspace evidence, absent in clean
checkouts. They are not required downloads or portable artifacts.

## Remaining work

The live census confirms **730 open issues**: 469 awaiting qualification, 147
partial/follow-up and 114 with unresolved implementation status. The
[owner queue](remaining-issue-batches-2026-10-26.json) preserves baseline
classifications and records these six closures.

#1397 still requires actual delayed-child stage-closeout integration; the scoped
runtime and timer controls alone do not close it. #1574 needs custom storage
registration and reader/writer adoption. #1627 still needs Tantivy immutable
publication/mapping/read-lifetime proof and the optional native installation.
Full Windows, representative performance, optional models/backends, non-Windows
and release qualifications remain separate. No Linux or WSL checks were run.
