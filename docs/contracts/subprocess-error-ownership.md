# Subprocess error ownership

The canonical asynchronous runner installs error/close/input owners before
calling onSpawn or writing stdin. A post-spawn child error, input failure or
throwing spawn callback enters the existing bounded termination and close owner.
Primary causes and SUBPROCESS_FAILED remain intact. An error event alone never
unregisters a running child or claims closure. Unknown close retains tracking
and pending resource evidence; direct-child close still does not establish an
arbitrary descendant census.
Explicitly supplied falsy causes remain present, while an omitted cause stays
absent. Existing enumerable subprocess cause projection is preserved. Abort
reasons use the shared signal-snapshot owner and are captured before asynchronous
termination; a failed reason getter retains its original inspection error.
Names, codes, results and raw captured output keep their existing contracts.
Tree cleanup tracks rejection presence independently from its value. A rejected
attempt retains its exact primary and cleanup causes, including null/undefined,
and remains unconfirmed after direct-child close or public audit edits.

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
Eight further unexecuted cases cover constructor presence, spawn/stdout/stderr/
stdin failures, pre-aborted reasons and original reasons through actual owned
child termination, plus falsy cleanup rejections after independent actual close.
Each child cohort is independently bounded and creates no
descendants; existing process-tree qualification remains separate.
