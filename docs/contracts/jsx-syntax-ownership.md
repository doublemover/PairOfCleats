# JSX and TSX syntax ownership

JSX and TSX use one complete canonical JavaScript/TypeScript source segment.
The markup, expressions, callbacks and enclosing declarations share that syntax
owner. Discovery does not parse a second tree or partition the program into
HTML and incomplete prefix/suffix programs. Existing language-owned chunking
preparations and their original source coordinates remain available to chunking,
relations and declaration projection. Canonical JSX/TSX bypasses CDC partitioning;
normal chunk-size limits still apply and may explicitly limit declaration flow.

The actual container extension remains `.jsx` or `.tsx` in canonical chunking
and VFS routing, even when its broad language identity is JavaScript or
TypeScript. Embedded views still select their own dialect. Independently sliced
extra/comment/fence segments retain cache isolation, separate identities and
existing range validation; a full-file AST is never attached to their slice.

Canonical chunks own symbol/call facts and tooling targets. Their exact source
ranges, declaration occurrences and source-qualified navigation remain subject
to the existing semantic/quality contracts. Malformed source retains existing
coarse fallback and unavailable parser evidence; this policy creates no syntax
or semantic authority for it. The whole-file immutable semantic collector remains
an independent producer; this repair concerns chunk/tooling projections.

No separate markup projection is currently emitted for component files. JSX
text remains in the canonical declaration/source view. A future optional markup
detail/retrieval view must be explicitly secondary and overlapping, retain its
original span plus canonical declaration/occurrence parent, and define deduplication
before admission. It must not claim HTML equivalence, replace canonical expression
ownership, duplicate semantic facts, or upgrade a coarse/synthetic source map.
Actual HTML and framework-owned Vue/Svelte/Astro routes retain their own policies.

Source chunking, normalization, VFS routing and compiler/LSP binding versions
advance through the shared semantic producer owner so fragment-derived reuse
cannot silently preserve the previous meaning. Boundary/declaration, expression
ownership, source-slice, cache-isolation, dialect, parser-count and VFS controls
are authored under `indexing/segments/jsx-syntax-ownership/*`; execution remains
pending at this source checkpoint.
