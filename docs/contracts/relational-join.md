# Finite relational join cohorts

The internal relational view owner composes two original adjacency views from
`views/adjacency-delta.js`. It implements a bounded inner join on left.to =
right.from and a left anti-join under that same key. This is another finite
nonrecursive operator for #1516; source extraction, general query planning,
elastic cost selection, spill and shared generation publication remain separate.

The definition schema is `src/contracts/schemas/relational-join.js`. Both input
handles must be original, immutable and in the exact same world, with the declared
left/right domains. A copied handle or serialized report cannot become an input.
The existing adjacency owner supplies immutable support rows; composing the view
never expands occurrence multiplicities into individual copies.

Inner-join rows retain every matching original support pair. Their arbitrary
precision coefficient is the product of the input coefficients. Distinct
derivations of one endpoint pair remain distinct rows. Parent identity includes
occurrence/support, endpoints and supplied source-reference payload; coefficients
can change without replacing the same parent identity. The report retains those
parents. Source references remain supplied metadata, not checked source authority.

For anti-join, any positive right support blocks the left key. Removing one of two
right supports cannot expose it; removing the last can. A missing key on incomplete
right input is unknown, never negative evidence. Such left supports are withheld
and counted as unresolved. Captured positive join pairs remain usable with an
incomplete domain. Output completeness always requires both captured input domains
to be complete; it does not establish source or semantic closure.

A delta captures the outer batch identity/base and both complete inner batches
before consulting cancellation. Both destination worlds must agree. Original
adjacency transitions, resulting arrangement and full result admission all finish
before a new private cohort is returned. A failure in the second input or result
does not advance the first input in the old cohort. Identical outer replay is a
no-op; changed content under the same ID and stale/mixed worlds are rejected.
The outer ledger holds at most 128 batches before requiring a checkpoint.

The baseline strategy is full affected-view recomputation with a right-key
arrangement, not delta-sized maintenance or a demonstrated speedup. Defaults bound
total input supports to 256, output supports to 1,024, the serialized result/ledger
to 1 MiB and join work to 65,536 units. Each original input transition additionally
uses the existing work admission bounded by four times the input-support allowance.
Allowances may only be tightened. Coefficients retain the occurrence owner's
128-digit limit. A budget stop returns the original cohort unconsumed, or refuses
bootstrap; no capped result is published as exact. These are serialized/work
bounds, not total process heap or elapsed-time measurements.

Six authored, locally unrun cases cover simultaneous two-input changes, independent
tiny-bag expansion, original parent multiplicity, anti-join 2→1→0→1 boundaries,
partial-domain unknowns, stale/replayed/mixed batches, second-input failure,
resource bounds, cancellation and values above Number's exact integer range.
New views remain private/unpublished. Existing publication/recovery owners must
admit a future durable integration; this module adds no generation pointer or
indexed semantic producer identity.
