# Snapshot request outcomes and original abort listeners

The bounded snapshot queue tracks failure presence explicitly. A runner throwing
`undefined`, `null`, `false`, zero or an empty string rejects with that exact
original value. Cancellation preserves an observed falsey reason. A logical
cancellation does not free its physical concurrency slot until the original
accepted runner settles; the existing running and queue budgets still apply.

Each supplied signal's original remove method, add method, listener and receiver
are captured before registration. A later method replacement cannot redirect
cleanup. Settlement always resolves or rejects the original promise even when
the original listener removal fails. Operation, registration and independent
cleanup failures remain separate exact values in composed evidence.

Registration is an admitted construction span. Reentrant retirement prevents
later getter/registration/runner work, and settlement waits for the original
registration stack to return before attempting its captured remover. An add
implementation that installs then throws remains owned. Unadmitted entries
cannot start through a reentrant pump or evade the finite running-plus-queued
admission budget.
An unexpected non-void registration result is retained as an unknown outcome;
it cannot admit the runner or silently establish native settlement.

Failed original removers use the existing scene-resource inventory. Original
scene, cache and diagnostic pending observations gate both the initial removal
and deliberate exact-owner reconciliation. Ordinary settlement never retries a
failed native removal. Successful original removal is retained. Unknown or
copied owner fields and a completed sibling cannot establish release.

These are authored source and inert actual-queue controls, **UNVALIDATED**. No
tests, syntax/lint/format, bootstrap, browser/editor/native/child/IPC/model/GPU,
build or benchmark execution was performed. A returned remove call does not
qualify real host event effects, native retry safety, cancellation of accepted
work or performance. Worker transport and data-session publication remain
separate owners.
