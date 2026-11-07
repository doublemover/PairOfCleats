# Windows terminal budget and exit cleanup — 2026-11-04

[CI41927604528](https://github.com/doublemover/PairOfCleats/actions/runs/41927604528)
at0a469b42f passes Windows subprocess ownership and authority. Native inspection
passes34 cases and fails workspace with direct status1. The complete original
workspace artifact is retained in the [machine receipt](windows-terminal-budget-repair-2026-11-04.json),
bound to the hosted ZIP digest. This is not an access violation.

The original trace records an11.054s canonical seed inside the26-second terminal
capture. The real workspace job completes at23:07:45.946Z; supervisor stdin
closes at23:07:46.118Z, near the26-second capture deadline. The native receipt
records exit0, empty stderr and restored console modes. Capture times out while
settlement/output drain remains outstanding. AttachConsole then fails in
node-pty's forced-cleanup helper; that last error does not attribute the timeout.

Workspace now runs its unchanged real seed before terminal capture, matching
the existing portable setup sequence. The complete keyboard, workspace launch,
canonical publication, status, exit, restoration and process-reaping assertions
remain. Neither the26-second terminal bound nor30-second fixture bound changes.
The focused actual workflow passes28.820s; no retry or skip is used.

A separate installed-owner regression fails before repair: an agent whose
original native monitor already reports exit still enumerates that vanished
console. Confirmed exit now proceeds directly through original native close
and bridge disposal. Unknown/live shells keep their existing discovery path.
This avoids the confirmed-exit attachment race without hiding other failures.

Eleven final controls pass, including ten explicit fresh processes. Each executes
two natural real PTYs, cleanup again after confirmed natural exit, and owned
live cancellation; every original PID is gone. The required native probe now
executes post-exit cleanup too and exits naturally. Exact package round-trip
checks bind all six original1.1.0 source prefixes independently of patch headers.
The repaired patch retains seven packages,26 targets and73 hunks. Fresh native
verification is warning-free. Hosted acceptance of this follow-up remains pending.

The receipt preserves the initial patch-construction mistake and correction;
no prior-patched preimage was published. The native C++ snapshot and model
consumer owners are unchanged by this follow-up. Model observations remain
bound to0a469b42f; no new full-suite or final-head campaign pass is inferred.
Scratch paths are historical author-workspace receipts.

All eight publication checks pass for this batch, including41 gate cases.
The machine receipt binds final tested implementation files and verification.

## Hosted Windows closeout

Exact source1d53c5262 passes all70 native-inspection cases:35 actual terminal/
artifact/index workflows,12 PTY disposal/patch controls,19 parser lifecycle/
native patch controls and four typed producer contracts. Workspace passes23.9s.
There are zero failures, timeouts or skips. The [hosted receipt](windows-hosted-native-closeout-2026-11-04.json)
retains the complete verification/test log segment and exact job/source. Fresh
37-package/33-route verification passes seven patches,26 targets and73 hunks
without warnings/errors. Source compilation separately retains247 legacy
WinPTY compiler warnings and one transitive npm deprecation; those are not
clean verification output. The broad Windows CI suite remains separate.
