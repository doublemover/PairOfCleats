# File-lock worker results

`withFileLock` requires original resource observations from both a thrown worker
failure and a successful returned worker value before releasing metadata.
Promise fulfillment alone does not settle independently pending work. A returned
observer is captured before release inspection; absence of the pending marker
does not override an original observer that has not confirmed settlement.

Unconfirmed work retains the actual published file-lock session. Forced wrapper
or owner deletion cannot bypass it. Explicit original-session recovery waits for
the captured work and independent observer failures, never reruns the worker,
and never accepts a replacement callback as original settlement proof. Release
failures retain the original observation in their existing `workerError` field;
this does not change the release error/cause contract.

Plain values and confirmed resource results keep their existing return identity.
No lock format, ownership authority, stale policy, deadline or retry changes.
The six new real-lock result controls are authored and unexecuted.
