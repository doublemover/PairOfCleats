# Semantic source reference projection

Detail, find and trace may return `sourceRefs` for span-bearing records in the
current bounded page. Each entry contains the qualified `ref`, retained
`sourceUnitId`, exact original-byte SHA256 `sourceHash`, repository-relative
`path`, and `coordinateUnit` (`utf16` or `byte`). Explain uses the same entry
contract with its existing smaller limit.

Artifact and SQLite stores read the source header belonging to the admitted
partition in the pinned generation. Duplicate, missing or mismatched source
headers and spans outside the retained coordinate length are integrity errors.
The projection reads no current worktree files and grants no write authority.

UTF16 coordinates preserve the source BOM, CRLF and surrogate pairs. Editors
must verify the original disk bytes and qualify any document normalization
before selecting a range. Byte coordinates require their own adapter. A source
with a retained generated-source mapping is omitted until a coordinate adapter
actually resolves that mapping; its path alone cannot authorize navigation.

Metadata shares the record page's byte and elapsed-work limits. Missing source
projection support, unavailable mappings or exhausted projection allowance may
leave `sourceRefs` empty with an explanatory warning. Record selection, cursor
progress, analysis coverage and negative request contracts remain authoritative.
Metadata availability does not make incomplete analysis complete.

The artifact/SQLite parity, exact-source admission, bounded-page and editor
regressions are authored. Execution and host qualification remain deferred;
this document records the intended contract, not a passing test receipt.
