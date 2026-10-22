# Provider parameter-name ownership

Signature parsers and the existing LSP payload merger store dynamic parameter
names with the shared own-property record helpers. Legal names such as
`__proto__`, `constructor` and `toString` are ordinary enumerable data keys;
they cannot invoke a prototype setter or disappear from cache/JSON metadata.
The ordinary object shape is retained for existing consumers.

Completeness and merge lookups require own entries. An inherited JavaScript
property is not a supplied parameter type, and unsupported non-string type
buckets do not become type evidence through string coercion. These rules cover
the current dynamic-name Python, C-like/Java, Swift, Go, Rust, Zig, Lua, Ruby and
Elixir parsers. They do not add another language's unsupported binding grammar.

The request-cache policy is `rq7`, retiring earlier dropped or inherited
parameter meaning. Shared LSP producer identity also changes. Authored parser,
cache, controlled document enrichment and public MetaV2 consumer regressions
remain unrun; native, real-server and full indexing qualification are pending.
