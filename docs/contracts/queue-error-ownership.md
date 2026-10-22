# Queue error delivery and resource ownership

The shared queue runner preserves falsey worker rejections as exact error causes.
An error-handler rejection retains both the worker failure and the exact handler
rejection, including falsey values. A handler cannot replace the original failure
or turn a failed task into successful queue completion.

Before invoking an error handler, the queue captures any original resource
settlement observer with its original receiver. A replacement observer or changed
pending flag cannot erase that evidence. Independent handler ownership must also
confirm settlement. Missing or throwing observers remain unknown. The queue
neither disposes those resources nor grants any release or deletion authority;
the exact original capabilities remain reachable through the recorded causes.

Best-effort aggregation also projects its constituent resource observations.
Pending resource aggregates forbid automatic retry, and an explicitly
non-retryable primary retains that policy after handler failure. Ordinary errors
with successful handlers preserve their original identity and existing policy.

The actual queue regressions use inert observers and preserve ordinary retry and
failure contracts. They are authored and **UNVALIDATED**. No test, formatter,
runtime, native or performance qualification has been executed for this change.
