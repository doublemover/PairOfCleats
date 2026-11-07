# CSS import source facts

Ordinary `.css` import collection uses one bounded lexical owner, independent of
native parser availability. It distinguishes comments, strings, escaped names,
URL tokens, functions and balanced blocks according to
[CSS Syntax](https://www.w3.org/TR/css-syntax-3/). Comment or declaration-string
substrings cannot supply imports. Whitespace/comments between rule tokens,
quoted spaces and escaped code points retain their actual decoded URL identity.
Malformed values cannot become shorter successful URLs.

Each occurrence carries half-open UTF-16 rule, literal and value spans, its raw
literal, decoded specifier and source context. Duplicate occurrences remain in
the immutable fact model; only the dependency list deduplicates. Layer, supports
and media suffixes retain source ranges consistent with the
[@import structure](https://www.w3.org/TR/css-cascade-5/#at-import). Their receipt
describes source evidence, not browser activation. This is a bounded supported
lexical subset, not full media-query validation or stylesheet execution.

Coverage is complete, partial, cancelled or unsupported. Existing collector
budgets bound source, tokens, matches, lines and time; internal stack, qualifier
and block caps also retain explicit reasons. Source truncation cannot complete
an unfinished last rule. Cancellation is checked inside long comments and
literals. Malformed, unsupported and capped observations emit collector
diagnostics and remain visible on relation and scan receipts. SCSS/LESS are not
qualified by the CSS route. No fetch, rendering, preprocessors or project hooks
run during collection.

Prepared contexts own weak receipts for exact source, dialect and collector
policy; copied public shapes cannot authorize reuse. Relations reuse prepared
import facts. Heuristic chunking uses the same comment/string-aware block
boundaries; native chunking keeps its existing single parse/disposal owner.
Chunk dispatch admits owned matching source/chunk/parser-policy receipts,
including observed null chunks, without parsing again. No global text cache or
retained native tree is added.

Parsed-literal provenance survives registry and import-pass admission, including
punctuation/whitespace which belongs to the URL. URL/path resolution remains a
separate owner. A partial CSS receipt cannot qualify an incremental bundle's
imports for warm reuse. Import scan fingerprints include the shared semantic
importResolution producer, now 13; sourceChunking advances to 18 because token
block boundaries replace raw brace matching. Public CLI, configuration,
reason-code and graph-format contracts are unchanged.

Authored, unrun fixtures are `css-import-source-tokens.test.js` and
`css-import-registry-replay.test.js`. They preserve exact value/span oracles,
duplicate occurrences, malformed and bounded controls, native-enabled and
explicitly disabled registry/relations, a present ghost-file graph negative,
prepared empty/source-change behavior, and real incremental bundle replay.
These are pending runtime validation; native and latency qualification are not
implied by source implementation or formatting.
