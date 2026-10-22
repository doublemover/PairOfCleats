# Haskell provider type inputs

The existing generic Haskell provider parser preserves whitespace inside type-level string and character literals. Its arrow/context/forall scan distinguishes complete character literals from promotion ticks and identifier primes. Promoted constructors, lists and tuples therefore do not open an unterminated quote that hides later function arrows. A quoted `=>` is not a constraint context, and a period inside a nested kind annotation is not the outer `forall` separator.

The syntax distinction follows the [GHC datatype-promotion guide](https://ghc.gitlab.haskell.org/ghc/doc/users_guide/exts/data_kinds.html), [GHC type-level literals guide](https://ghc.gitlab.haskell.org/ghc/doc/users_guide/exts/type_literals.html) and [Haskell lexical specification](https://www.haskell.org/onlinereport/haskell2010/haskellch2.html). The parser retains type spelling; it does not evaluate types, validate extension availability or replace GHC's lexer/type checker. Linear arrows, visible type applications, arbitrary comments/operator names and complete HLS/cradle/source admission remain outside this repair.

The ordinary parser dispatch, request-cache owner and document enrichment consume these results. The current local cache policy is `rq10` and the shared LSP producer identity governs admission; shared type canonicalization rules are unchanged. Authored regressions cover type-level strings, promotions, identifier primes, character escapes, nested arrows, quoted context tokens and cold/distinct/warm document enrichment.

All regressions are **UNVALIDATED**. No tests, syntax, format, bootstrap, HLS/GHC/compiler/native process, source execution or performance qualification was run. Normal Haskell source-route and real-tool qualification remain partial.
