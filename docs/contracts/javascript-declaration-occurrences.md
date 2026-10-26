# Lightweight JavaScript declaration ownership

`javascriptRelations` version 1 replaces name-keyed callable accumulation in the
lightweight Babel/Acorn/Esprima relation path. It does not replace the semantic
collector, compiler CFG or their stronger binding/value-flow contracts.

`jsDeclarations` is a source/parser-qualified, per-source catalog. A declaration
occurrence binds exact UTF-16 range, AST/declaration role and producer identity to
the retained source snapshot and actual parser family/version. It is not a
runtime closure/heap identity or a global symbol name. Static/instance roles,
getters/setters, class expressions, field initializers and lexical parents stay
distinct. External display/binding names and internal function names are separate.

Explicit checked AST wrapper associations connect a variable/assignment/member
envelope to its callable. Native declaration ranges and retained declaration
references can use the same range index. Name equality and generic containment
cannot establish an association. Ambiguous legacy display aliases are excluded
from the compatibility map; admitted occurrences remain in the catalog.
Record/alias, queue, traversal and parameter-expression limits retain partial
reasons; unknown omitted declaration counts stay null.

Raw lightweight `calls` use occurrence IDs as caller keys under
`javascript-declaration-occurrences-v1`. This internal protocol keeps the pair
budget bound to its actual owner. The public chunk projection uses those IDs,
then emits the existing display-pair shape. Call details retain occurrence IDs,
source spans and evaluation phases. Stale indexes cannot restore replaced/capped
arrays. No unbudgeted declaration copy reconstructs discarded call channels.

Small parse-shape descriptors distinguish invocation bodies, conditional
parameter initialization, surrounding definition evaluation, module evaluation,
instance-field initialization and static initialization. Computed keys and class
heritage stay with surrounding evaluation; method/callback bodies keep their own
invocation owners. Binding identifiers do not become value reads. These are
potential syntax observations within an owner's phase, not resolved call targets,
eager execution or an additional CFG. The phase distinction follows ECMAScript
[parameter initialization](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-functiondeclarationinstantiation)
and [class definition evaluation](https://tc39.es/ecma262/multipage/ecmascript-language-functions-and-classes.html#sec-runtime-semantics-classdefinitionevaluation).
Unsupported decorator/parameter/traversal shapes remain explicit.

Async/generator/method modifiers remain declaration facts. Yield syntax is
separate from generator kind. `returnsValue` means an authored return argument
or concise arrow expression; a bare return is only an explicit control count.
`return undefined` has value-return syntax without promising a non-undefined
result. `controlFlow.returns` and `implicitReturns` remain separate. None proves
all-path completion or reachability. Disabled/unavailable/incomplete analysis
cannot publish a verified false; retained positive partial observations remain
qualified to their actual scope.

Docmeta and metadata v2 retain `javascriptDeclaration`, including original owner,
projection and segment-to-container mapping. Flow uses the existing per-field
`flowEvidence` contract. Source fragments retain declaration parameters/modifiers
but cannot borrow a full declaration aggregate as local flow. Qualified declarations absent from chunker output retain explicit supplemental
owners. Module and class-initialization projections keep their source occurrence
owners even inside a declaration envelope; invocation bodies remain separate.
Legacy geometric module gaps still reject overlaps. Replayed projections are
idempotent.
Embedded JavaScript is parsed once per segment, verified against its container
slice, then projects call, literal/argument and returned-value ranges through an
explicit offset. Declaration occurrence identities keep their original snapshot.

File relations retain the catalog; per-chunk metadata does not duplicate it.
Canonical call sites retain `extensions.javascriptEvaluation`. Ordinary code
parse and semantic reuse include the shared producer version. Existing parsed
AST/context products are reused; no per-chunk parse or native handle cloning is
needed. Literal/argument and returned-call evidence keep their existing stricter
owners. No public CLI/config option or artifact-format relaxation is introduced.
