# Semantic native waits and compute ownership

Known native waits suspend the current scheduler compute lease while retaining
its file/window, source/AST and memory obligations. Hashing, encoding, validation
and producer traversal resume under compute admission. A callback containing
both compute and waits cannot be treated as one I/O-only operation.

The existing contained-descriptor resource owner now also supplies asynchronous
acquisition. It captures the actual native open promise and descriptor methods
before compute reacquisition. Even a failed reacquisition joins that original
open and uses its original resource for disposal. A refused close retains only
the exact close-only recovery capability. This does not grant path or deletion
authority. Contained reads, uncontained reader scopes, directory barriers,
retained-source writes and final query/operation data/offset writes reuse it.

Semantic source metadata probes suspend only their individual native stat wait.
A serialized disk writer suspends only its preceding writer prerequisite, then
reacquires compute before invoking the next writer. Batch byte admission records
its acquired release function inside the actual wait, before reacquisition can
reject. Immutable publication records successful link ownership inside its
actual native operation for the same reason. A wrapper rejection cannot erase
the original descriptor, byte lease or published file from cleanup accounting.

Original resource observations, cleanup composition, required data/offset and
directory barriers, Windows unsupported-directory semantics and disk accounting
remain with their existing owners. No CPU token, memory or timeout limit changes.
This source batch has syntax/lint review only; mixed one-token waits, native open
shutdown failures, close-only recovery, cancellation/fairness and representative
resource/output parity are deferred with #1330. It is not full runtime or latency
qualification.

A scheduler drain deadline retains an immutable observation of its original
task completion promises. Timeout is not resource retirement, including when a
native task has already rejected publicly while retaining its physical owner.
The observation becomes settled only after those exact promises and their
original scheduler reservations retire; mutable counts, replacement containers
or rewritten diagnostics cannot grant completion. Settled promises with held
reservations produce an explicit incomplete-drain error. Existing drain controls
now cover these distinctions and await execution with the repair batch.
