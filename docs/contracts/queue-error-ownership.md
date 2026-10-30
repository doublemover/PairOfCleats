# Queue error delivery and resource ownership

The shared queue runner preserves falsey worker rejections as exact error causes.
An error-handler rejection retains both the worker failure and the exact handler
rejection, including falsey values. A handler cannot replace the original failure
or turn a failed task into successful queue completion.

Before invoking an error handler, the queue captures any original resource
settlement observer with its original receiver. A replacement observer or changed
pending flag cannot erase that evidence. Original operational fields and
nonenumerable capabilities retain their captured descriptors on the wrapper;
callback mutation cannot replace them. Independent handler ownership must also
confirm settlement. Missing or throwing observers remain unknown. The queue
neither disposes those resources nor grants any release or deletion authority;
the exact original capabilities remain reachable through the recorded causes.

Best-effort aggregation also projects its constituent resource observations.
Pending resource aggregates forbid automatic retry, and an explicitly
non-retryable primary retains that policy after handler failure. Ordinary errors
with successful handlers preserve their original identity and existing policy.

Automatic worker retry also requires any original resource observer to confirm
settlement, even when the advisory pending flag is false and the operation says
it is retryable. Unknown or unresolved ownership propagates a non-retryable
aggregate. A throwing retry-policy getter preserves the worker and inspection
failure independently. Explicit non-retryable data errors retain their identity;
confirmed closure keeps existing independently retryable operation behavior.

In-process daemon normalization now captures original build ownership before
reading message/name/code/outcome properties or writing diagnostics. Unsettled
builds reject through the existing exact-claim cleanup hold, preventing ordinary
completion, retry, session recycling or subprocess fallback from retiring that
owner. The core build outcome presenter applies the same rule and uses the shared
failure-context owner rather than assigning a property onto a possibly frozen
error. Diagnostic inspection and logging failures retain their independent cause.

Only confirmed settled failures become ordinary exit results. Cancellation keeps
exit 130, and captured build outcomes/publication receipts survive inside daemon
metadata through queue completion. A later failure cannot imply that a previously
published generation was never published. JSON metadata grants no reconciliation
capability; retirement still needs the original in-process resource observation.

The daemon/queue cross-boundary fixture injects an inert build at the production
normalization boundary, covering pending/frozen/hostile errors, mutable observer
properties, abort cleanup, exact-once recovery, sibling isolation and ordinary
settled/cancelled/post-publication outcomes. These controls remain unrun.

The actual queue regressions use inert observers and preserve ordinary retry and
failure contracts. They are authored and **UNVALIDATED**. No test, formatter,
runtime, native or performance qualification has been executed for this change.
