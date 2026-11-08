# Registry cleanup failure context

`withRegistryLock` retains a failed worker on the existing file-lock release
error's `workerError` field if its owned release also fails. The release error
keeps its existing code, path and exact cleanup cause. Frozen operation errors
remain unchanged; falsey thrown values retain their exact value as the cause of
the error used for cleanup context. When release succeeds, the worker's original
rejection remains the observed rejection.

The borrowed-lock branch still requires the actual live registry capability and
never releases a caller's lease. This changes no registry format, ownership
admission, stale recovery, signal behavior or deletion authority.

The authored fixture acquires real locks in a disposable root and injects inert
release failures at their exact handle, then restores and releases each original
handle. Normal, frozen, falsey and borrowed-owner controls are unvalidated. It
does not establish Windows permissions, interrupted process or native lifetime
qualification.
