# Validation integrity closeout — 2026-11-05

Issue #1252. Parent source: 0536c89e9e62c83b96a57f65533a3c7898d765a8.
The [machine receipt](validation-integrity-closeout-2026-11-05.json) retains exact source hashes, six original failures, all 24 raw samples and 70 distinct focused passing cases. The [contract](../contracts/validation-read-fusion.md) describes ownership and scope.

The complete strict validator has measured qualification against its current eager-checksum control. Only invocation-local read-plan creation is disabled in the control; every original schema, identity, count, checksum and source-selection check remains active. Complete reports match at the same physical root. All six fresh processes per scope also have matching input and explicitly projected output digests. The projection asserts mode/backend paths before making them relative; full-report comparisons retain every original absolute path.

The 21 new correctness cases cover JSON, JSONL, gzip and four-part JSONL with SHA1/SHA256/xxh64, empty artifacts, hot/cold merging, checksum-only binary data, corrupt/truncated/missing data, unsupported checksums, non-strict warnings, backup refusal and actual short UTF8 reads. Nineteen existing controls cover the full index contract matrix, same-stat mutation, generation replacement, cancellation, resource disposal, byte limits and binary integrity receipts.

| Scope | Actual bytes, eager → fused | Opens | Median wall ms | Median CPU ms |
| --- | ---: | ---: | ---: | ---: |
| Small, first validation | 7,735 → 4,428 | 16 → 8 | 226.58 → 223.00 | 219 → 235 |
| 4.3 MB JSONL, first validation | 8,599,189 → 4,300,158 | 16 → 8 | 249.76 → 258.68 | 282 → 313 |
| Four-part JSONL, first validation | 8,601,261 → 4,301,634 | 24 → 12 | 290.94 → 280.75 | 297 → 313 |
| Three warm full validations | 25,793,589 → 12,900,474 | 45 → 24 | 208.59 → 186.01 | 219 → 203 |

The 24 measurements run serially, three fresh processes per scope/arm, with 10-second child bounds and unchanged 30-second fixture limits. The first three scopes time the actual first validation; only warm performs untimed parity/warmup first. Filesystem pages are warm from fixture creation. Every warm invocation still hashes actual bytes and every unconsumed binary still receives its checksum. Wall/CPU and sampled heap are mixed; no universal latency or memory improvement is claimed. Raw heap/RSS remains in the receipt; RSS includes preparation and any warmup. Full indexing, cold-device throughput and model inference are outside this measurement.

Qualification also repaired a real fixture-health lifecycle defect related to #1242. The helper previously published authority before confirming original descriptor closure, accepted a false close result and could lose falsey/frozen original read errors. It now uses the existing contained-file disposal owner and publishes after confirmed close. The outer snapshot classifier propagates unresolved ownership before it can admit a rebuild. All six new controls fail against the original helper and pass after repair. The snapshot control starts from actual positive admission and permits fresh authority only through a new independent evaluation after explicit close-only recovery. No arbitrary symlinks, retries or security changes are used. #1242 remains open for its broader fixture-health performance/locking qualification.

All 51 new IDs have ordered membership; the 24 measured IDs use the existing serial runtime owner (163 cases). Earlier fixture-authoring failures and an initial all-warm/path-bearing measurement projection remain historical author-workspace observations, superseded by the final raw receipts. No original failure is reclassified as a pass.

CI2176 at the source parent passes the previously failing native workspace (22.7 s) and its strict status companion (17.6 s). The family has 21 passes and one different timeout: search-published, 30.2 s. That timeout remains open; this receipt does not claim full hosted acceptance.

All eight publication checks exit 0, including 43/43 gate cases. Ordered ownership is 2,365 ci-lite/239 ci/43 gate/23 ci-long/11 USR (2,681 total). The gate’s actual CI-plan discovery check passes at 21.7 seconds. Generated inventories are refreshed, with no missing or duplicate ordered IDs.
