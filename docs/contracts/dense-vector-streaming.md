# Dense vector streaming

The existing uint8 row-major binary format is a canonical ANN handoff when the pieces manifest declares both the selected binary and its metadata. The resolver validates the metadata envelope, explicit count/width, model and requested identity/generation, metadata checksum, binary path authorization and any coexisting textual metadata. A declared malformed binary fails closed; neighboring undeclared binaries do not authorize themselves. Legacy JSONL and JSON remain explicit fallback paths when no manifested binary is selected.

`iterateDenseVectorBinaryRows` yields bounded immutable byte windows in ordinal order. Each row carries `docId`; missing-channel bits yield an empty vector at that ordinal, while a present all-zero vector remains present. Positive short reads continue from their exact offset. Zero/invalid progress, truncation, changed descriptor metadata, cancellation and manifest-checksum mismatch fail the iterator. SHA1, SHA256 and the existing xxh64 manifest checksums are supported. Consumers publish only after successful iterator completion; LanceDB writes during iteration remain inside its private replacement generation. A selected range still verifies all physical bytes when a whole-file checksum is supplied.

Windows default to 1 MiB and admit individual rows up to an internal 16 MiB ceiling. The reader owns one current window; retained row references belong to consumers and are never overwritten by subsequent reads. Metrics count read calls, bytes and peak window capacity. These are operation counters, not measured runtime improvements.

SQLite embedding reconciliation opens and validates the binary descriptor and exact length before opening the mutable database. It streams incoming rows through the same width/presence contract, retains bounded 256-row pages of old IDs and lengths, and fetches at most one old payload for an exact byte comparison. Old payloads with a different width need no hydration. Mutations remain inside one transaction, including dense schema changes, metadata, deletions and optional ANN rebuilding. Late read/integrity failures roll back that transaction. Descriptor cleanup runs even if database acquisition fails. The compatibility helper that explicitly asks to materialize rows remains available; the update owner does not use it.

No-op base vectors receive zero payload writes. Optional ANN rows are still reconciled when the extension is available: unchanged base bytes alone cannot prove an ANN table survived prior unavailability or recreation. Verified generation-delta ranges, measured transaction timing/RSS, real extension qualification and crash acceptance remain open; no scan avoidance or ANN write-free claim is made without their authority.

Textual dense artifacts remain published. Current consumers include retrieval artifact loaders, index validation, SQLite artifact ingestion, evaluation/inspection tools and legacy native handoffs. Omitting textual output requires a separately versioned compatibility cutover across those owners. This change prefers binary for native backend input without silently removing either published representation.

The authored regressions cover binary/text parity and masks, xxh64 manifest verification, truncated/mismatched input, positive-short-read progress, cancellation cleanup, bounded SQLite reconciliation, exact edits/deletions and rollback after an earlier mutation batch. All execution, native and performance qualification is deferred.

Strict direct and lazy retrieval distinguish an absent optional binary metadata
family from a declared missing, malformed or integrity-invalid family. Metadata
checksums (SHA1/SHA256/xxh64) are verified against the same bounded raw bytes then
decoded/parsed, including manifested compressed metadata and backup selection.
A previous stat/cache observation cannot authorize different restored-mtime bytes.
Absent preferred split vectors may select healthy merged vectors; declared failures
propagate instead of turning into ANN unavailability. Permissive optional-format
fallback retains its existing rules.
