# Semantic reader cleanup

Status: UNVALIDATED source and authored controls, 2026-10-22.

The artifact semantic store drains every admitted scoped open and every reader
close before returning a page. A rejected opening remains a failure even if its
callback catches it. Failed closes cannot turn a successful scoped operation or
related page into a successful response. Only a fulfilled close removes its
exact reader entry. Existing four-reader and retention-byte admission, one-shot
fallback, content verification and fresh-page behavior remain unchanged.

Scoped, one-shot, verification and iterator cleanup compose original operation
and independent close failures with the existing storage failure compositor.
Falsey throws and frozen errors remain represented in the cause/error graph.
Both related-index bound failures are retained. Content-error classification
first checks original resource observations; it cannot replace pending native
work with an ordinary integrity diagnostic.

The store introduces no descriptor owner, resource registry or group release
capability. Exact contained-file sessions remain on their original failures,
including nested independent causes. Recovery must inspect those original
failures and explicitly reconcile every actual per-descriptor session. The
composed original observer remains false until all retained prerequisites settle.
There is no automatic close retry, read replay, page publication after recovery,
path-based cleanup authority or cross-process settlement evidence.

The authored actual-store fixture covers small verified snapshots, large live
readers, nested scopes, four independently failed descriptors, falsey/frozen
operation errors, caught opening failure, rejected peer admission, one-shot row
limits, iterator return/throw, and local related-page reader disposal. It checks
explicit original-owner recovery without more source reads and fresh subsequent
requests. It has not run. Abandoned readers, outer service error handling,
continuation admission after failed page cleanup, other retained-evidence
consumers, native/platform behavior and performance acceptance remain separate.
No tests, syntax/lint/format, bootstrap, build, index or benchmark was executed.
