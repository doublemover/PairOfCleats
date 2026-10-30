# Sublime captured navigation evidence

The Sublime navigation consumer isolates its original decoded packet before
publishing a qualified cursor binding. The existing source hash/version,
coordinate unit, original view/buffer/window/cursor and operation checks still
admit the response. Copying does not add source or binding qualification.

Transport results, the evidence callback, result-hit callback and later
cursor-binding reads receive separate data. Editing a returned generation,
binding, result range or nested result reference cannot rewrite the private
captured packet used by another consumer. Full original producer metadata is
retained; no packet is rebuilt from a later global response or a new generation.
The operation and requesting-view checks are repeated after initial copying
before publication. Current original source bytes are still observed whenever
cursor binding is reused; a data copy cannot revive changed source authority.
Capture admits only ordinary decoded dictionaries/lists/scalars, with string
object keys and the editor's internal 64-level nesting admission. Arbitrary
objects, subclasses and copy hooks cannot execute as packet evidence. Internal
publication admission uses the private checked packet directly; it does not
allocate a consumer copy solely to test availability.

Actual navigation/request/result-consumer controls are authored but
**UNVALIDATED**. No Python/Node/tests, syntax/lint/format, bootstrap, editor host,
native/child/IPC, browser/GPU, build or benchmark execution occurred. Copies
isolate ordinary decoded data; they do not establish atomic filesystem
snapshots, whole-packet or earlier transient allocation bounds, native host
cancellation, complete semantic producer coverage or performance acceptance.
