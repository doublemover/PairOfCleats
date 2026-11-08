# Live canary attempt settlement

One live attempt owns preparation, environment observation, the shared subprocess,
result admission, contract evaluation and its exclusive temporary directory. The
shared subprocess captures at most 256 KiB per diagnostic stream and reports
observed, retained, dropped and encoded bytes. The canary keeps no parallel output
callback arrays. Diagnostics remain explicitly incomplete after truncation or
encoding loss. A separately complete result artifact remains authoritative.

Result artifacts use the existing contained, identity-checked reader with an
8 MiB allowance before allocation and throughout reading. Admission requires
complete UTF-8 JSON and an explicit canary-metrics or aggregate benchmark result
envelope. Invalid, oversized, unreadable and absent payloads become typed failed
attempts. Stdout fallback requires a complete captured stream within the result
allowance; a tail cannot be reinterpreted as a complete metrics document. Private
fixture bounds may only lower these limits. No public configuration is added.

Nonzero exits, signals, timeouts and cancellations retain the shared runner's
failure and termination contract. Cleanup observes the original resource owner
before touching its admitted directory, compares the original native directory
identity and uses the shared removal owner. Missing close, failed tree cleanup,
unsettled result reads, changed paths and failed removal retain the path with a
non-closure-ready result. No elapsed-time or diagnostic-only release is inferred.

An internal capability can retry cleanup after the exact original owner confirms
settlement; concurrent recovery is coalesced and successful cleanup is idempotent.
Reports contain the retained path and termination evidence, never the release
capability. A serialized report cannot manufacture cleanup authority. There is no
background cleanup timer or automatic deletion of retained paths after restart.
The directory comparison is a requalification check, not a portable atomic
compare-and-remove primitive against a hostile concurrent filesystem mutator.

Malformed individual results allow later selected entries to execute. Cancellation
or unresolved resource ownership stops further admission; every remaining selected
entry gets an explicit `not_run` row and reason. Coverage records selected,
attempted, failed, interrupted, not-run and pending-ownership counts. A failed
entry without an associated issue number still fails the lane. Normal interruption
settles through the same attempt owner before final reporting. Abrupt process or
machine termination is outside graceful report publication.

The CLI atomically publishes the authoritative JSON checkpoint, then any requested
Markdown report, through the existing persistence owner. These are independently
atomic files, not a cross-file transaction. Completed rows, failures and omitted
execution remain visible. The CLI uses an exit code after finalization rather than
forcing process exit while owned work is still settling.

Small fixture children cover valid artifacts/stdout, output well beyond the cap,
split multibyte output, malformed/oversized/unreadable/schema/encoding failures,
nonzero exit and normal timeout. Controlled shared-runner failures cover missing
close, exact delayed release, concurrent cleanup, unrelated/replaced paths,
interruption and selected-unrun accounting without creating real orphans or
requiring extra Windows permissions. Injected observations remain synthetic.
