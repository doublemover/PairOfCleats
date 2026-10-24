# Original map response body ownership

The workspace requester and demand-paged snapshot requester share one bounded
body admission owner. It captures the original reader, cancellation and lock
release methods, copies each admitted byte chunk, checks cancellation after
accepted reads and parses fatal UTF-8 before cleanup. The existing workspace and
snapshot response budgets remain unchanged.

Read, parse, cancellation and lock-release failures retain their exact original
causes, including falsey throws. Cancellation and lock cleanup are independent
attempts after ordinary failures. Original scene/cache/native-work observations
must settle before a native cleanup attempt or retry. Only private existing map
producer records may delegate their own local closure observation; an unrelated
observer, diagnostic failure or copied owner field cannot authorize cleanup.
Fulfilled cleanup is retained and explicit reconciliation uses captured owners.

An already received superseded response is cancelled and unlocked without
starting another read. A still-pending accepted read remains owned until its
original promise settles. Workspace delivery allowlists the exact response
reader dependency closure; preview module pinning discovers the same closure
through normal local module imports.

Consumer controls and actual static-route assertions are authored but unrun.
No browser stream, native transport, cancellation latency or performance
acceptance is inferred from source ordering or inert counters.
