# Windows source costs and issue closeout — October 30, 2026

Source `7c634655e5b2cd70154421daa8fa40329f07e78c`, branch
`codex/pr557-audit-repairs-20261012`. The [companion JSON](windows-source-cost-closeout-2026-10-30.json)
retains all nine capsule reports, original raw-receipt hashes, publication checks
and twenty-nine verified GitHub closure readbacks. Local execution was Windows x64,
Node26.13.0, one serial child at a time, 30-second deadlines and zero retries.
Author-workspace `.testLogs/` and `.tmp/` paths are historical.

## Measured consumers

Six actual comparison CLI lifetimes each execute six queries for two models.
Three repetitions keep one generation; three promote independent generations.
The original descriptor-read observer proves one corpus read per admitted model
generation, exact bytes and confirmed close. Stable generations retain two corpus
receipts/3,394 JSON bytes; changing generations retain seven/12,006 bytes.
Query latencies, registry IO and execution-receipt bytes are recorded separately.
These are logical append-only registry peaks, excluding object/native overhead;
the tiny existing-cache corpus does not measure model inference or a historical
speedup. The earlier failed oracle incorrectly conflated cold/disk-hit execution
states with corpus reads. It is preserved; the repaired oracle matches actual
child cache evidence without weakening the original corpus-read assertions.

Three actual locked-Piscina lifetimes execute16 ordinary nonempty tasks across
single/batch tokenization, quantization and file analysis, then naturally cancel
each task family and verify healthy replacement work. Original Worker exit precedes
public settlement and peer admission; scheduler tokens, bytes and language throttle
remain owned until that exit. Twelve cancellations exit in **1.805–6.072ms**.
The ordinary mixed workload records **172.4–181.1 tasks/s**; its loop includes
verification/hash overhead, while per-task walls exclude it. Cold startup is
separate. Observed original/replacement thread peak is one at recorded lifecycle
events. Every original facade and scheduler settles with zero live threads,
running tasks, CPU tokens or in-flight bytes. No artificial termination/exit hold
or sleep sampler supplies these measurements.

The first Python source-cost capsule completed its content/replay assertions but
the controller rejected36 normal import-progress lines. Its invocation remains
recorded as failed. The scoped progress repair and source-cost recheck are pending
in this checkpoint; no Python campaign pass is inferred from that child result.

## Publication and issue state

All eight publication checks passed on the recorded clean source, including
**41 gate tests, zero failures/timeouts/skips**, generated freshness, environment,
configuration budget, command surface, workflow contracts and diff checks.
The branch was pushed and its exact remote SHA and PR572 summary were read back.

The complete [26-report requirement review](p2-p3-acceptance-review-2026-10-30.json)
supports twenty completed reports now closed with individual `closed/completed`
GitHub readbacks: **#798, #985, #1033, #1076, #1437, #1477, #1483, #1493, #1501,
#1565, #1577, #1578, #1586, #1702, #1750, #1752, #1760, #1761, #1764 and #1766**. The further 14-report review confirms nine more closures:
**#1753, #1754, #1762, #1763, #1747, #1748, #1757, #1374 and #1375**.
Original reports/follow-ups remain intact, with a source-bound resolution appended.

Current reconciliation: **791 reports, 401 closed/390 open**. P2/P3 intake remains
346 reports: **313 qualified closures, 27 remaining targets and six editor
exclusions**. Prior ledgers retain their historical counts. Comparison/thread
follow-up measurements now complete #713/#1102's recorded measurement gaps;
their closures await publication of this receipt and final requirement readback.

At this checkpoint, remaining work included Python source costs, canonical Python
payload-ID coverage and CSS/Lua traversal admission; the subsequent
[source-consumer qualification](windows-source-consumer-qualification-2026-10-30.md)
records their focused results. Complete SQLite build/update qualification,
deadline repeatability and issue-specific optional/model/platform requirements remain.
No new full-suite or non-Windows acceptance is claimed.
