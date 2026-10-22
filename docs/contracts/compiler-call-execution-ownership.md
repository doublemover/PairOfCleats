# Compiler call execution ownership

The compiler CFG attaches its actual owner reference to the existing call-effect receipt. Canonical flow documents declare CFG execution ownership and carry those receipts through the ordinary compiler session into call dependency summaries. The summary join indexes source-owned function summaries by owner reference; it does not reassign a qualified call using its smallest containing source span.

This distinguishes computed object/class method names and static field initializers, evaluated by the surrounding CFG, from method parameter defaults and bodies, evaluated on invocation. A module-evaluated key remains outside any function summary. Finalizer variants may repeat a route with the same owner without making it ambiguous.

Missing, unknown or conflicting canonical owner receipts leave the call unattributed, mark the document's function summaries incomplete and retain `call_execution_owner_unavailable_or_ambiguous` in cross-file coverage. This also keeps unavailable CFG construction or unadmitted routes from becoming guessed complete ownership. Supplied legacy summary fixtures without the canonical declaration retain their existing interval lookup; that compatibility path is not a source-qualified execution receipt.

The existing call-site result, exception and effect channels remain the consumers. This changes the shared `cfgFlow` receipt meaning and `callFlow` summary ownership identities. It does not change source syntax, compiler bindings or the immutable value slice. Coercion, accessor, dynamic-call and runtime dispatch limits remain partial.

Authored regressions use real compiler/checker syntax, canonical CFG receipts, dependency summaries and retained call-flow partitions for surrounding creation, defaults, bodies, static initialization and module keys. Negative cases remove or conflict a real owner receipt and require unavailable ownership. All are **UNVALIDATED**: no tests, syntax, format, bootstrap, compiler/native execution, source execution or performance qualification was performed.
