# Go provider type tags

The existing Go signature parser preserves quoted struct-tag data while folding
whitespace outside literals. Tags in parameter and return types retain repeated
spaces and punctuation before final type canonicalization. Type parameter lists
use the shared quote-aware delimiter walker, so a `]` inside a raw tag cannot
close the generic header; token whitespace before the list is accepted.

This extends the current provider signature approximation. It does not add
complete Go constraint/type checking or automatic source resolution.
Request cache policy `rq11` and shared LSP producer identity retire the changed
tag and generic-header metadata. Authored
actual parser, cache-identity and controlled document enrichment regressions
remain unrun; native, real-server and full indexing qualification are pending.
