# Service progress and Tantivy admission repairs — 2026-10-26

Qualified source: `8bf742ec6689409b43d3d95a1a5ea98d1dff5117`, branch
`codex/pr557-audit-repairs-20261012`, PR #572; Windows x64, Node 26.12.1.

## Delivered

**#1593 is completed.** Service progress receives exact build/attempt authority
from the executing daemon or subprocess after its required receipt is durable.
Normal startup waits for that callback without scanning retained generations.
Bound polls revalidate the current attempt, repository, stage and correlation;
an in-flight read cannot publish after an executor binding changes. Stage-3
receipts share the producer. Private child IPC rejects unrelated/PID-mismatched
messages, and inherited preloads leave descendant IPC protocols alone.

Compatibility monitors share a reference-counted repository discovery owner.
It reads incremental pages of at most 64 entries/state files, retains bounded
identity hints and backs off between scans. Every selected hint is freshly
revalidated before display. The original storage-directory owner drains reads
and confirms closure; failed closure cannot be bypassed by replacing its cursor.
Existing bounded/classified state reads, log format and captured shutdown drain
remain intact. See the [ownership contract](../contracts/service-progress-read-ownership.md).

**#1627 has a qualified partial milestone.** Tantivy auto-build preserves the
request-selected generation, uses the owned asynchronous/cancellable child runner,
and rejects wrong metadata versions/modes and invalid integer counts. Existing
Boolean/failure, filtered-recall and preflight controls pass. Immutable staged
publication, source/mapping receipts, reader lifetime, writer serialization and
native rebuild/readback remain required; the issue stays open. The optional
`tantivy` module is absent from this installation and lockfile. No arbitrary
dependency was installed and protocol fixtures do not count as native evidence.

## Qualification

Twenty unique affected fixtures have passing final observations: 15 service,
runtime, queue and logging fixtures, four Tantivy fixtures and the command audit.
The complete cheap front gate passed, including **40/40 gate fixtures**. Formatting,
config/environment budgets, generated freshness, command/workflow contracts and
diff checks passed. Cases use one job/thread, 30-second limits, zero retries and
native-status redo disabled; no final skips, timeouts or native crashes occurred.

Real-file work measurements separate resource bounds from latency claims:

| Retained roots | Waiting clients | Shared cycles | Bounded pages | State reads | JSON decodes |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 4 | 1 | 1 | 1 | 1 |
| 8 | 4 | 1 | 1 | 8 | 8 |
| 32 | 4 | 1 | 1 | 32 | 32 |
| 135 | 4 | 1 | 3 | 135 | 135 |

Two bound monitors over three polls perform six exact-state reads and no retained
directory enumeration/stats. The fixture advances a controlled discovery clock;
filesystem operations and byte/parse counts are real. No wall-time speedup is claimed.

Original failures remain recorded. The first new daemon fixture used an unsupported
argument; the fixture was corrected without changing parser admission. The inherited
`PAIROFCLEATS_TRUSTED_CONFIG` names a missing external file, so the command audit
correctly rejected that launch. Command/gate checks and the affected command fixture
passed in a task-local launch omitting only that stale selector. User settings and
trust rules were not changed; the default inherited launch still needs correction
by its configuration owner.

The [structured receipt](service-progress-repairs-2026-10-26.json) retains individual
observations, failures, work/byte counts, source/tree identity and launch scope.
Raw `.tmp/tasks/service-progress-20261026/` and `.testLogs/` evidence is historical
author-workspace material, not promised in clean checkouts. Dependencies remain
prepared; this batch changes no dependency, patch or Node pin and makes no new
native runtime qualification claim.

## Remaining queue

A fresh GitHub census confirms **738 open issues**: 477 awaiting qualification,
147 partial/follow-up and 114 with unresolved implementation status. No unexpected
new or removed entries appeared. The [complete owner queue](remaining-issue-batches-2026-10-26.json)
preserves the original issue bodies/classifications and records this closure and
the Tantivy milestone. Storage/source-publication and worker/provider correctness
remain ahead of performance expansion and external platform/model/release execution.
