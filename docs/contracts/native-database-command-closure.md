# Canonical native database command closure

The canonical `sqlite.compact` and `lmdb.build` entries register every returned
database handle with the existing lifecycle registry before using it. This
includes SQLite handles opened to fold WAL bytes during publication. Explicit
closes and final cleanup share one close result. A close failure remains unknown;
an already fulfilled JavaScript command cannot turn it into settled ownership.

Both entries close terminal display owners in finalizers. Compaction closes
source and output databases on early preparation failures, preserves a primary
write failure through cleanup, reserves a fresh uniquely named sibling instead
of deleting a prior crash artifact, and retains a staged database when its close
is unknown. Library compaction errors throw instead of exiting their caller.

Under the internal delegated cache import gate, an entry binds its exact
canonical command identity and sends the authenticated settlement receipt only
after every registered database close succeeds. These two entries create no
subprocess descendants. The parent still requires actual child close. A failed
operation may report failed status while proving database closure; a failed close
or missing settlement keeps the existing pending exclusion.

No public cleanup override, command flag, receipt file or serialized boolean can
grant the child this authority. The internal IPC/import owner remains required.

The actual SQLite/inert async-close regression is authored and unrun. Actual
delegated SQLite compaction, LMDB build, cancellation, restart and terminal-host
qualification remain outstanding. This source contract is not runtime acceptance.
