# Callable parameter authority

`src/contracts/callable-parameters.js` owns the version-1 compact parameter
contract. The current producers are successful TypeScript compiler and Babel
chunk routes. They project existing file-scoped AST nodes; no extra source parse,
project execution or retained AST cache is introduced.

Each callable distinguishes declaration, signature and body ranges from its
bounded display signature. Ordered slots retain declaration/runtime ordinals,
receiver/runtime role, binding pattern, optional/default/rest status, source
ranges and annotation presence. Destructuring remains one slot; it does not
invent flattened formal names. An explicit TypeScript `this` slot is a receiver,
consistent with the [TypeScript function contract](https://www.typescriptlang.org/docs/handbook/2/functions.html#declaring-this-in-a-function).
Function-type arrows are annotation syntax, not default assignments.

Slot retention is capped at 256 and annotation/name text at 4,096 UTF-16 units.
Original formal/runtime counts and justified minimum/maximum arity are separate
from retained display metadata. A missing annotation, unavailable annotation,
truncated display and omitted slot tail remain distinct. Required trailing
positions determine minimum arity; a rest slot leaves the maximum open. Parser
recovery or unsupported formal roles cannot qualify exact arity. Return
annotations, modifiers, decorators and constructor/accessor roles come from nodes.

Compiler/Babel success no longer merges parameter/type/return guesses from
display text. Known empty lists/maps and absent annotations survive doc
projection, enrichment and payload assembly without fallback reinterpretation.
Safe own-key type maps preserve names such as `__proto__`. Legacy/heuristic
routes retain their separate text behavior without this authoritative receipt;
the fallback assignment scanner now distinguishes `=>` from `=`.

Bodyless signatures use the actual declaration end, including multiline
overloads; a neighboring declaration cannot extend the first signature. Display
text stays bounded while the original full source range remains available.
SourceChunking advances 18 to 19 and typeNormalization 8 to 9 for changed
persisted metadata. Semantic compiler/provider identities are otherwise unchanged.

Authored, unrun tests cover both real parser routes and registered extraction,
enrichment and JSON payload boundaries, with exact callback/object/function
annotations, decorator changes, receiver/default/optional/pattern slots,
constructors, overload identity, same-line neighbors, known-empty fields,
recovery qualification and 300-slot counts. Existing structural operand tests
remain. API symbol-row/report consumption (#1709) and qualified actual/formal
argument/type/risk handoffs (#1678) remain separate pending implementation;
this producer receipt alone does not close those consumer defects.
