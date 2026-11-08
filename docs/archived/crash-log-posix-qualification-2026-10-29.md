# Crash-log POSIX closeout

Issue #1315 is completed. The original Windows ownership and latency receipts
remain in [the Windows qualification](crash-log-latency-qualification-2026-10-29.md).
The [machine receipt](crash-log-posix-qualification-2026-10-29.json) retains both
hosted ten-case reports and every raw latency sample.

The [Linux job](https://github.com/doublemover/PairOfCleats/actions/runs/40836890554/job/123325922752)
and [macOS job](https://github.com/doublemover/PairOfCleats/actions/runs/40836890554/job/123325922673)
each pass 10/10 serial cases, zero retries, timeouts or skips, on Node 26.13.0.
They execute merge `33b404551b9660855c5659ceccbdb3693d127bee`. Its full Git tree
equals PR head `e9704cc61730ec71b4f5ef13819134d5ec67b273`:
`6a79d50659620970632cea2687a9f2b8d99df40e`. This is read-only hosted evidence;
no WSL or local Linux execution was used.

| Platform | Small-log sync/settled p95 | Long-log sync/settled p95 |
| --- | --- | --- |
| Linux x64 | 3.13 / 6.27 ms | 3.39 / 6.52 ms |
| macOS ARM64 | 19.83 / 44.66 ms | 15.96 / 34.37 ms |

Each case uses three warmups and twenty samples, two independent append sinks,
and the original 250 ms synchronous / 1,000 ms settled bounds. Every sample
requires original error/redaction, terminal precedence, unchanged append-file
identity and before/error/after order. Lifecycle controls retain held writes,
close ownership, independent failures and terminal disk failure.

The downloaded quality ZIPs match GitHub's SHA-256 digests. Their IDs and hashes
are retained in the machine receipt, with the selected test outcomes and raw
measurements copied into this durable archive. Author-workspace download paths
are historical and are not required in a clean checkout.

This closes the logger defect and its bounded error-path qualification. The
broader CI jobs still fail independent fixtures; these observations do not
qualify the whole suite or representative application latency.
