# Compiler element-reference key ordering

Element reference construction evaluates its receiver and key expression.
Conversion belongs to reference consumption: simple assignment converts at
PutValue after its RHS; compound assignment consumes and converts through
GetValue before the RHS, then reuses that property key. The CFG represents
conversion as a distinct internal `propertyKey` event. The same
reference path covers ordinary reads, simple/compound assignments, updates and
delete. Optional-chain guards skip the key expression and conversion together.

The ordering follows the official [reference-construction algorithm](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-evaluate-property-access-with-expression-key)
and [GetValue/PutValue operations](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-getvalue).

Known literal primitive keys do not add a coercion exception. Other keys retain
a potentially throwing conversion route, with modeled key-input exception
provenance. A conversion event cannot repeat a recognized ordered-storage call
or masquerade as a resolved getter/setter invocation. It is not a value-flow edge
from the property key to the selected stored value.

Arbitrary coercion hooks and their heap mutations remain explicitly incomplete
under `property_key_coercion_effects_unresolved`; this is ordering and exceptional
reachability, not whole-language hook or alias completeness. Actual compiler CFG,
optional-chain and retained reaching-definition controls are authored but
UNVALIDATED during the development-first wave.
