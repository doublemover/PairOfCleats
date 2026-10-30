# JavaScript documentation metadata

Implementation and fixtures are **unvalidated**. This contract describes source
behavior; no parser/consumer or performance qualification is established here.

JavaScript uses its already prepared Babel, Acorn or Esprima source AST to
associate documentation with a declaration or its explicit variable/member/
export wrapper. Parser admission privately captures immutable comment ranges.
Later mutation of public AST comments cannot turn a string/template into docs.
An associated JSDoc block must precede the exact anchor with only whitespace and
the parser-proven wrapper's declaration keywords between them. Intervening
statements or ordinary comments fence association. A comment inside a callable
body does not describe the enclosing callable.

The declaration catalog stores immutable parsed documentation once per block,
including comments preceding the function chunk. A caller without prepared
relations uses the same source parser under a bounded traversal and requires an
unambiguous declaration spanning the chunk plus trivia. Missing/unqualified
syntax does not justify regex extraction from arbitrary source text.

`@es-joy/jsdoccomment.parseComment` parses actual JSDoc blocks; the already locked
`jsdoc-type-pratt-parser` validates types with the **`jsdoc` dialect**. The adapter
retains the parsed original type text, including nested record braces, generic/
union syntax and rest modifiers. It does not stringify a normalized type AST or
silently retry another dialect. Unsupported or malformed annotations are
explicitly malformed hints, independently of source-language syntax authority.
Required-library load errors remain setup errors, not malformed documentation.
Libraries load lazily only for an admitted documentation block/type.

The returned `documentation` object has schema version 1, `authority:
"documentation"`, dialect, state, source range, parameter hints, return hint and
bounded problem codes. A parameter retains its name, original type text,
optional/default and rest flags; dotted names stay distinct. The source range
uses JavaScript string offsets and is rebased to the container for embedded
segments. The states are:

- `parsed`: valid documentation, including valid empty metadata.
- `absent`: no associated JSDoc block.
- `malformed`: comment/tag/type parsing failed; raw display text remains, while
  unqualified parameter/return hints are withheld.
- `unavailable`: source identity or bounded comment/traversal admission failed.

The existing top-level `doc` remains capped at 300 characters and now preserves
the actual associated block text. Legacy `paramTypes`, `returnType` and `returns`
use valid documentation hints where syntax supplies no stronger value. Explicit
AST parameter/name arrays, including empty arrays, signatures, parameter defaults
and return/type metadata retain precedence. Documented defaults remain labelled
hints; they do not fabricate executable default expressions or runtime behavior.
Flow facts and their source/scope authority remain independent.

Bounds are private: 20,000 parser comments; 64 KiB UTF-8 per admitted block;
1 MiB aggregate parsed block bytes per file; 128 tags per block; 8,192 characters
and 64 delimiter levels per type. Standalone fallback admits at most 1 MiB of
source characters, 250,000 traversal steps and 50,000 queued nodes. Budgets are
checked before oversized copies or parser dispatch where possible. The native
chunk/AST and existing language-parser limits still apply separately.

JavaScript relation producer version **2** invalidates derived replay and
declaration identities after this metadata meaning change. No grammar, parser
version, Node pin, dependency, public knob or artifact format was changed.

The 21 authored `lang/javascript/jsdoc-comment-ownership/*` cases retain positive
optional/default/rest/dotted/record/generic/union/return assertions, literal and
unrelated-comment negatives, leading comments outside chunks, valid-empty versus
malformed/unavailable states, bounds, all three source parsers, actual artifact
assembly, AST precedence, embedded offsets, prototype-like names and immutable
parser comment ownership. They have not run. Existing declaration/flow/replay,
language contract and import-budget checks remain required.
