# Original preview shutdown ownership

The loopback preview captures its listener's original `close` and
`closeAllConnections` methods during startup. Every caller receives the same
shutdown promise. Retirement rejects new handlers immediately, aborts accepted
work, waits for startup acquisition to return and then attempts listener cleanup.
Pinned modules, document bytes and snapshot transport remain retained until the
original listener and all accepted asynchronous handlers have settled.

A failed listener callback or cancellation retains its exact resource owner.
Repeated `close()` calls report the original outcome. Explicit reconciliation
uses that captured owner's existing release methods, waits for any original
pending-work observer and never repeats a fulfilled close or cancellation. The
parent cannot substitute a new server, copied fields or replacement callbacks.
Independent detach failures do not skip listener or data cleanup. Startup failure
and cleanup failure remain separate original causes.

The inert lifetime controls and actual loopback preview fixture are authored but
unrun in this implementation wave. Source ordering does not qualify Node's native
server shutdown, browser disconnect behavior or platform resource quiescence.
