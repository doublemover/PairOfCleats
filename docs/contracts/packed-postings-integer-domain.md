# Packed postings integer domain

Status: **UNVALIDATED source and authored regressions**. No fixture, formatting,
bootstrap, database/native runtime or performance qualification has run.

The existing packed wire format encodes unsigned integer varints with per-block
document delta resets. Its decoder now preserves the full nonnegative safe
integer Number domain instead of truncating through JavaScript's signed 32-bit
bitwise operators. Document delta sums must also remain safe integers.

A row's declared count is checked against the minimum two bytes per pair before
allocation. Unsafe integers, impossible counts, truncated varints/pairs and
trailing row bytes throw the existing `ERR_VARINT_DECODE` family. The existing
empty-slice result stays empty. Encoder bytes, block layout, checksum identity,
manifest format, compatibility output and supported loader selection are unchanged.

`packed-postings-safe-integers.test.js` authors an independent BigInt wire oracle,
block boundaries, 32-bit crossings through Number.MAX_SAFE_INTEGER, malformed
row controls, the actual durable streamed writer and manifest-selected bounded
loader. These are unrun; numerical correctness is not a speedup or whole-index
qualification. Invalid legacy producer coercion, strict sidecar admission, native
descriptor lifetime and end-to-end sparse result parity retain separate owners.
The single sparse representation program (#1366) still requires consumer/layout
migration and measured compatibility proof; this codec repair does not remove
either representation or declare that performance issue complete.
