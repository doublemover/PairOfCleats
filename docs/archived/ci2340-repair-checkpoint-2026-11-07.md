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
the transport retained its exact `downloadCleanupError`, but journal-error
composition used an inert carrier that omitted the original descriptors. The
outer install boundary therefore could not find that field and fulfill its
documented generic `cause`/`errors` teardown edge. This is a production wrapping
defect, not an obsolete error-graph assertion. The common composer's literal
owner message preserves the original fields without invoking a pending message
getter. The original generic-edge assertion remains, alongside a new exact-field
identity check. Journal/original errors, actual closure, protected leases/staging,
failed early retirement, original recovery and the old selector remain covered.
No failure retry or resource-settlement assertion is removed.

The [completed Windows broad job](https://github.com/doublemover/PairOfCleats/actions/runs/42359226633/job/128364328668)
records 2,791 passed, one failed, zero timed out and three skipped ci-lite cases.
All eight original CI2340 failures now pass, including all six C# cases. Its sole
failure exposes the same transport-wrapping defect above. The nightly-plan fixture
still takes39.6 seconds, exceeding the focused30-second requirement despite its
reported pass; the discovery repair is later source, not qualified by this run.
No local POSIX execution occurred. Later recovery, repository quota,
runner-discovery and Go SDK/download changes remain outside this checkpoint's
acceptance.

## Later documentation gate

The [later run at68a7242f1](https://github.com/doublemover/PairOfCleats/actions/runs/42363758183)
stops in generated-surface freshness. The active roadmap advanced its issue
reconciliation to November7 but retained a November6 audit date, violating the
existing status-ordering contract. The November7 census and source review are
now reflected in that audit date. The assertion and freshness checks remain.
Bootstrap/runtime contracts, lint, config and environment checks passed in this
run; subsequent command/gate, broad, native and authority jobs were skipped.
This run provides no new runtime acceptance for the later repairs.

## CI2342 source checkpoint and repairs

[CI2342](https://github.com/doublemover/PairOfCleats/actions/runs/42367147745)
runs `f293b749e92b0b89229d8ca9db504303243aa454`. Gate, Windows authority,
Rust TUI and all native-inspection jobs pass. The
[Windows native-index job](https://github.com/doublemover/PairOfCleats/actions/runs/42367147745/job/128387999182)
passes22/22 with zero failures, timeouts or skips; build-search takes17.3 seconds,
published search16.2 and validation16.1. This is source-bound elapsed evidence,
not a general or paired speedup claim.

The [Windows broad job](https://github.com/doublemover/PairOfCleats/actions/runs/42367147745/job/128387999179)
records2,836 passed, eight failed, zero timed out and three skipped. The
[macOS broad job](https://github.com/doublemover/PairOfCleats/actions/runs/42367147745/job/128387999142)
records2,837/8/0/2 with the same eight failures. Ubuntu was cancelled; it supplies
no completed acceptance. No local POSIX execution or replacement campaign ran.
The former teardown-graph failure passes with both the original generic-edge
assertion and exact transport-field check. The nightly CLI-plan fixture now
takes16.2 seconds on Windows and24.1 on macOS, within its original30-second bound.
Later published-index cohorts and TypeScript7.1 preparation are outside this run.

| Original failing controls | Demonstrated owner and repair |
| --- | --- |
| Six `shared/storage/lifecycle-repository-cleanup` cases | Their machine home was inside the checkout they supplied as the portable project. The production policy guard correctly refused it. The fixture now supplies its own sibling project/home and explicitly asserts that placing home inside the declared project remains forbidden. Every original producer, pin/evidence, lease, stale-set, cancellation, partial-unlink and convergence assertion remains. |
| `tooling/install/go-sdk-publication-observation/root-capability-revocation` | The shared field guard correctly blocked a revoked root observation but threw an internal pending error without the original result in its generic cause/error graph. Its own pending field/receipt error now retains that exact value. Genuine getter/producer throws keep their existing contract. Only the exact owner-created aggregate is excluded from its own ledger; independent native work/inspections remain binding. The original graph and resource/retirement assertions are unchanged. |
| `tooling/install/download-original-classification/closed-positive-and-negative` | The fixture expected a `bytes` result field that the producer never returned. The actual successful DTO is `body`, `sha256`, `sourceUrl`. Length is now checked on the returned buffer, the digest is compared with the expected SHA256, and the exact source URL is asserted. The existing403 status/retryability and original teardown controls remain. No producer contract or digest check is weakened. |

All24 managed-input, Go-input, reservation-receipt and outer-action cases pass
at this checkpoint. The eight repairs above are later source and remain locally
unrun; this receipt does not qualify them or the final candidate.
