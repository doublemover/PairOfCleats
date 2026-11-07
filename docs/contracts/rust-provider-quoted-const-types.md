# Rust provider quoted const types

The existing Rust signature parser preserves ordinary quoted literal whitespace inside parameter and return type expressions, including array-size constant expressions. It locates the outer `where` clause using the shared quote/nesting-aware scanner with Rust lifetime handling. A quoted `where`, nested const expression, qualified name or raw identifier cannot be selected as that clause keyword.

The syntax context follows the Rust Reference's [array types](https://doc.rust-lang.org/reference/types/array.html) and [const generic arguments](https://doc.rust-lang.org/reference/items/generics.html#const-generics). This parser retains reported type text; it does not evaluate constants, establish toolchain compatibility, validate trait constraints or provide complete Rust lexical support. Raw strings with embedded delimiters, macros, comments and arbitrary type-level syntax remain outside this narrow ordinary-quoted repair.

Parser results feed the actual generic provider dispatcher, request-cache normalization and document enrichment. The cache policy advances to `rq11`; the shared LSP producer identity must advance. Shared canonical type rules are unchanged. Existing lifetime spelling may be conservatively retained when generic literal normalization cannot interpret it.

Authored regressions cover quoted const strings, a quoted `where`, the real outer clause, lifetime returns, qualified/raw/Unicode keyword negatives and cold/distinct/warm enrichment. They are **UNVALIDATED**: no tests, syntax, format, bootstrap, rustc/rust-analyzer/native process, constant/source execution or performance qualification was run.
