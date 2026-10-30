# Crash diagnostic sink ownership

The crash logger's fixed latest paths and its run/attempt paths are independent
publication targets. Failure to update the latest state or recent-event snapshot
must not suppress the attempt-owned copy. Failure of the attempt target must not
erase a surviving latest copy. Each write retains its existing atomic publisher,
bounded payload, warning deduplication and target-specific warning action.

State publication stays on the existing serialized state owner. Independent sink
attempts do not admit late phases over terminal errors or introduce concurrent
state queues. Immutable terminal evidence remains authoritative, and a returned
evidence path still comes from the terminal publisher's confirmed result.

Recent-event snapshots retain the existing redacted ring and byte bounds. A
diagnostic write failure does not replace or mutate the operation's primary
error. This change grants no retry of the computation, new log directory,
retention allowance or cleanup authority.

The authored regression uses the actual logger/atomic publishers and tiny
ordinary disposable roots. It denies each sink independently, checks the healthy
copy and expected warnings, preserves frozen terminal errors and redaction, and
retains the normal warning-free positive. It is unvalidated. Supported-runtime
Windows faults, abrupt process exit, full-disk/permission behavior and bounded
flush/close acceptance remain separate qualification.

The scheduler tracker admits its crash bundle before optional presentation and
attempts local, durable and configured external evidence before presentation
callbacks. A throwing logger callback or enabled getter cannot prevent those
writes. External method-getter failure is attributed to the external sink, with
the original method's receiver retained when available. Presentation and error-log
failures appear independently in the existing persistence receipt; rejected
best-effort warning callbacks cannot become unhandled rejections.

The additional actual tracker fixture retains tiny local/durable positives under
synchronous, asynchronous and getter failures, checks independent external
delivery, preserves the frozen parser error and asserts a warning-free healthy
receipt. It remains unvalidated. The serialized persistence lifetime still joins
accepted callbacks; this source change does not prove abrupt-exit durability or
provide a deadline for a callback that never settles.
