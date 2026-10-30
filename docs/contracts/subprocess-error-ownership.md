# Subprocess error ownership

The canonical asynchronous runner installs error/close/input owners before
calling onSpawn or writing stdin. A post-spawn child error, input failure or
throwing spawn callback enters the existing bounded termination and close owner.
Primary causes and SUBPROCESS_FAILED remain intact. An error event alone never
unregisters a running child or claims closure. Unknown close retains tracking
and pending resource evidence; direct-child close still does not establish an
arbitrary descendant census.

The tracked termination owner also preserves registrations when exitCode, PID
death or a successful kill is observed without close. Its async path observes
the exact registered close for a bounded 500ms after the existing termination
attempt, in parallel across targets. Sync teardown cannot publish asynchronous
close evidence. Every targeted cache-release audit row requires closeObserved;
late close removes only its original handle, including when a PID/scope is reused.
Tree-attempt rejection remains diagnostic failure after independent child exit.

The stdin error owner remains until the exact child closes, including failures
during cleanup. Input delivery uses the same configured bytes and ends stdin
once; listener ordering does not suppress input/callback errors. Ordinary
successful stdout/stderr, exit-code and cancellation contracts remain in place.

Real owned-child and injected error-event regression sources plus a Unicode
stdin positive are authored and UNVALIDATED. No subprocess/host tests ran during
the deferred implementation pass, and no runtime qualification is implied.
