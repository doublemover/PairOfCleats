# Provider type and signature literal inputs

Provider signature input, parse-cache identity and request-cache payload
normalization preserve quoted literal contents before invoking final type
canonicalization. Whitespace folds only outside quotes. Distinct string literal
values, including repeated spaces and tabs, cannot become one parsed type or
cache entry. Malformed quotes and private placeholder input retain their original
text without applying syntax rewrites.

The Python parser removes known namespace prefixes only from complete qualified
identifier chains outside literals. Custom qualified chains and literal strings
such as `"typing.Foo"` retain their identity. C-like qualifier cleanup likewise
cannot remove a word inside a string template argument. The Lua parser preserves
its quoted type labels. These adapters use the existing shared literal-mask
owner; other language-specific parser limitations remain explicit.

The request-cache policy is `rq6`; signature parse keys use a version4 JSON tuple
instead of delimiter concatenation. Both retire earlier ambiguous input meaning.
Shared LSP producer identity also changes; canonical type-normalization rules
themselves are unchanged. Authored actual parser/cache/cold-and-warm document
regressions remain unrun, with real-server and runtime qualification pending.
