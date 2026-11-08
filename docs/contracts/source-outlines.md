# RST and AsciiDoc source outlines

RST and AsciiDoc chunkers project a bounded, parse-only top-level heading subset
over one original JavaScript source string. They do not render, evaluate
directives, execute includes/macros/extensions or fetch external documents.

RST admission keeps indentation, explicit-markup and literal ownership before
examining punctuation adornments. A matching overline/title/underline has one
heading envelope; its exact title span remains separate. Underline and combined
adornment styles have distinct observed style levels. ASCII title geometry is
qualified by the right edge, including optional overline-title inset. Non-ASCII,
wide, combining, tab/control and otherwise ambiguous title widths retain an
explicit partial result; UTF-16 length is never substituted for visual width.
Directive/indented/quoted-literal bodies do not create a main-document outline.
See the [Docutils section contract](https://docutils.sourceforge.io/docs/ref/rst/restructuredtext.html#sections)
and [literal block rules](https://docutils.sourceforge.io/docs/ref/rst/restructuredtext.html#literal-blocks).

AsciiDoc admission tracks exact delimiter character sequences/lengths and
opaque versus compound containers. Nested non-section blocks never admit
ordinary sections; verbatim/raw/comment content does not change nesting.
List continuations and unfenced styled paragraphs retain their containing
ownership. Unsupported extension styles, substituted block boundaries and
preprocessor behavior remain partial; unknown custom block boundaries stop
outline projection instead of guessing subsequent section scope. Authored
anchors stay separate from occurrence identity and only attach to the next
admitted heading when no intervening body has consumed them. See
[delimited blocks](https://docs.asciidoctor.org/asciidoc/latest/blocks/delimited/)
and [section titles](https://docs.asciidoctor.org/asciidoc/latest/sections/titles-and-levels/).

`meta.heading` distinguishes occurrence ID, authored display title, title range,
heading source envelope, observed style/level, parent ID/context and optional
authored anchor. Repeated titles retain distinct identities. Ranges are UTF-16
offsets in the supplied source snapshot, including CRLF. They are not renderer
nodes or external-document bindings. Unsupported prior candidates leave later
ancestry explicitly unqualified.

`outlineCoverage` declares the syntax subset, producer version, admitted source
and scanned extents, bounded work/heading/depth/line/source limits, reasons and
samples. Unknown omitted headings stay null. Source/line admission happens
before building an unbounded line/match array; incomplete final lines never
become syntax observations. An oversized line stops projection because its
unexamined block boundary could change all later heading ownership. An admitted
prefix has its own hash; a full text hash is unavailable beyond source admission.

Chunks partition the entire original source, including preambles, ignored
literal/comment content and the unscanned tail. A conservative source-only chunk
is separate from an admitted heading. Ordinary chunk line/byte limits retain
their existing independent owner. `metaV2.sourceOutline` is the single persisted
receipt; transient assembly input is not duplicated in incremental payloads.
Metadata validation checks source/title ranges, work admission and occurrence
identity. Shared `sourceOutline 1` fences semantic and prose/extracted-prose parse
reuse. There is no new public option or dependency.

Regression ownership is
`tests/indexing/chunking/formats/rst-asciidoc-source-outline.test.js`, which uses
independent exact occurrence/range/parent oracles through direct, smartChunk and
segment paths. The existing format-fidelity fixture also checks persisted names
and title ranges for real negative/alternate-heading inputs. Execution status is
recorded separately in the implementation receipt.
