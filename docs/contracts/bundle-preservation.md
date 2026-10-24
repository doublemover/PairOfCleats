# Finalized bundle preservation

Incremental reuse compares the complete serialized chunk payload, including
equal-length text changes, metadata and risk facts, plus file relations,
dependency signatures, parse checkpoints and lexicon filter statistics.
Rebuilding only cross-file facts preserves existing file-local lexicon statistics.

Bundle patches use schema 2. Schema 1 remains readable. Schema 2 separates setting
a field to null from removing it with an allowlisted `unset` entry. Patch
construction follows persisted JSON omission and typed-array rules. A changed
unsupported field requires a full rewrite. Before publishing patch bytes or a
checksum, the writer roundtrips the serialized patch and verifies that it
reconstructs the intended persisted payload. MessagePack continues to use full
bundle writes. These rules preserve content; checksums do not establish that a
producer emitted complete semantic evidence.
