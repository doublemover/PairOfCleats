# Prepared artifact rows

Status: **UNVALIDATED partial implementation for #1363**. No executable checks,
formatting, native work or benchmarks ran for this change.

`createPreparedJsonlRows` supplies a shared internal final-row product. It encodes
an admitted JSON row once, owns the parsed value independently of the caller,
freezes its complete JSON structure and privately associates exact line bytes
and newline-inclusive UTF-8 size. Only the actual product receives that receipt;
copied fields or a copied row do not carry it. A different layout or custom sizing
serializer must encode its own projection. No artifact format/version, public
configuration, trim limit or compatibility representation changes.

Each invocation retains at most 5,000 new encoded lines within a 4MiB reuse
allowance. Charging uses the larger of UTF-8 bytes and two bytes per retained
string code unit, including its terminator. These are encoded-payload accounting
limits, not a measured total heap/RSS bound: owned JSON objects, parse temporaries,
WeakMap overhead and the existing caller's full row collection remain separate.
An over-budget trim candidate never reserves reuse allowance. Exhaustion preserves
ordinary row admission/encoding; it does not drop or trim extra records. Ordinary
serialization can still allocate an oversized candidate before its existing row
check, so this does not claim pre-encoding input memory admission.

The first producer is the actual symbol writer. Its existing fitting/trim decision
now supplies final size to trim statistics and the private final product to
measurement and both raw/compressed, ordinary/sharded JSONL writers. The existing
sort order, trim stages, maximum row bytes, offsets, metadata and conflict behavior
remain. Admitted products cannot change when caller export arrays change while
queued output waits. Existing legacy `__jsonl` handling remains a separate path;
this work does not turn those public fields into private provenance.

Authored controls cover exact Unicode/escaped bytes, complete immutable ownership,
cache/row allowance exhaustion, custom projection, circular/unsupported inputs and
actual deferred symbol raw/gzip/sharded writes, offsets and trim/drop decisions.
Operation-count expectations describe the authored controls, not a passing result
or measured speedup. Actual memory/GC/CPU/I/O and failure/cancellation qualification
remain open. Chunk metadata/token packing and hot/cold/binary fan-out, repo-map and
graph order/spill reuse still need migration through bounded shared preparation;
this first producer does not complete #1363.
