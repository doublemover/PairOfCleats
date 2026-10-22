# Subprocess error ownership

The canonical asynchronous runner installs error/close/input owners before
calling onSpawn or writing stdin. A post-spawn child error, input failure or
throwing spawn callback enters the existing bounded termination and close owner.
Primary causes and SUBPROCESS_FAILED remain intact. An error event alone never
unregisters a running child or claims closure. Unknown close retains tracking
and pending resource evidence; direct-child close still does not establish an
arbitrary descendant census.

The stdin error owner remains until the exact child closes, including failures
during cleanup. Input delivery uses the same configured bytes and ends stdin
once; listener ordering does not suppress input/callback errors. Ordinary
successful stdout/stderr, exit-code and cancellation contracts remain in place.

Real owned-child and injected error-event regression sources plus a Unicode
stdin positive are authored and UNVALIDATED. No subprocess/host tests ran during
the deferred implementation pass, and no runtime qualification is implied.
