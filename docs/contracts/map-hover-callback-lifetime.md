# Original hover callback lifetime

The hover owner captures its original pick, clear and controls prerequisite
callbacks. Pointer delivery remains coalesced into one immutable coordinate
snapshot for the next admitted frame. Idle frames do not invoke picking.
Disposed or revoked owners ignore every remaining move, drag, leave, invalidate
and frame entry; retained callbacks cannot clear a newer hover state.

The actual controls consumer supplies its exact published controls callback and
renderer identity. The first false prerequisite observation is latched. Source
membership is checked around pointer/raycast/picking returns before selection or
hover writes; an old double-click cannot open a replacement scene's selection
after its original pointer operation lost authority. The surrounding original
construction and teardown source contract is described in
[original map controls retirement](map-controls-original-retirement.md).
The actual frame checks its owner on entry and after camera/hover callbacks,
before renderer submission and after its return before publishing telemetry.
An already accepted native renderer submission is not rolled back or proven
cancelled by a later ownership change.

Accepted synchronous hover callback stacks and their original independently
observed work gate retirement through the existing scene-resource inventory.
Reentrant disposal revokes immediately but cannot invoke retirement clear until
that stack returns. Retirement clear is a one-shot callback, including when it
throws. Ordinary repeated disposal preserves that exact failure. Explicit
reconciliation waits for the original pending observations and does not repeat
the original clear attempt. The retained failure remains evidence that the UI
clear action failed; callback-owner closure does not establish that action's
desired UI effect, native cancellation or GPU quiescence.

Unknown pending work and lookalike public owner fields do not supply disposal
authority. A reentrant clear reports a standalone original cleanup-stack
observation without confirming its enclosing owner or creating a self-observer
cycle. The original active frame's immutable pointer remains available until its
callback returns, even after logical retirement clears the owner's local slot.

Actual hover/resource-owner controls are authored but **UNVALIDATED**. No tests,
syntax/lint/format, bootstrap, Three/browser/renderer/native/GPU, build or
benchmark execution was performed. The surrounding controls/RAF ownership has
authored source controls; real event-host behavior, asynchronous callback support and
latency/performance acceptance remain separate.
