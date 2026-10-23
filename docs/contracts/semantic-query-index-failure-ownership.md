# Semantic query-index failure ownership

Offset writes and final part syncs borrow their actual opened FileHandle through
the existing private descriptor resource owner. That owner captures the original
close method and receiver before work. The local borrow also captures the
writeFile and sync methods before awaiting either operation. A failed close
retains its exact original recovery session; it does not become a successful
writer result, a sync retry or authority to delete an output directory.

The query-index writer captures the original resource observation before writer
cleanup and before retiring its task-owned directory. All observed original work
must confirm settlement before recursive removal. A pending descriptor leaves
that directory and its reserved working/final disk credits intact. The failure
records the directory and reserved byte count as diagnostics, not an independent
recovery capability. Explicit recovery closes only the original descriptor and
does not rerun writes, syncs, publication, deletion or disk-account release.

Primary and cleanup failures use the existing storage error compositor. Falsey
throws and frozen errors remain independent original causes. The established
`cleanupError` diagnostic remains available when cleanup itself fails, without
mutating the thrown primary. Successful removal is required before credits can
be released. Hash, offset, ordering, piece and producer identities are unchanged.

The authored controls exercise real query-index part/offset writes, original
FileHandle close faults, write/sync faults and rejected directory retirement.
They are **UNVALIDATED**. This slice does not establish a full stream/compression
writer lifetime proof, a durable failed-directory replay workflow, arbitrary
scheduler callback closure or cross-process publication/native qualification.
Those obligations remain open. No measured performance or broad issue closure is
claimed.
