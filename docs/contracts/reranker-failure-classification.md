# Reranker failure classification

Status: **UNVALIDATED_PARTIAL** source and authored assertions. No tests, syntax,
lint, format, bootstrap, native/model execution or performance checks were run.

The actual evidence reranker consumes the scoped original failure snapshot for
ownership, abort classification and diagnostic reason. It does not reread original
`name`, `code`, `message` or ownership accessors. Ordinary frozen pending errors
retain exact identity. An observer without a pending marker also blocks fallback
while its captured original observation is false. A marker or ownership accessor
without a usable original observation remains unknown.

Independent diagnostic inspection failures cause a wrapper whose exact `cause`
is the original operation value. Their original observations compose with work
settlement and existing native ownership. A successful sibling observation cannot
release them. The optional adapter `cancelled` flag is captured once separately;
its failed inspection is retained as `rerankerDiagnosticErrors`, including falsey
values. Ordinary explicit adapter cancellation and caller cancellation still
reject. Pending ownership is considered before cancellation or fallback.

Fallback retains the original admitted member snapshot, scores and order. Its
diagnostic reason uses only a captured string code or message, never an arbitrary
error object's coercion. This changes no model identity, policy promotion,
candidate cap, timeout, score validation or quality claim. Inert actual consumer
controls are authored for frozen and observer-only failures, throwing ownership
and diagnostic accessors, independent cancellation-flag owners, falsey inspection
values and ordinary cancellation. Real runtime, host and resource qualification
remain separate.
