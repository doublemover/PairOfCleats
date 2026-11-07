# Comment occurrence ownership

Current JS/JSX, TS/TSX and Rust comment source implementations and fixtures are
unvalidated. Other languages retain heuristic extraction; their language-owned
adapters remain required. Rust uses a separate bounded lexical adapter.

The language parser captures an immutable comment occurrence product at AST
admission. It contains policy version 1, parser/options/version, language/dialect,
source length and SHA-256 over UTF-16LE source text, UTF-16 half-open ranges,
line/block kind, documentation-candidate role and explicit coverage/reason.
This text identity is distinct from the canonical original-file byte hash.
Candidate documentation is unassociated until the declaration owner attaches it.
No native tree/AST, raw source copies or cleaned comment prose are transported.

JavaScript's existing Babel/Acorn/Esprima source owner and TypeScript's existing
Babel syntax owner capture comments once. CPU comment metadata receives the same
prepared context; complete compatible products bypass the generic scanner.
Regex literals, template interpolation and ECMAScript CR/LS/PS termination follow
the parser. Display line numbers retain the shared LF convention. AST comment
mutation after admission cannot replace captured ranges.

Only privately admitted products with identical source and dialect are reused.
Standalone callers lazily select the same source parser, bounded to 8 MiB of
source characters, without adding code parsers to the eager comment import graph.
The occurrence product admits at most 20,000 validated nonoverlapping ranges.
Budget failure is unavailable, not an exact empty inventory or an unbounded
fallback. Failed/recovered/mismatched syntax and unsupported languages retain the
legacy scanner with explicit **heuristic** coverage and reason. They are not
qualified language-specific lexical adapters.

Paired-mode cache entries retain visible immutable source extraction and exact
source text for accounting. A reused caller hash cannot substitute different
source. A supplied AST's current parser identity must match before reuse; changed
parsers recompute. Consumer dictionaries still retokenize independently.

Config-fence parsing is requested only for extracted-prose or code mode with
`includeInCode=true`. Paired prose preparation deliberately requests the future
extracted-prose product. Comment references and stripping remain available when
config segments are not demanded. Standalone extraction retains its prior default
of producing config segments. Classification/cache/signature policy version 5
invalidates prior extraction meaning; there is no new public configuration knob.

Config parsing admits at most 32 candidates, 64 KiB UTF-8 per candidate, 256 KiB
aggregate parser input and 20,000 closing-fence search lines per file. Count and
byte admission precede content assembly/vendor entry. Parser libraries load only
after demand/admission. Required-library failures propagate; invalid syntax is
distinct from partial budget omission. Internal construction receipts retain
counts, bytes and bounded exclusion reasons; they do not describe later cache-hit
cost. No synchronous elapsed-time deadline or full structural bound is claimed.

Comment eligibility now retains exact emitted-token counts without full output
arrays. It uses the existing normalization/dictionary/stopword path, counting both
duplicate tokens and each stem contribution. Only actual field consumers produce
tokens for their UTF-8-clipped input and effective extension/dictionary/policy.
Clipped token results are deliberately not reused across mutable dictionaries or
configurations. Raw paired extraction still reuses compatible source products.
Existing positive tests consume actual prose chunks rather than unused arrays.

Rust's adapter handles nested block comments, raw UTF-8/byte/C strings, ordinary
strings, character literals and lifetimes. Its LF termination and inner/outer doc
roles follow the [comment grammar](https://doc.rust-lang.org/reference/comments.html)
and [literal grammar](https://doc.rust-lang.org/reference/tokens.html), independently
of JavaScript's CR/LS/PS policy. Original CRLF offsets remain; bare CR in a doc
comment is unavailable. Ordinary four-slash and extra-star comments stay ordinary.
Bounds are 8 MiB source characters, 128 block nesting levels, 255 raw-string hashes
and the shared 20,000 occurrences. Unfinished or unadmitted Rust lexical context
is unavailable, with no generic fallback presented as a complete inventory.
Complete comment coverage is not a Rust compiler/syntax validity qualification.

Remaining work includes logical fence-content mapping/shared fence grammar,
parser structural admission, other language adapters and functional consumer/
replay/import/performance checks. The 12 parser occurrence, 13 Rust occurrence and
10 `indexing/segments/comment-work-admission/*` cases have not run. No measured
speedup, parser-call result or consumer acceptance is claimed.
