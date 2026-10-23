# Provider signature parameter enclosures

The current Swift, Zig, Elixir, Ruby, Lua and C-like/Java adapters use the shared
quote-aware punctuation walker to find the parameter enclosure. Quoted closing
parentheses, nested type expressions, a callable return type and trailing body
calls cannot stand in for that enclosure. Parenthesis matching does not treat
comparison operators in a default expression as generic delimiters.

Type-argument splitting preserves both `->` and `=>` as arrows rather than
closing an enclosing generic argument. The affected Zig, Elixir and Ruby
normalizers, and Swift signature presentation, also preserve quoted whitespace
through the existing shared literal owner. This remains the existing
provider signature approximation; it does not establish a complete language
parser, comment grammar or arbitrary default-expression grammar.

Request cache policy `rq11` and shared LSP producer identity retire the changed
parameter/return metadata. The authored parser-dispatch and actual controlled
document enrichment regressions remain unrun. Native, real-server, whole-index
and runtime qualification remain pending.
