# R static dependency arguments

The registered R collector reads `library`, `require`, `requireNamespace` and
`source` argument tokens without evaluating R code. `source` selects its `file`
argument; package calls select `package`. Named arguments can precede a positional
target. Duplicate target or `character.only` arguments do not establish one
concrete dependency.

Backtick spellings are identifiers, not quoted strings. A backtick package name
can supply the same static package spelling as a bare name under ordinary
`library`/`require` substitution. With `character.only=TRUE`, it remains a dynamic
variable. `source` and `requireNamespace` require supported literal strings.

Literal decoding uses the original token range, preserving escaped quote,
backslash, ASCII hex/octal and explicit Unicode spellings. Unknown escapes,
surrogates, out-of-range code points and embedded NUL do not invent a dependency.
Non-ASCII hex/octal bytes need producing encoding authority and remain
unsupported here. Raw R strings and complete R argument/evaluation semantics
remain separate qualification work.

The shared static-call cursor indexes parentheses once and yields nested
recognized calls as well as their containing calls. A dynamic outer argument
cannot hide a separately supported nested include. Lexical scanning and request
enumeration use the existing collector time/match/token bounds and diagnostic
finalizer; no new public knob or persistent store is introduced.

Authored collector and registered relation-projection regressions are
unvalidated. They do not claim R parser, package loading, project execution,
ambient encoding, full dependency closure or performance qualification.
