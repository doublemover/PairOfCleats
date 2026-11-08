# XML schema reference identity

The bounded XML lexical parser resolves complete opening-tag namespace
declarations before projecting references. Declarations later in the same tag,
default element namespaces, nested rebinding and empty-element/sibling scope
follow [Namespaces in XML](https://www.w3.org/TR/xml-names/#scoping). Unprefixed
attributes have no namespace. Original UTF-16 name/value ranges remain intact;
unbound, ambiguous or unresolved reference names retain explicit observations.

For the XML Schema instance namespace, case-sensitive `schemaLocation` contains
namespace/location pairs; only locations are import candidates. The associated
namespace and its source span remain metadata. `noNamespaceSchemaLocation`
contains one location. Locations may be bare relative names. Odd lists,
multiple single-location values and unresolved entities cannot produce guessed
references, consistent with the
[XSD hint contract](https://www.w3.org/TR/xmlschema11-1/#schema-loc).

Namespace-qualified XSD include/import elements own one unqualified
`schemaLocation`, labeled `xsd-schema-location`. The existing config include/
import attribute heuristic remains available with the distinct
`xml-config-heuristic` role, including legacy prefixed config/project forms.
It does not qualify arbitrary application elements as XSD evidence. A preferred
`xsi` spelling without the instance namespace cannot supply a standard hint.

Scopes are bounded overlays on the existing parser stack, with capped prefix
memoization per opening tag. Completed sections and reference records retain
expanded names, not scope Maps. Existing character/token/node/depth/time limits
remain; namespace declarations, word projection and reference observations have
additional internal caps and deadline checks. No declarations/entities are
resolved, and no schemas, URLs, validators or projects execute or fetch data.

The collector charges dependency slots to admitted reference occurrences,
preserves parsed-literal identity and retains duplicate occurrence evidence.
Coverage and unsupported observations pass through registry/config relations
and the ordinary import scan. Partial evidence cannot publish a complete scan
fingerprint or qualify warm bundle reuse. The shared semantic importResolution
producer advances 14 to 15. Public CLI/configuration and graph format contracts
remain unchanged; lexical XML coverage remains explicitly partial rather than
claiming full XML/schema validation.

Authored, unrun checks include `xml-schema-reference-identity.test.js` and
`xml-schema-reference-replay.test.js`. They assert independently expected
locations, exact Unicode/source slices, prefix/namespace negatives, binding
order/scope, pair/single semantics, heuristic roles, one-slot budgets, cancellation,
registry/relations, named file graph endpoints and real incremental replay.
Original lexical/entity/declaration negatives remain. Old expectations that
`urn:real` or `urn:cfg` were file imports are corrected using the primary
namespace/location contract; original unbound input remains negative coverage.
Existing serial production-clock qualification remains pending for this head.
