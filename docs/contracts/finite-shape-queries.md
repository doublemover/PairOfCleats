# Qualified finite type query profiles

The internal `types/finite-shapes.js` pilot represents subsets of a declared
finite immutable value universe. Atoms, closed records and tuples are supported.
Missing record labels mean absent; a present `undefined` atom is a different
value. Whole-record alternatives stay correlated. This universe is not the set
of all JavaScript/TypeScript values. Mutable locations, native nominal classes,
functions, effects, open rows, recursion and `any` have no implicit lowering.

An arena pins exact generation, repository, provider, language and context.
Normalized values and type masks are interned immutably. Union, intersection and
complement operate within that one universe; complement never ranges over a
different model. Cross-arena queries reject even when display names coincide.
Explicit unsupported alternatives propagate unknown rather than bottom.

Inclusion, equivalence and disjointness enumerate the finite universe under a
work/cancellation allowance. Refutations retain a concrete value and its checked
membership in both operands. Proved results require complete enumeration.
Projection retains each complete record alternative with explicit field presence.
Positive and negative existential preimages are computed independently over the
supplied relation and can overlap. Incomplete relation coverage remains unknown;
divergence is not modeled and a may-preimage is never complemented into a must fact.

The `semantic/type-query.js` consumer exposes compact compatibility/counterexample
detail and separately adapts the existing finite-string arena/query engine.
Finite-string membership/cardinality reuse the existing bounded algorithms and
required-computation errors; resource exhaustion/cancellation becomes unknown.
Neither profile parses compiler display strings or claims native assignability.
No existing compiler producer meaning changes, so no producer version bump is
introduced by this opt-in consumer.

Finite-shape admission caps 512 universe values, 16384 nested shape nodes,
depth 16 and 64 record fields/tuple elements. Encoded universe plus conservative
handle charges share a default 1 MiB allowance; handles are capped at 4096.
This is logical retained accounting, not heap/RSS. Query work counts finite
value/edge visits and does not include normalization, hashing or rendering.
An interrupted query has no persisted continuation in this pilot.

Authored unexecuted tests compare all pairs of subsets of a five-value universe
with an independent finite-set oracle. They cover correlated records, absence
versus undefined, overlapping positive/negative preimages, unknowns, stale contexts,
cancellation and the real finite-string consumer. Canonical handles/publication,
provider source evidence and semantic-detail transport integration, patterns,
native compiler oracles, effects/refinement, recursive profiles and measured
qualification remain open #1520 obligations.
