# Source-pinned cross-file chunk ranges

Cross-file inference obtains chunk text through its existing verified source
reader. For a file with an admitted producer byte identity, `start` and `end`
must be safe integer UTF-16 offsets with `0 <= start <= end <= text.length`.
Neither endpoint may split a surrogate pair in the decoded text. Decoding uses
the same existing source owner as Stage 1. Empty ranges and an endpoint at EOF
remain valid.

An invalid pinned range fails with `ERR_CROSS_FILE_SOURCE_RANGE`. It does not
coerce a string/fractional/missing offset, clamp an oversized end, read a negative
offset from the file tail, or fall back to a full source file. The failure goes
through the existing cross-file failure/progress path rather than becoming an
advisory empty chunk. The raw input is not rewritten.
Malformed offset types/order are rejected before source acquisition; decoded
length and surrogate boundaries are checked on the verified text.

The output fingerprint distinguishes safe integer offsets from invalid offsets;
an invalid value cannot alias a valid zero offset and bypass admission through a
previous warm cache entry. Existing source byte identity, cache limits and
required complete replay policy remain unchanged. The shared call-flow producer
version also binds this stricter source-to-return-fact admission.

Legacy files without a producer byte identity retain their historical slice
behavior. Their existing unqualified source coverage continues to exclude output
replay. This change does not qualify that legacy behavior, prove parser/chunk
context equivalence, establish embedded segment rebasing, or validate unrelated
provider coordinates.

Authored controls cover source-reader admission, Unicode boundaries, malformed
and oversized offsets, empty ranges, actual source-pinned inference and warm
replay, and preservation of a valid completed cache after failed admission.
They remain **unvalidated**; no runtime, memory or performance acceptance is
claimed.
