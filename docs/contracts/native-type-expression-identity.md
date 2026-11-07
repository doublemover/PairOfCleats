# Native textual type identity

Shared type canonicalization preserves JavaScript/TypeScript, JSX and TSX boxed
types (`Boolean`, `String`, `Number`) separately from primitives. It also retains
user identifiers such as `integer` and `float`. A language ID and an unqualified
spelling cannot establish builtin binding identity. Optional search synonyms or
recommendations to prefer primitive annotations do not rewrite recorded facts.

Quoted/template literal contents, identifier case and original source spelling
remain significant. Insignificant whitespace outside literals is normalized.
Existing explicitly supported Python and qualified-prefix rules retain their
separate contracts. This does not add alias expansion, assignability or a type
checker to strict return-expression filtering.

The LSP return/parameter merge, provider payload admission and actual tooling
application owner preserve the expression through inferred metadata and durable
cross-file output. Strict return filters continue to prefer tooling facts and to
match exact token identity; presentation-only symbolic displays remain excluded.
The shared type-normalization and LSP producer versions advance. Provider-result
cache identity now includes those canonical producer versions, and the local LSP
request policy advances to `rq12`, preventing old normalized payload reuse.

`tooling/lsp/type-identity-handoff` uses the supported TypeScript parser's retained
annotations as an independent oracle, then exercises actual signature parsing,
LSP candidate merge, provider admission, tooling application, durable cache and
strict filter/index consumers. Boxed/primitive/union/identifier/literal pairs and
repeated/reversed normalization remain distinct. Existing shared tests retain
their Python, qualified-name and literal coverage with corrected boxed-type
expectations. These regressions are authored; execution remains deferred.
