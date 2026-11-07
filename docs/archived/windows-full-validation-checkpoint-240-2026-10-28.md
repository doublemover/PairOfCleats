# Checkpoint 240: full Windows validation

Implementation is frozen after the checkpoint-239 source/document batch on
`codex/pr557-audit-repairs-20261012`. The next commit is the requested 20-commit
boundary. The exact resulting candidate commit/tree and every later repair are
recorded with execution receipts; this document is the campaign scope, not a pass.

Read-only discovery on 2026-10-28 lists **6,153 cases**: 2,827 integration,
2,374 unit, 478 storage, 206 performance, 89 services, 73 gate-assigned, 45 API,
42 MCP, 13 smoke and six aggregate/other-lane cases. Discovery is not execution.
The ordinary `all` selection marks uninstall destructive; it still needs an
explicit disposable-root safety review and selection rather than an unexplained
omission. Ordered gate membership remains distinct from gate-assigned discovery.

Execution order:

1. Required front gate: format, config budget, environment contract, generated
   freshness, command surface, workflow contract, ordered gate and whitespace.
   Stop on each failed check, repair its owner and recheck that check.
2. New and directly affected search/SQLite/TUI controls, then explicit exhaustive
   correctness cohorts. Partition all discovered IDs and retain an accounting
   entry for every execution or legitimate exclusion. No unfiltered `all` run.
3. Native lifecycle, actual Windows terminal/supervisor and performance cohorts
   run serially. Build/test the Windows Rust TUI using its existing toolchain.
   Preserve production backends/settings, original latency thresholds and raw
   performance samples. No retries or native-status redo qualify a failure.
4. Reconcile implemented issues against their original/follow-up acceptance and
   exact resulting candidate. Close only demonstrated completions. Update the
   qualification matrix, roadmap, PR description/collapsed issue coverage and
   durable receipts. Commit/push qualified batches and verify remote SHA.

Each fixture has the existing 30-second bound, zero retries and native-status
redo disabled; focused work uses one job/thread. Correctness concurrency stays
bounded; measured/native work stays serial. Expected negative warnings must be
asserted. Timeouts, unexpected warnings, crashes and unexplained omissions remain
failures. A code repair invalidates affected earlier observations; final-source
qualification cannot combine unrelated earlier green revisions.

Node **26.12.1**, Windows x64, ABI 147 remains selected. Package SHA-256 is
`ab4c2f155a61809be3dad5f4ae75c35ff74d4f30f34cc13f280cb7463e0718fd`;
lockfile SHA-256 is
`8cf51352b92b21f18bf54b3cafb3ec5eb2e9f061a01be57d728d67e1953baf96`.
Both still match the locked prepared installation. Fresh native/patch verification
is distinct from runtime/crash acceptance; preserve the installation and bounded
original crash evidence before any repair that changes dependencies.

Scope remains Windows, solo, existing checkout: no WSL/Linux run, worktree,
subagent, elevated launch, security-setting change or arbitrary new symlink.
External/platform-only, optional sqlite-vec, real-model and release qualification
need explicit separate accounting and cannot be relabeled passing Windows cases.
Original native-crash attribution/regressions remain required where unresolved.

The discovery and machine receipts under
`.tmp/tasks/windows-validation-240-20261028/` are historical author-workspace
evidence. They are not promised in a clean checkout. Before this freeze, no
functional fixture ran in the solo implementation wave. Existing published
receipts keep their original revision-specific meaning.
