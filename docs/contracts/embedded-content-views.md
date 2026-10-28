# Embedded parser content and source pieces

Markdown and comment config fences retain a version-one `source-pieces` content
view. Container bounds include the host framing. Source bounds are the envelope
of the actual content pieces. Local offsets describe the logical parser input.
Every piece is an ordered, unchanged, half-open UTF-16 source interval; local
coverage is contiguous. Removed quote/list/comment prefixes remain gaps in
original source coordinates. The envelope never claims to be a linear map.

The view retains one SHA-256 content hash, its extraction policy and at most 256
pieces. Adjacent pieces merge. Transformed content is bounded to 256 KiB before
publication; a contiguous view keeps the existing linear path. The product holds
no full parent copy or native parser handle. Readers revalidate the original
pieces, content hash, bounds, policy and surrogate boundaries. Unknown policies,
changed bytes, map gaps, unsupported generated characters and exhausted bounds
cannot acquire an exact view. Discovery retains an explicit unavailable reason;
the file processor reports bounded partial content admission instead of parsing
the old raw host interval. These are logical product bounds, not a claim about
Micromark's whole-document parser memory or a synchronous runtime deadline.

The installed Markdown parser owns fence type, delimiter length, closing rules,
container indentation and token boundaries for both producers. Exact source
pieces preserve real CRLF and Unicode; they do not manufacture spaces for a
partial tab expansion or replace NUL. Markdown retains its parser's unclosed
fence behavior. Config extraction from comments additionally requires an observed
closing fence, preserving its invalid/unclosed negative contract.

Comment config content has a separate policy from prose cleanup. It removes
actual comment delimiters, recognized leading star decoration and one optional
space. Unstarred lines lose only their shared indentation margin. Relative YAML
indentation and remaining line endings survive. The broad original comment
range remains available for prose/reference consumers. The exact composed view
used for config validation is also used by the downstream language chunker;
comment candidate/count/byte/line and aggregate parser limits still apply.

Segment identity includes logical content, extraction policy and relative source
piece layout. Chunking, token input, local relations, scheduler plans/execution,
VFS document hashes/targets and immutable semantic sources use the same view.
Container comment stripping and whole-file line-token reuse cannot alter that
logical input. Transformed documents do not coalesce with adjacent segments.
VFS manifests retain the map under `extensions.embeddedContent`; row trimming
cannot remove it while keeping the row. Conflicting maps for one occurrence are
rejected. Existing format versions and authority rules are otherwise unchanged.

Retained semantic maps deliberately add a strict version-two
`embedded-piecewise-range` variant. Version-one `embedded-linear-range` remains
unchanged; unknown versions/kinds still fail. Writers persist the canonical
checksummed map once. Common compiler/LSP/cache readers verify the actual pinned
parent and local snapshots. Ownership joins use the inverse piece mapping rather
than subtracting one offset. Parent/container envelopes remain navigation
extents; exact subranges retain their ordered original pieces.

JavaScript declaration projections add a tagged version-two source-mapping
variant. Parameter/documentation ranges and call-site envelopes use the shared
mapper. Call-site extensions retain their exact pieces and content identity.
The version-one evaluation-owner contract still requires a single constant
offset: it survives only when the complete owner and call fit one source piece.
A cross-piece owner is explicitly unavailable for that legacy invocation join;
the retained piecewise syntax/semantic facts remain available. This does not
claim complete framework binding or runtime invocation semantics.

Shared producer identities change with this meaning: source chunking 36,
comment extraction/classification 6, JavaScript relations 3, type normalization
13, VFS routing 5, compiler bindings 27 and LSP bindings 54. Existing strict
canonical map checks, cache isolation and immutable metadata behavior remain.

The 21 `indexing/segments/embedded-content-views/*` cases are **authored and
unexecuted**. They cover actual comment-meta/discovery/chunking and VFS/token
handoffs, independent JSON/YAML/TOML content/key expectations, wrapper variants,
CRLF/Unicode, invalid maps/policies/config, exact retained parent qualification
and JavaScript projection. Scheduler/native parsing, persisted warm relocation,
published navigation and current-head functional acceptance remain unqualified.
