# Rust declaration documentation and prefix ownership

The native Rust converter reads attached prefix syntax before releasing its tree.
The grammar's `outer`/`inner` documentation fields distinguish outer item docs
from module/implementation docs and ordinary comments. It walks only the selected
declaration's preceding attribute/comment siblings, stopping at another item.
Outer docs can precede or follow stacked/multiline attributes and blank lines.
Full source coverage, semantic declaration coordinates and documentation ranges
remain separate; retained preamble bytes do not become declaration doc facts.

The 300-character doc preview comes from actual outer documentation content,
including line/block forms. Version 1 attachedDocumentation records exact UTF-16
comment/content and attribute ranges, selected declaration/prefix coordinates and
roles. It reaches the registered docmeta projector, assembled rows and incremental
replay. Up to 512 range records fit this metadata allowance. Overflow retains the
full source envelope and preview, counts omitted records and explicitly reports
partial prefix-syntax coverage. Attribute evaluation, including conditional or
computed `doc` attribute meaning, is not performed; raw attribute source remains
retained and evaluation is labeled not requested.

Rust parameter patterns, return annotations, visibility and function modifiers
use native declaration fields. A doc string, outer/parameter attribute argument,
generic `Fn(...)` constraint or unsafe function-pointer type cannot provide the
function's parameter names or modifiers. Destructuring patterns remain recorded
as source patterns; this does not claim compiler binding resolution or macro/
conditional compilation evaluation. The display signature stays separate.
The native chunk version advances 12→13 and shared sourceChunking 29→30 so old
prefix/doc/semantic metadata cannot qualify replay with the new meaning.

`lang/contracts/rust-attached-documentation` exercises the actual native converter,
query/traversal routes, registered Rust enrichment, payload assembly, warm reuse
and immutable incremental read/write. Controls cover Unicode/CRLF, ordinary and
inner docs, two neighboring declarations, doc-before/after-attribute layouts,
stacked/multiline attributes, blocks, bodyless methods, generic constraints,
parameter attributes, unsafe callback types, exact ranges and allowance overflow.
The fixture is authored; execution and Windows native qualification are deferred.
