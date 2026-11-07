# Repository cleanup admission — 2026-10-27

Qualified source: `06c3324d00392da08fca6025e55c3ecb8aff9458`, tree
`cfd597d14c3c8ebd49b116672978bd671e6c886d`, branch
`codex/pr557-audit-repairs-20261012`, PR #572. Windows x64, Node 26.12.1.

This advances #1574 without closing its custom-backend follow-up. Canonical
repository cleanup previously checked only legacy reader admission. Newer
resource sessions use a separate coordination namespace, so an admitted modern
reader could coexist with deletion. Cleanup now composes both existing
exclusion protocols and pins its launch-selected cache categories against
relocation. Preview reports modern live/unknown owners as protected too.

The caller retains the existing producer classification, builder checks,
saved-evidence protection, authority markers, inventory bounds and deletion
requalification. The new composition supplies admission and resource lifetime;
it does not grant deletion authority or introduce another collector.

After failed native work, both exclusions and the category session remain
retained behind the original descriptor observation. Explicit recovery first
settles that descriptor, then closes the same metadata owner. No native read or
close is repeated automatically. Ordered metadata cleanup also preserves an
ordinary primary work error when lock removal fails, retaining both exact
causes and a recovery capability rather than replacing the primary in a nested
finally. Confirmed phases are not replayed on later reconciliation.

**8 affected cases pass**, plus the complete cheap front gate including **40/40
gate cases**. New controls exercise actual CLI/MCP modern readers, a reader
arriving between preflight and apply, legacy/modern admission rejection while
cleanup owns exclusion, actual index-writer admission, category pinning,
unreadable leases, saved triage evidence, native descriptor close failure and
work-plus-metadata failure. Existing legacy reader, ordinary cleanup, unknown
authority and writer-category controls remain. The previous cleanup owner fails
the new CLI regression by reporting success while a modern reader is admitted.

Formatting/ESLint, configuration/environment, generated freshness,
command/workflow and whitespace checks pass. One job/thread, 30-second
deadlines, zero retries and native-status redo disabled apply. Final
observations contain no failures, timeouts, skips, crashes or unexpected
warnings. An initial metadata-case assertion incorrectly required the original
cause at one wrapper depth; the corrected assertion checks the exact root of
the primary cause chain and exact secondary identity through the existing
context wrappers. Its failed receipt remains historical.

The [structured receipt](repository-cleanup-admission-2026-10-27.json) records
source identity, cases, prior-owner control and gate commands. Raw
`.tmp/tasks/backend-cleanup-20261027/` and `.testLogs/` receipts are historical
author-workspace evidence, absent in clean checkouts. Dependencies, patches
and Node are unchanged; current readiness passes against the earlier clean
native/patch verification. Task children omit only the inherited missing trust
selector; user/global settings are unchanged. No Linux/WSL or elevated checks
were run.

Custom SQLite/LMDB/backend registration, physical reader/probe/cache/builder
lifetime adoption, category-specific disposable-output requalification and
remaining multi-repo/backend controls are still required for #1574. External
backend roots remain protected. Broader lifecycle/quota policy remains #1267;
full Windows and other-platform/model/performance/release qualifications are
separate. The last reconciled census remains 723 open issues.
