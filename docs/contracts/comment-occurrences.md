# Comment occurrence ownership

Current JS/JSX and TS/TSX source implementation and fixtures are unvalidated.
Other languages retain heuristic extraction; their language-owned adapters remain
required. In particular this change does not repair Rust nested-comment lexing.

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
of producing config segments. Classification/cache/signature policy version 3
invalidates prior extraction meaning; there is no new public configuration knob.

Remaining work includes bounded config-parser admission, logical fence-content
mapping, compact token eligibility/materialization, non-JS lexical adapters and
functional consumer/replay/import/performance checks. The 12 authored
`indexing/segments/parser-comment-occurrences/*` cases have not run.
