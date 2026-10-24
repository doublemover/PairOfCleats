# Native database command lifetime

Canonical SQLite compact and LMDB build commands use their existing lifecycle
registry and delegated authority owners. Each actual handle captures its original
close method and receiver once. Concurrent closes and finalization join the same
promise; a rejected close remains unknown and is not automatically retried.
Missing or explicitly unconfirmed native close cannot produce a positive receipt.
Admission ends with the command operation, before invoking any later factory.
Accepted `use` work remains owned through its completion and close even if the
outer callback returns first. A handle's close drains every already-admitted
operation before invoking the original method; unknown original native-work
observations block that close. Unawaited accepted rejection cannot become a
successful command. Direct driver calls retain the caller's original completion
responsibility; this owner does not instrument arbitrary backend methods.

Operation and cleanup rejection have explicit presence, including falsey values.
Frozen primary errors remain untouched; aggregates preserve exact primary,
cleanup, metadata and inspection causes. Nonenumerable command-lifetime evidence
retains original handles and independent original settlement observations.
Absent or false advisory flags cannot erase an observer. Unknown observations
stay pending. A swallowed work failure cannot erase its observed pending child.

The command sends the existing delegated closure receipt only after operation,
registry, every original handle and independent observation settle. Failed
delegated publication remains unconfirmed; no process-exit, PID or unrelated
callback supplies that proof. This change adds no lease namespace, serialized
authority, arbitrary descendant inference or resource retry capability.

The authored fixture invokes the actual command owner with inert handles and
covers frozen/falsey failures, exact original methods, concurrent closure, late
admission refusal and independent original observations. It is **UNVALIDATED**.
Actual SQLite/LMDB, IPC/child receipt failure, Windows native retry safety,
platform resource bounds and the original canonical command fixtures still
require qualification. Other lifecycle unregister/worker policies remain separate.
