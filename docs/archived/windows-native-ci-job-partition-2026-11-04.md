# Windows native CI job partition — November 4, 2026

The original Windows job cancels immediately after 35 passing real-terminal
cases. Its log starts at 01:20:16.614Z and cancels at 01:40:17.439Z, matching
the configured 20-minute aggregate job deadline. Locked bootstrap alone takes
614.063s, verification 7.312s, actual Rust build 35.721s and the terminal cohort
505.002s. The later 12 PTY,19 parser/patch and four producer cases never start.
There is no fixture timeout or native access violation in this failure.

[GitHub documents the job timeout as an automatic cancellation boundary](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idtimeout-minutes).
The [machine receipt](windows-native-ci-job-partition-2026-11-04.json) retains
the original source/job, phase timestamps and result inventory. This is an
oversized aggregate qualification lifetime, not a reason to raise fixture limits.

Windows index workflows now have a separate 20-minute job for 21 actual cases.
The existing Windows native-inspection job keeps 49 cases:14 inspection/artifact
actions,12 PTY disposal/patch cases,19 parser/patch cases and four producer
contracts. Every test stays serial within its job, one indexing thread, 30-second
fixture limits, zero retries and native-status redo disabled. Exact source
checkout, real binary compilation, original assertions and all bounded native
witness uploads remain. Artifact names are distinct. Linux/macOS retain the
original 70-case selection; no local non-Windows execution is introduced.

Both Windows jobs borrow the existing OS/architecture/Node/lockfile/patch-bound
dependency cache using restore-only access. An exact hit avoids redundant
installation, but actual native/patch verification always runs before tests.
A miss or partial hit takes the unchanged locked bootstrap; stale or corrupted
prepared bytes cannot bypass verification. Native headers stay with the cached
modules. These jobs do not publish competing cache entries.
[Cache semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#cache-action-usage)
and the existing CI cache owner remain distinct from runtime readiness.

The strengthened workflow contract discovers the real fixture inventory and
uses the runner matcher to prove a disjoint 49+21=70 Windows union, with no
omissions, overlaps, retries or relaxed bounds. It retains identical preparation
and rejects stale cache identity, inverted cold-bootstrap admission and
verification skipped on a cache hit. CPU-only installation policy covers both
bootstrap/verification pairs. New-head hosted execution remains pending.
Native Tantivy qualification remains explicitly deferred.

Validation: the new conservation contract fails against the original workflow,
and all three focused workflow/install-policy contracts pass. The eight-command
publication gate passes, including all 41 gate cases. A later run at `f0ae858`
independently exposes published-search and snapshot-create lifetime failures;
those remain separate repairs and are retained in the machine receipt.
