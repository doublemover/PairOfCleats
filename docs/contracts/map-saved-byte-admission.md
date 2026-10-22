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
closes in the existing finally owner on success, failure and cancellation; no
new cache/session namespace is introduced. Input-model semantics, source scope,
legacy/version handling and generation health remain unchanged. Stable saved
bytes do not prove that an old source generation is current or complete, and no
CPU/heap/latency or browser acceptance follows. The authored recording filesystem
regression covers stable Unicode bytes, replacement/in-place/growth controls,
malformed UTF-8, cancellation and exactly-once descriptor cleanup; it has not run.
