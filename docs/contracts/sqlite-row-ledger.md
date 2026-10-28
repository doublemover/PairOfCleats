# SQLite row-ledger count evidence

The internal ledger is version 2. A count is known only when it is a nonnegative
safe integer. Null/undefined, nonfinite, negative, fractional, unsafe, string and
boolean values remain unavailable; they cannot become measured zero. Producer
and observed dense counts compare exactly, including a declared zero. Partial
coverage still requires its actual producer/validity evidence, not a disabled
equality assertion.

Full builds validate the staged database before replacement. Successful partial
updates use the same post-import count owner before readiness reporting. One
required read-only native connection and transaction observe chunk/dense/file
counts and ANN presence/count. Query, extension and original close/ownership
failures propagate after original disposal. Optional diagnostic probe callers
retain their explicit null/default policy; required publication callers do not.

ANN policy comes from the actual selected configuration and producer state:
ready, disabled or unavailable. Required ready tables cannot be absent/empty
when dense rows are expected. An absent/unavailable optional representation is
explicitly reported; it is not qualified as a healthy zero. Any present admitted
representation compares its actual count, including zero. Table identifiers are
validated before SQL preparation. Extension admission remains with its existing
trusted loader and original ownership checks.

Count equality is **not identity correspondence**. Artifact import now compares
destination chunk ID/mode/file/range/line/metadata against its existing normalized
source stage before retirement. At most 16 bounded mismatch samples are retained.
An ordered, length-delimited SHA256 streams that source projection one row at a
time; the post-import transaction streams actual destination rows and compares
the original digest. The immutable witness is branded in-process and bound to
the actual mode and build owner's logical output, including Windows fallback
staging. Copied JSON, another target/mode and injected probe snapshots cannot
qualify it. Original cursor methods and independent return failures are retained.

This is **normalized artifact-stage chunk coverage**, not a parser oracle or
complete generation/file/vector correspondence. The same native transaction also
checks dense-to-chunk mode/ID membership, chunk-to-file membership, exact native
file chunk counts and admitted ANN-to-dense IDs in both directions. Empty source
manifest entries remain valid. Disabled ANN is explicitly unadmitted. Each
relation retains at most 16 bounded samples and truncation, not a corpus Set;
query failure propagates. Injected snapshots cannot claim this native coverage.
Source file/hash inventories, bundle/incremental source identity,
post-compaction/final publication correspondence and replay remain.
Unadopted routes explicitly report identities unqualified. Bounded streaming
correspondence, generation-qualified replay and acceptance remain #284 work.
No whole-corpus identity Set, public option, backend/schema fallback, skipped
assertion or larger deadline is introduced.

Thirty-three count/capability controls, including a canonical version-2 gate and
six tiny actual SQLite cases, are authored and unexecuted. Thirty-one identity/
cursor/actual-build controls and 16 native correspondence controls are also
authored and unexecuted. The original row-ledger fixture retains all its
positive mismatch/classification assertions. Existing full/incremental/bundle/
mode/native ownership cases require checks against the resulting candidate.
