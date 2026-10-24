# Checked occurrence-bag sum normalization pilot

The internal `equivalence/occurrence-sums.js` owner implements one bounded ground
query algebra over the existing occurrence relation provider. Its only terms
are bound inputs and sums. Every input must have the same pinned world, schema
and original atom roles. The observation contract is the multiset of tuples and
original occurrence/support/copy identities. It explicitly excludes enumeration
order, ranking/scores and physical sum-choice explanation paths.

The candidate generator flattens and sorts sum operands, preserving duplicates.
An independent recursive checker counts each input role on both sides under the
registered positive-natural bag associativity/commutativity rule. Its trusted
premise is that algebraic law, not a hash or the generator's output. Set
idempotence is unavailable: `sum(R,R)` retains twice the occurrences. Unknown
operators, effects, arbitrary callbacks, ordering and contextual assumptions have
no implicit laws. Budget/cancellation returns unknown; failed proofs are rejected.

Request identity pins input roots, full observation contract, world, operands
and rule version. A successful checker mints an opaque receipt. The consumer
`executeOccurrenceSumRequest` uses the actual #1513 sum owner and admits an
alternative only with the same owned request/receipt; copied/forged receipt data
does not confer authority. Without a receipt the original plan remains executable.
This is a useful direct substitution seam, not an e-graph or parallel optimizer.

The retained semantic motif projection now consumes this seam. Its selected
incident-edge groups become occurrence bags over canonical endpoints, kind,
evidence ID and original support/source identity. The motif adjacency observation
is explicitly unranked and does not observe factor-choice paths. Before choosing
the normalized sum it runs the independent checker and uses the matching owned
receipt; an unsuccessful check retains the original grouping. The bounded cursor
then materializes the same canonical witnesses for the existing motif checker
and source lens. Full witness expansion remains linear and is not a speedup claim.

`describeOccurrenceRelation` is a new read-only ownership-checked projection in
the existing relation module so consumers can check world/schema/role meaning.
It does not publish a new semantic family. Returned derived-choice paths remain
available from relation cursors but are not equated by this narrower contract.
Consumers observing those paths or result order cannot accept this certificate.

Input maps are capped at 128 relations, each term at 128 leaf occurrences,
2048 nodes and depth 16. The checker separately bounds node visits. These are
small private retained query islands; no durable proofs, native source equality,
recursive convergence, global closure or runtime speedup is claimed.

Authored unexecuted fixtures compare original/checked execution under the actual
observation projection, with an independent multiplicity oracle, duplicates,
null values, forged rule/endpoints/receipts, stale worlds, cancellation and
ordered/effectful rejection. Selection/projection/join rules, canonical transport,
conditional proof grammar, native source adapters, persisted revocation and
measured usefulness remain open #1521 obligations.
