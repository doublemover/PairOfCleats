# CI2340 repair checkpoint

The [original campaign](https://github.com/doublemover/PairOfCleats/actions/runs/42354776241)
ran `c5f4ac1e7896e7ac76140238261e5f79c8363044` on November 7, 2026.
These observations qualify that source checkpoint only.

The gate, Rust TUI, Windows authority and all three native-inspection jobs pass.
The serial Windows native-index cohort passes all 22 cases with zero failures,
timeouts or skips. Published search takes 22.3 seconds; the slowest case,
validate-published, takes 25.6 seconds within its original 30-second limit.
The [native receipt](windows-native-snapshot-budget-2026-11-07.md) retains prior
failures and unchanged acceptance requirements.

The [Windows broad job](https://github.com/doublemover/PairOfCleats/actions/runs/42354776241/job/128350859012)
finishes with 2,761 passing, eight failing, zero timed-out and three skipped
ci-lite cases. Its separate preceding cohorts pass 5, 8, 10, 33 and 187 cases.
The skips are optional Tantivy smoke, POSIX invalid-signal leak injection and
POSIX parent-signal cleanup; these are not Windows passing evidence.
Ubuntu and macOS broad jobs fail the same answer-retention and pinned-storage
controls below. No local Linux/macOS execution or WSL was used.

## Failures and source repairs

| Original failing cases | Demonstrated cause | Repair |
| --- | --- | --- |
| `shared/storage/lifecycle-quota-cleanup/pins-and-saved-evidence` | The composed probe inventory omitted its root path. Reporting a protected file called `path.join` with `undefined`. | `8685c0deb` restores the original root/category identity; protected data remains blocked. |
| `semantic/questions/answer-retention/interruption-and-resume` | The shallow error assertion did not follow the nested atomic-write/replace/lock error graph containing the exact injected failure. | `8685c0deb` asserts that exact object through the error graph. Pending-intent, content, fresh-process resume and cancellation checks remain. |
| Six `tooling/install/managed-csharp-package` cases: publication/reuse, runtime identity, external host isolation, sync probe/trust, external command trust and framed initialize/leases | The Windows fixture constructed a plain environment with both `Path` and `PATH`. Canonical path discovery could select hosted .NET before the inert fixture host, which cannot run the inert fixture assembly. POSIX uses one path key. | `9c9aa28c4` normalizes the fixture path before prepending its selected host and asserts its precedence. All actual child, positive, trust and lease assertions remain. |

The C# verifier failure also exposed missing rejection diagnostics in the common
installation owner: an `ok:false` result was discarded. `9c9aa28c4` preserves
that original result as the cause and verification context, with a negative
control alongside the existing positive verifier control.

The broad Windows log records `tooling/ci/run-suite-script-coverage-plan` at
40.3 seconds despite its reported pass. That observation exceeds the current
30-second focused-fixture requirement. The subsequent source repair reuses
identical discovery observations within the unchanged fixture invocation and
defers unused execution/reporting imports in list requests. Every original
dispatch, exclusion, canonical retirement and unique-owner assertion remains.
All distinct selectors still cross the actual CLI boundary in fresh children;
repeated identical calls had the same arguments, cwd, environment and source,
and neither intervening assertions nor receipt reads modified those inputs.
The resulting fixture still needs a bounded runtime recheck; no deadline increase
or measured improvement is claimed.

Artifact `13568722454` (`ci-artifacts-windows`, 12,963,890 bytes) has SHA256
`aa11eb78156b7e707740f17727ac1eb8f03088c1beb18dac620527a34b3050ad`.
Its directly spawned failure receipts record ordinary exit 1, no timeout and
Node 26.13.0/ABI 147, Windows x64. No native crash is inferred from JavaScript
markers. The author-workspace ZIP under `.tmp/tasks/ci2340/` is historical,
disposable evidence and is not required in clean checkouts.

The repairs and later installer/TypeScript controls remain locally unrun.
Formatting and static inventory generation are not runtime acceptance. The next
verification must use prepared dependencies and the resulting source identity;
earlier passing cases cannot be combined into a final-tree pass.

## CI2341 source checkpoint

[CI2341](https://github.com/doublemover/PairOfCleats/actions/runs/42359226633)
runs `41c487ba00854967f155d27c02b3e3f82c974ee6`. Its gate, Rust TUI,
Windows authority and all native-inspection jobs pass. The
[serial Windows native-index job](https://github.com/doublemover/PairOfCleats/actions/runs/42359226633/job/128364328661)
passes all 22 cases with zero failures, timeouts or skips. Published search takes
20.7 seconds; build-search is slowest at 21.3 seconds. This includes the later
index/search import overlap, with the original operations and deadlines intact.

Ubuntu and macOS broad jobs each record 2,792 passed, one failed, zero timed out
and two skipped. Both former shared failures pass. The new failure is
`tooling/install/managed-install-phase-observation/download-recovery-after-journal-failure`:
its teardown assertion searched generic `cause`/`errors` edges instead of the
transport owner's exact `downloadCleanupError` field. The original transport
sets that nonenumerable field to the actual cancellation failure; the new check
requires exact identity there. It retains the journal error and original download
in the error graph, actual session closure, protected leases/staging, failed
early retirement, successful original recovery and the unchanged old selector.
No failure retry or resource-settlement assertion is removed.

Windows broad execution is still running at this observation. No local POSIX
execution occurred. Later recovery, repository quota, runner-discovery and Go
SDK changes remain outside this checkpoint's acceptance.
