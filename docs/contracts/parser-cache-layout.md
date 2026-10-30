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

Persistent schema 2.0.0 binds producer 17 and the caller's original UTF-16 source
extent. Schema1 entries are disposable misses rather than migrated facts. Both
canonical and legacy reads use the verified contained descriptor owner, admitting
at most 8 MiB before payload allocation/decode. Rows require safe integer,
nonempty, source-contained ranges and typed names/kinds; nested JSON metadata is
bounded to 32 levels, 250000 values and 20000 rows. A larger legitimate parse
product bypasses caching; it does not become unsupported source.

Memory entries and the independent positive persistent memo share a 32 MiB
charged retention budget. Each copy is charged twice its serialized UTF-8 bytes
plus 64 bytes per traversed value, a conservative accounting policy rather than
a measured heap peak. Deep cloning keeps caller mutation out of both tiers.
This bound covers one JavaScript isolate; worker multiplication and process RSS
remain separately unobserved. Count limits and digest sharding remain active. Oversize/schema/missing reasons
are bounded metric categories. Decoded/read bytes are separately counted.

Unconfirmed descriptor closure propagates with its exact original recovery
session. The same cache key cannot admit replacement writes or retirement until
that original session settles. Ordinary settled disposable-cache errors can miss;
an unresolved resource is never converted to a parser fallback. Portable tests
inject reparse kind at the actual authority check without creating OS links.
