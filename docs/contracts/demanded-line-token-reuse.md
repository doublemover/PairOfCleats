# Demanded file-line token reuse

The existing opt-in `languageOptions.tokenization.fileStream` execution route uses
the source line-offset index to prepare only requested complete lines. Exact
chunk-boundary and unmodified-text gates remain authoritative. Partial lines,
unavailable identities and refused admission use the ordinary exact chunk
tokenizer; failed preparation propagates its original failure.

The file-local owner keys each line by source hash/algorithm, exact source offsets,
mode, extension, language, dictionary dependency receipt/object identity, normalized
dictionary segmentation, lexical analyzer version and the line-policy version.
The existing build dependency signature supplies the dictionary receipt even when
incremental replay is disabled. Missing authority never enables reuse.

Admission precedes line slicing/tokenization. Internal defaults are 8 MiB and 512
retained lines, at most 128 lines/16,384 UTF-16 input characters per window and
8,192 per line. Conservative preparation and window-output reservations count
alongside retained blocks; non-ASCII input reserves normalization expansion.
Actual immutable token/punctuation products reconcile retained logical bytes.
Unexpected output exceeding its reservation is a failure. These logical byte
estimates are not a V8 heap or RSS measurement. No public setting is added.

Overlapping compatible lines reuse their blocks. LRU eviction preserves lines
pinned by the current window. Source-ordered processing retires lines ending
before the next chunk starts. Unordered processing retains the same bounded LRU.
Success, early return, failure and cancellation all close the file owner. Failed
windows publish no partial blocks; cancellation stops further preparation.

The existing chunk-scoped punctuation cap, synonym sequence, downstream token
identity/statistics and posting owners remain in use. Legacy standalone whole-file
helpers and their coverage remain available; production no longer eagerly builds
their entire-file result. Lexical analyzer version 4 also enters the tokenization
signature so existing replay cannot silently retain the previous meaning.

Twelve recording/production controls are authored in
`indexing/file-processor/demanded-line-token-cache/*`, including exact downstream
chunk/posting parity, fallback and failure cleanup. Execution is deferred. Dense
overlap and sparse demand still require separate serial measurements retaining
raw preparation counts, logical-byte high water, CPU/GC and wall samples. No
runtime performance or final-head correctness pass is claimed from source work.
