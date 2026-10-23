# Native call occurrence projection

The parser owner captures immutable UTF-16 call facts before releasing its native
tree. C/C++, Ruby and the shared brace-delimited relation helper copy those facts
into mutable inference details. Existing per-language callable admission still
applies. C/C++ keeps its existing usage collector, but native callable calls come
from syntax facts rather than another body regex scan. The standalone heuristic
path reports partial callable-body coverage.

The native detail producer declares `native-syntax-occurrences-v1` ownership.
That marker is required before selecting native facts: a native chunk can also
have a separate Babel/compiler/heuristic relation producer. Its evidence must not
be silently replaced or discarded by unrelated chunk metadata.

The registered native chunk projection joins an occurrence by its source start/end,
original caller start/end and raw callee preview. Display names alone cannot join
overloads, prototypes or repeated declarations. Both call pairs and occurrence
details pass through their existing inference budgets; chunk metadata supplies
identity, never a replacement for evidence discarded from those channels.
Resolution annotations remain on the mutable derived details.

Chunk limits retain the original parser snapshot. Projection admits only complete
occurrences inside the current window, keeping their original declaration owner
coordinates. A call crossing a split is omitted with `split-call-occurrence`
partial coverage. Missing retained details likewise report
`unavailable-call-occurrence-details`. No repeated name or overlapping geometric
index overrides the native occurrence owner.

C/C++ parameter defaults, `noexcept`, `decltype` and requires-expression roles do
not become ordinary body calls. Their omitted calls retain declaration-role
diagnostics. Default argument substitution needs a separate call-site execution
owner; this slice does not provide it. Constructor initializer expressions remain
eligible ordinary execution facts. Ruby defaults retain their existing method
execution policy. Anonymous callable barriers retain their explicit omissions.

`SYNTAX_CALL_FACTS_VERSION` is 3. The shared source-chunking and call-flow
identities must retire the changed metadata, call handoff and owner projection.
The authored native/registered adapter, lexicon, call index, chunk limits and
canonical call-site controls are unrun for this source wave. This change does not
qualify complete language syntax, parser recovery, dynamic target resolution,
native lifecycle, cross-edit reuse or performance.
