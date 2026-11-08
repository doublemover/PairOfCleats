# Cross-file argument literal envelopes

The existing cross-file argument collector now uses the local literal owner's
bounded quote and punctuation scanner. It emits a string, array, object or
constructor candidate only when that envelope consumes the complete argument.
A comparison beginning with a string, container/property access or access on a
constructor result cannot inherit its prefix's type. Primitive keyword spelling
is case-sensitive; identifier case and complete Unicode constructor names are
preserved. Unsupported argument text remains in ordinary call summaries.

This owner consumes existing argument display text, including the established
`[...]`, `{...}`, template and `fn(...)` summaries. These are heuristic candidates,
without source-binding or runtime proof. It does not establish language grammar,
constructor return behavior, builtin ownership, template substitution parsing,
argument source completeness or dynamic target resolution. Other languages keep
their provider/annotation owners; this generic projection does not claim a new
language-specific literal grammar. Input scanning uses the existing 65,536
character and 128 nesting limits, and unsupported input supplies no prefix fact.

The actual cross-file pipeline persists these parameter facts, so the shared
call-flow producer version must advance to invalidate its existing output cache.
No cache format, public knob, parser or parallel evidence store is added.

Direct envelope controls and the actual cold pipeline/source-qualified warm
replay fixture are authored and **UNVALIDATED**. No tests, syntax, lint, format,
bootstrap, compiler/native/source execution or benchmarks were run.
