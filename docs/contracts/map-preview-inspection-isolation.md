# Preview inspection isolation

`runMapPreview` serves privately owned pinned module and document buffers. Its
ordinary returned `session` inspection surface exposes a read-only asset lookup,
immutable identity metadata and copies of explicitly requested bytes. Lookup,
iteration and document inspection cannot mutate the buffers used by the running
listener. Ready metadata is immutable and remains bound to that session.

Startup does not eagerly copy the pinned module closure or graph for this view.
Byte copies belong to callers that request inspection. Original shutdown still
clears the private map and document only after its existing listener/handler
ownership drains; the view reflects that retirement. Native `server` and exact
resource reconciliation capabilities remain explicit operational authority.
This is an ordinary API isolation contract, not a security boundary against a
caller holding those native capabilities.

Pure inspection controls and actual loopback preview assertions are authored
but unrun. Browser/client-upgrade, current-pointer advance, platform server
shutdown and source portability acceptance remain separate.
