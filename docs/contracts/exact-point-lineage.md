# Supplied exact-point lineage pilot

`admitExactPointLineage` owns copied supplied artifact bytes and normalized point
receipts. Its private identity includes exact byte hashes, artifact/build IDs,
coordinate profiles, world, ordered transformation identities and all mapping atoms.
It performs no compiler execution, file/URL resolution or debug-expression evaluation.
This is an internal pilot, not a canonical public mapping schema or an LLVM,
MLIR, JVM or ECMA-426 decoder. Decoder qualification remains separate work.

Each point uses an explicit UTF-16 offset into strictly decoded UTF-8 or a binary
byte offset. UTF-16 points cannot split a surrogate pair; CRLF and BOM are retained.
An output-to-input atom retains its relation kind, inline context and provenance.
`complete-declared-points` closes only the producer's declared point inventory.
Neither sparse anchors nor that label closes neighboring offsets or source behavior.

`mapExactLineagePoint` joins complete intermediate point identities. It shares
nodes while keeping each contributing edge, including parallel edges with distinct
inline contexts. An explanation must traverse these correlated edges rather than
independently cross-producting projected contexts and coordinates. All target
artifacts reached are retained. Reverse lookup uses the same admitted relation.
The API does not interpolate offsets or turn point correspondence into operation
equivalence. Individual edge kinds remain visible; a heuristic edge never receives
an exact composite certificate. Cycles, explicit unmapped points, missing anchors,
work limits, node limits and cancellation produce residuals. A complete traversal
means only the demanded finite admitted point graph was traversed.

`inspectSuppliedObservationLineage` consumes this owner without allocating observed
mass to alternatives: one sample remains one sample with its mass unallocated.
It is a mapping-evidence inspection view. Existing runtime code-lifetime and source
authority admission must precede a future runtime join; the pilot cannot produce
`verified-coordinate` targets or bypass `runtime/source-authority.js`.

Admission caps artifacts/transformations at 256 and atoms at 16384. Metadata has
a conservative pre-serialization byte allowance plus depth/node bounds. Supplied
artifact byte copies have a separate allowance of the same configured size.
These allowances do not claim to measure JavaScript heap: decoded UTF-16 strings,
indexes, caller inputs and preparation costs are additional. Query `maxWork`
counts examined mapping atoms, not serialization, index creation, cycle detection
or elapsed CPU. Query nodes are capped; cycle detection is linear in retained
query nodes/edges. Private owned bytes live with the opaque handle and are released
by ordinary garbage collection; no durable lease/cursor or spill contract is offered.

Authored regression source covers a hand-enumerated two-stage relation, reverse
mapping, ambiguity and mass conservation, parallel paths versus cycles, sparse
gaps, explicit unmapped points, stale worlds/hashes, astral offsets, cancellation,
budgets, accessor rejection and immutable ownership. It has not been executed.
Canonical publication, source-authority joins, compiler parsing/SSA semantics,
source-map decoding, lifetime joins, spill/reload and measured qualification remain
open obligations of issue #1515.
