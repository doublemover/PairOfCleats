# Remote source navigation and retirement

Remote navigation captures the original source/index, DOM summary, revision
owner and callback methods. Each callback and awaited resolution checks that
original publication before selection registration, acceptance or diagnostics.
A replaced source cannot dispatch through the current worker, inspect stale
failure getters, publish selection metadata or write a sibling summary. Captured
endpoint/token/snapshot values do not change when the caller mutates its options.

Each navigation captures its original abort method. A throwing abort remains an
exact failed capability; subsequent navigation reports it without automatically
retrying native abort or admitting a new selection request. Logical source
retirement happens promptly, attempts each original abort/queue/demand/metadata
cleanup independently, and keeps failed child capabilities for explicit child
then parent reconciliation. Accepted original callback stacks are prerequisites;
their own reentrant retirement cannot claim that work has returned. Successful
child cleanup is not repeated.

The actual viewer initializer hands its new remote source to the original shell
before publishing it. Page retirement therefore uses the captured original
source disposer; changing `state.remoteSource` cannot redirect closure. A late
or replaced shell retires the handoff and stops initialization.

The authored source/consumer controls are unrun. Logical request cancellation and
source metadata retirement do not prove physical worker/fetch/body quiescence.
Those existing original owners retain their separate concurrency and pending
cleanup contracts. No browser, native, screenshot or performance acceptance is
claimed by these fences.
