# Chunk metadata presence observations

Status: UNVALIDATED source and authored controls. No checks have run.

The coarse binary-columnar metadata probe borrows the existing bounded descriptor
text owner. JSON parsing and sidecar existence checks follow confirmed original
close. An unknown read or close propagates its actual contained-file capability
instead of returning `false` and allowing a different representation/backend to
stand in for the failed resource. Explicit close-only reconciliation cannot
repeat a read, parse, sidecar probe or public presence check. An attempted failed
synchronous close still has no safe numeric-generation retry.

`pathExists` keeps its ordinary completed-failure `false` behavior, but checks the
original native observation before returning absence. Absent/false pending flags
do not cancel an original observer. The chunk-meta direct/compressed/sharded
candidate chain therefore stops at unknown native work. Manifest path-stat and
load/classification catches likewise preserve unknown originals. An error embedded
in a manifest presence result is checked before its `missing` format can become
absence; code projection cannot replace the captured prerequisite.

Completed malformed metadata, missing sidecars, traversal rejection, direct and
compressed presence, and the existing coarse oversized-manifest `true` shortcut
retain their semantics. No new filesystem, cleanup, storage/category or backend
authority is granted by a boolean presence result.

`tests/shared/artifact-io/chunk-meta-presence-resource-lifetime.test.js` authors
actual sync/async public consumers for failed close, native read prerequisites,
observer replacement and first-close recovery without rereading, ordinary
malformed/missing behavior, unknown first-candidate access, falsey access failures,
manifest stat and embedded source-error prerequisites and the oversized shortcut. Existing presence and
traversal fixtures remain intact. Disposable fixture descriptor cleanup is not
settlement proof. Other manifest/cache internals, metadata probes, whole-category
coordination, atomic publication and native/platform/performance qualification
remain separate open scopes.
