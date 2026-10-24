# Persistent parser chunk cache layout

Chunk-cache filenames retain the full local cache key and entries validate that
key plus the persistent schema. Shards use the first two hexadecimal bytes of a
SHA-256 digest of the complete key, rather than its constant namespace prefix.
Changing this physical layout does not change parser/chunk producer meaning.

Readers prefer the digest layout and can use compatible entries from the legacy
`tr` shard. Successful migration publishes the canonical payload before retiring
an identical legacy payload. An interrupted retirement is resumed on a later read;
failed migration leaves the old cache available. Corrupt canonical entries can
fall back to valid legacy entries. Both layouts retain the registered
`tree-sitter-chunks` generated-artifact identity for inventory and collection.
Migration does not implement a second cache root, TTL or quota owner.
