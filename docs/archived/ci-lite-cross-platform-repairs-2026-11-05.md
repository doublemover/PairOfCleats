# Cross-platform CI-lite repairs

Date: 2026-11-05. Baseline: `9eeb2811466097510d22e7e18908279ac3b19363`.
The [durable receipt](ci-lite-cross-platform-repairs-2026-11-05.json) retains original failures, source blobs, counterfactuals and final focused results. Its compact table/shared-value encoding is lossless.

## Demonstrated failures and repairs

[Run 41963709472](https://github.com/doublemover/PairOfCleats/actions/runs/41963709472) failed CI-lite on all three platforms: Ubuntu 1987 passed/1 failed, Windows 1986/1, macOS 1986/2. No outer timeouts were reported. All three hit the same required-job inventory omission: the new Windows index job was absent from the seven-entry policy. The inventory now names all eight required jobs; release guidance agrees. Gate policy and actual CI/nightly cohort selection now run in the front gate. Ordered lanes remain disjoint: 43 gate, 2022 ci-lite, 239 ci, 23 ci-long and 11 conformance cases, with 2338 total and no duplicates.

macOS additionally hit the API-export fixture’s nested 10-second setup timer. Original logs show compiler work and canonical publication/cleanup, then the setup abort before CLI assertions. This is not an access-violation receipt. The timer was introduced in `37d1a736ef`, before mandatory immutable-stage sealing in `364e1d085ab6d71a170cc764b216f77ae655dda3`; the fixture defines API correctness, not a ten-second latency contract.

That obsolete setup timer is retired. Every export identity, call/arity warning, report/schema, missing-input and strict exit-code assertion remains, as does the five-second public CLI limit. All ten JS/TS cases retain ordered membership and execute once in an independently scheduled serial cohort before the parallel lane. The complete case now has a strict 30-second bound instead of the broad CI lane’s 600-second bound. Retries and native-status redo are zero/disabled. Each platform uploads its dedicated report. This qualifies a correctness/resource bound; it makes no production latency claim.

## Evidence and limits

Pinned Node 26.13.0 on Windows x64/ABI147 passes all 15 focused cases: ten original compiler/API cases and five CI contracts, with zero failures, timeouts, retries or skips. The slowest case is 17.4 seconds. The original gate policy fails locally; the new scheduling contract also fails against the original suite owner. These before/after controls retain actual failure receipts.

Several diagnostic filesystem/hash optimizations did not reliably satisfy the obsolete timer. They and their experimental tests were restored to the baseline and do not ship. Their failed campaigns remain historical investigation evidence, not acceptance. Existing production cancellation, checksum cancellation and compiler-lifecycle coverage remains unchanged.

The same original hosted source separately passes the full 70-case Windows native partition (49 inspection/PTY/parser/producer and 21 index workflows), plus all 41 Windows authority cases. The receipt records exact jobs, log hashes and terminal witnesses. These are source-bound results for `9eeb2811466097510d22e7e18908279ac3b19363`, independent of its CI-lite failures.

All eight publication checks pass, including 43/43 front-gate cases with no failures, timeouts, retries or skips. Replacement hosted results are pending push and execution. Local Linux/macOS execution is not claimed. Native Tantivy qualification remains deferred; editor and physical-platform exclusions remain unchanged. Author `.tmp/` and `.testLogs/` paths are historical and need not exist in clean checkouts.
