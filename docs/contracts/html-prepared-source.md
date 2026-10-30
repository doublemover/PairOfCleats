# Prepared HTML source ownership

The HTML registry prepares one parse5 document for an immutable source string.
The canonical profile explicitly enables source locations and scripting, uses
the default parse5 adapter and interprets offsets as UTF-16 JavaScript string
coordinates. Installed parse5 version, exact source SHA-256/length/UTF-8 bytes,
actual parse calls, projection node visits and parse/fallback status are retained
as internal context diagnostics. `sourceStringBytes` accounts source storage only;
it is not a parse-tree, heap or RSS maximum.

`html-prepared-document.js` owns private branded live handles. Chunk and metadata
projections share a handle only when exact source text and the complete profile
match. Different source, scripting/location settings, forged objects and released
handles receive a newly prepared canonical tree. Path equality grants no reuse.
The existing Tree-sitter HTML selection and embedded-language chunkers retain
their roles and fallback order.

The registry projects chunks and document metadata before releasing the full
tree in `finally`. Parse failure is shared by both projections and retains the
existing explicit Tree-sitter/document fallback and invalid import receipt.
Cancellation propagates; pending resource observations cannot become successful
empty metadata. No process-wide strong tree cache or new public parser option
is introduced. Existing source admission continues to bound input; tree and
projection overhead remain unmeasured.

Only compact facts survive under the weak, file-attempt context owner. Import or
metadata consumers may pass that same context through the existing internal
options handoff. A private exact-source/profile check admits reuse after tree
release. Returned arrays and nested occurrence coordinates are copied, so caller
mutation of exposed context metadata cannot rewrite private facts. Explicit
context release invalidates reuse; normal context collection releases its weak
entry. Independent import-discovery attempts without that context still parse
their own source and do not acquire cross-file or cross-build reuse authority.

Standalone chunk, metadata and import entry points remain available. Relations
and document metadata retain separate projections so disabled/filtered relations
cannot remove title, description, keywords, scripts or links. Template traversal,
recovered HTML, decoded attributes, CRLF/astral source slices and native fallback
coverage remain required. Shared `sourceChunking` and `importResolution` producer
versions bind the new failure/admission behavior to replay identity.

The source-authored registry regression counts actual parse5 calls while retaining
the real parser, compares complete standalone projections and independent positive
facts, checks exact-source/profile negatives, mutation, release, cancellation and
failure ownership. Existing HTML regressions remain. Execution and representative
performance qualification are deferred; fewer source-level parse calls are not a
measured wall-time or memory improvement.
