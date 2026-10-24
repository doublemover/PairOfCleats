# Saved map byte admission

Status: source and regression assertions unvalidated. The existing saved-map
reader remains a bounded materializing compatibility input, separate from the
unfinished canonical streaming source reader.

`readSavedMap` admits one regular file of at most32MiB through one owned file
descriptor. It hashes original stream bytes while reading, then compares the
descriptor's device/inode/size and nanosecond modification/change timestamps
before and after reading and against the selected path. Growth, in-place changes
or path replacement during admission refuse publication. A preview already
admitted from a stable file retains its earlier pinned bytes when the path changes
later, as before. These checks detect observed file-instance changes; they do not
provide an OS snapshot or a lock against arbitrary external writers.

Duplicate member admission reuses the transport's typed opaque identity owner.
Numeric0 and textual"0" remain distinct source identities; an exact duplicate of
either is refused. Legacy textual endpoint aliases cannot collapse these records
before the pinned transport has a chance to resolve their actual scalar IDs.

UTF-8 decoding is fatal on malformed byte sequences. Invalid bytes cannot become
replacement characters and silently acquire a different saved-source identity.
After existing map-model/version/entity/JSON-depth admission, the reader compares
the admitted UTF-8 digest and byte length with the original stream digest and
length. Split multibyte stream chunks remain valid because decoding sees the
complete bounded byte sequence. Source scripts are still never executed.

Cancellation checks surround reads and admission publication. The descriptor
has one attempt-scoped close owner on success, failure and cancellation. An
admitted model is published only after its original handle's close promise
fulfills. A rejected close preserves the exact primary read/parse/cancellation
cause and actual close failure in an aggregate, including frozen original errors.
The non-enumerable `mapSavedHandle` capability retains that exact resource and its
captured close method for explicit coalesced reconciliation. It never reopens the
filename, acts on a saved numeric fd, substitutes another method or closes a
sibling handle. A rejected close stays pending; an fd property or absent error
is not settlement evidence. Successful reconciliation returns explicit
`settled:true,pending:false` and preserves earlier failure diagnostics.
Cancellation arriving during close still waits for that exact call to settle;
it cannot publish an otherwise admitted model afterward. If that close rejects,
the cancellation and close failure are both retained.

The retained error's existing `cacheOwnershipPending`/`cacheOwnershipReleased`
observation also respects any other pending resource carried by the original
cause. No new cache/session namespace is introduced. Callers must retain this
error/capability until exact cleanup settles; serialization does not retain a
resource capability. There is no automatic path/raw-descriptor fallback or a
claim that failed closure has already released the resource. Input-model semantics, source scope,
legacy/version handling and generation health remain unchanged. Stable saved
bytes do not prove that an old source generation is current or complete, and no
CPU/heap/latency or browser acceptance follows. The authored recording filesystem
regression covers stable Unicode bytes, replacement/in-place/growth controls,
malformed UTF-8, cancellation and exactly-once descriptor cleanup; it has not run.
