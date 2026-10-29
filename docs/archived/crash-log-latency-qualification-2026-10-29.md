# Serial crash-log latency qualification

The remaining Windows latency acceptance for #1315 now has measured evidence.
The [machine receipt](crash-log-latency-qualification-2026-10-29.json) retains all
40 samples, original terminal artifact hashes, source identities and commands.
The [earlier ownership receipt](crash-log-qualification-2026-10-27.md) retains
the repaired append/state defects, native sharing refusal and original failures.

## Workload and results

The two independently bounded cases use the actual logger with its legacy and
attempt-owned append sinks. Each performs three untimed warmups and 20 serial
measured samples, first with small logs and then with two existing 2 MiB logs.
Construction, filler writes and later forensic-bundle export are outside the
measurement. The synchronous sample includes `logError`; the settled sample also
includes its actual append/state flush. The controls retain raw unsorted samples.

| Windows x64 / Node 26.13.0 | Synchronous p95 | Settled p95 |
| --- | ---: | ---: |
| Small logs | 10.37 ms | 16.12 ms |
| Two 2 MiB logs | 9.92 ms | 16.49 ms |

The new local-filesystem regression budgets are 250 ms synchronous p95 and
1,000 ms settled p95. They have no environment/configuration override. These
are warm error-persistence bounds, not throughput, cold-start, slow-volume or
forensic-export measurements. Existing resource/memory bounds remain separate.

Every sample must publish the original error code/message with credentials
redacted, retain terminal error precedence after a later phase, preserve both
append-file identities and retain the before/error/after records in order.
Positive witnesses must all exist before their positions are compared. Reads
inspect only a bounded log tail; the production implementation is unchanged.
Only fully closed private fixture logs are truncated between samples, keeping
fixture disk use independent of the sample count. The final logs remain intact.

## Execution and remaining acceptance

All ten focused Windows cases pass in 5.4 seconds with one job/thread, 30-second
deadlines, zero retries/native redo and no skips or unexpected warnings. The
eight existing controls include two-process append ownership, a held earlier
state write, error before open/during a pending append, long-log no-read/no-replace
bounds, independent sinks and terminal/latest-pointer disk failures.

CI now runs this exact ten-case group serially before each platform's broader
suite, and retains the report and raw sample-bearing test logs. The original
controls retain their inputs/assertions; no replacement semantics are simulated
away. The workflow contract requires the cases, strict bounds and report upload.
The publication checks and exact candidate identity belong to the machine receipt.

**#1315 remains open until hosted POSIX lifecycle/replacement execution passes.**
No WSL, local Linux, symlink creation, retries or elevated permissions were used.
Author-workspace `.tmp/tasks/ci-and-p1-20261028/` receipts are historical and absent
from clean checkouts; the committed samples preserve the measured observations.
