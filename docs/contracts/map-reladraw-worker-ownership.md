# Reladraw worker retirement

The workspace compiler captures each worker's original `terminate` and
`postMessage` methods. Construction, handler publication and accepted callbacks
remain original work until their stacks return. Cancellation settles the original
compilation even when termination throws; successful results publish only after
confirmed termination. Late callbacks cannot publish an older result.

An unconfirmed termination retires the compiler permanently. Further compilation
does not allocate another worker on that controller. Its `pendingOwners` exposes
only the original resource capabilities; explicit reconciliation uses those
capabilities and cannot reactivate the retired controller. Independent original
scene/cache/diagnostic observations remain prerequisites for native termination,
including deliberately retried termination. A fulfilled close is not repeated.

The authored factory and workspace consumer controls are unrun. They establish
no browser Worker, native termination, timeout scheduling or performance
qualification. A synchronous throwing constructor cannot expose an inaccessible
partially allocated native worker; any original pending observation remains a
blocker rather than invented close authority.
