# Embedded content and piecewise maps — 2026-10-27

**Unvalidated source:** `449159675248f07a8591a118b374d9544bb3ca82`, tree
`ee93cf241f686aae26724ce8ff82203c65be9b03`, branch
`codex/pr557-audit-repairs-20261012`. Windows x64, Node 26.12.1.
Local implementation checkpoint; not pushed or functionally qualified.

Follow-up source `1d4263e99e5f9a2966da644fa53b60ae6ed7f5d3`, tree
`a46628b19fe9d9c6e6e2573a0d9b66de26c5bc2d`, retains the content view and comment
origin through the actual `buildMetaV2` projection. Its typed origin schema and
cross-field checks prevent persistence from silently discarding the admitted map.
The existing 21 cases now also exercise the real metadata builder for comment
and JavaScript products. Source chunking/type normalization/VFS routing advance
to 37/14/6; the first checkpoint's original versions remain recorded below.
Static format/syntax/whitespace checks passed; all functional checks remain unrun.

## Repaired representation

#1652/#1654 shared the same defect: discovery/validation described logical
language content while downstream parsers reconstructed one broad raw host
interval. Wrapped Markdown retained quote/list/indentation prefixes; starred
comments retained interior decoration and independently trimmed YAML indentation.

The shared immutable content-view owner now records exact original UTF-16 pieces,
contiguous local coverage, broad container extent, source envelope, content hash
and known extraction policy. Ordinary adjacent pieces merge into the linear fast
path. The installed Micromark parser owns both fence routes, including delimiter
type/length and closing behavior. Comment config still requires a closing fence.
Comment prose policy remains separate; config strips recognized decoration or a
shared margin, preserving relative indentation and CRLF. Fences reference their
retained comment-view identity and broad original range.

Chunking, lexical/worker token input, segment relations, scheduler planning and
execution, VFS hashes/documents/targets and immutable semantic sources consume
that view. Whole-file comment stripping/line reuse cannot rewrite it. Segment
UIDs include the relative map/content/policy identity. VFS coalescing cannot merge
a transformed view, conflicting occurrence maps fail, and row trimming retains
required map extensions. Checksummed semantic sidecars add a strict version-two
piecewise variant without changing the version-one linear contract. Retained
compiler/LSP/cache checks compare actual source snapshots; ownership uses the
inverse map. Metadata schemas and semantic validators admit and check the tagged
JavaScript projection variant deliberately.

The owner bounds retained pieces to 256 and transformed content to 256 KiB.
Unsupported generated characters, policy/map mismatch or exhausted admission
retain explicit unavailable/partial diagnostics instead of parsing raw prefixes
and claiming exact mapping. This does not bound Micromark whole-document parser
memory/runtime. The parser module loads on demanded extraction; comments without
a possible fence do not enter that parser. Required dependency-load failures
remain errors.

Call-site extensions preserve exact pieces and content identity. The legacy
evaluation-owner contract survives only where its complete owner/call fits one
piece and therefore has a demonstrated constant offset. A cross-piece owner
retains syntax/semantic evidence but explicitly lacks that legacy invocation
join. Complete piecewise evaluation-owner semantics remain a follow-up rather
than an invented sourceOffset.

Producer versions: source chunking 36, comment policy 6, JavaScript relations 3,
type normalization 13, VFS routing 5, compiler bindings 27 and LSP bindings 54.
The [contract](../contracts/embedded-content-views.md) records representation,
bounds, mapping quality, unsupported transformations and consumer limits.

## Authored checks and remaining qualification

Twenty-one **unexecuted** `indexing/segments/embedded-content-views/*` cases use
actual comment-meta/discovery/chunking, VFS and worker-token-input owners. They
cover independently authored JSON/YAML/TOML content and key offsets, starred and
unstarred/HTML comments, plain/quote/list/indented/tilde/long fences, blank lines,
CRLF/Unicode, exact subpieces/inverse mapping, identity separation, malformed or
unclosed config, unavailable bounds, invalid policy/map/source/surrogates,
retained parent/local qualification and JavaScript metadata projection.

Static format/ESLint, changed JavaScript syntax, configuration budget and
whitespace checks passed. Shared-module analysis found zero cycles. Generated
configuration inventory was refreshed; command inventory generation produced no
changes. The staged whitespace check caught and removed a new-file trailing
blank line before commit.

No functional fixture, native parser, compiler/LSP, full index, benchmark or
publication front gate ran. Existing frontmatter, segment/cache isolation,
semantic map/cache/source authority, VFS coordinate and JavaScript replay
controls remain intact and require affected current-candidate rechecks. Actual
scheduler/native parsing, persisted warm relocation and published source-qualified
navigation also remain unqualified. Both issues stay open pending complete
original/follow-up acceptance; this receipt is implementation evidence only.
