# R static dependency ownership

The registered R collector supports bare dependency built-ins and explicit
`base::` / `base:::` forms. Member and slot calls, and other package namespaces,
do not establish the identity of a base dependency built-in. Bare-name shadowing
and evaluation remain outside this passive collector's authority.

For `library` and `require`, bounded argument tokens bind exact names first,
unique partial names second, then remaining positional arguments. Ambiguous or
duplicate binding is omitted. A bare package identifier is concrete only with
an absent or literal `FALSE` `character.only` argument, including its positional
form. Quoted package names retain their prior literal identity behavior.

The R lexer treats raw character constants as opaque tokens, including bracket,
brace, uppercase and dash-delimited forms. Embedded call-shaped text is never
rescanned as code. Source length, match, token and cooperative time limits remain
the collector's existing limits; this does not execute R or resolve expressions.

The supported syntax and formal order follow the official R
[quote documentation](https://stat.ethz.ch/R-manual/R-devel/library/base/html/Quotes.html)
and [package loading signatures](https://stat.ethz.ch/R-manual/R-devel/library/base/html/library.html).
Registered collector/relation controls are authored and UNVALIDATED in this wave.
