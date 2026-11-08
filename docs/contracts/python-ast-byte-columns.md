# Python AST byte columns

Implementation status: UNVALIDATED. Regression sources are authored and unrun.

CPython AST columns count UTF-8 bytes within a line; published JavaScript source
spans count UTF-16 units. The chunk owner validates line/column integers and
converts both ends against the original text. Columns beyond content or inside
a multibyte scalar are rejected. CRLF terminators do not become content columns.

The existing request-local line inventory now retains sparse scalar-boundary
checkpoints instead of a `Uint32Array` cell for every input byte. Requested ASCII
lines need no conversion index. A non-ASCII line records a byte/unit pair after
at least 256 scanned bytes; a lookup finds the preceding pair and scans its local
scalar neighborhood. Repeated or reverse-order lookups preserve the same source
coordinates. This changes the physical conversion index, not accepted syntax,
source spans or semantic metadata. No producer-version increment is intended.

The pure regression compares requested columns to independently encoded UTF-8
prefixes, including a four-byte scalar crossing a checkpoint boundary, long
mixed BMP/astral lines, reverse queries, ASCII controls, CRLF and invalid byte
positions. The existing real CPython transport fixture remains the separate
native acceptance obligation. Process memory, timing, native worker behavior and
end-to-end speedup are unmeasured; no source/runtime qualification is claimed.
