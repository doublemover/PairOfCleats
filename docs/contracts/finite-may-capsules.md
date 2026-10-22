# Finite may-set capsule checker

Unvalidated first slice of #1510. An admitted transfer system is distinct from an
untrusted capsule. The system fixes world/provider/configuration, finite fact and
node universes, entry seeds, every transfer edge, and extraction/boundary closure.
The full-state capsule supplies one finite invariant per node. Identity checks
precede semantic checks and cannot replace them.

The checker independently verifies initial-state inclusion and every transfer
obligation, including backedges. Supported transfers are identity, finite gen/kill
and explicit unknown-effect (top). A pending producer or boundary prevents a
global acceptance receipt. Cancellation and work/byte limits yield unknown.
Accepted invariants are post-fixpoints in this declared model; top is legal and
possibly uselessly imprecise. Least-fixed-point precision and source-language
soundness are not implied.

`src/semantic/checked-may-summary.js` is the read-only consumer seam. It exposes
accepted states only after this checker succeeds; partial/stale/rejected states
remain unavailable as checked evidence. No provider runs and no facts publish.
The first independently failed obligation is a definitive rejection, with one
bounded missing-fact counterexample. Acceptance still checks every obligation;
checker budget exhaustion cannot erase an already established rejection.

`src/semantic/retained-may-summary.js` now projects an owned finite relation from
selected canonical records and their actual indexed outgoing flow edges in one
pinned artifact store. It verifies retained source identity and UTF-16 coordinates,
keeps context/condition/certainty evidence, and uses exact selected seeds as entry
facts. Call transitions and arbitrary transfers are outside this relation adapter.
Source captures, incident rows and retained metadata have separate bounds. An
unscanned row prefix or an outgoing selected-kind edge leaving the node selection
keeps the authoritative system open, so no capsule supplies accepted facts.

The read-only retained consumer supplies that owned system to the existing
independent checker; a cloned or caller-forged projection is not admitted. Checked
states refer to entry seeds in this declared canonical relation only. Producer
certainty, source-language transfer correctness, extraction coverage and path
feasibility are not upgraded. Conditions are retained but not discharged, and a
post-fixpoint may remain strictly larger than least reachability. There is no
negative whole-source claim, edit authority or durable proof store. The actual
writer/index/store/checker fixture is authored and unexecuted.

Canonical public schema/report ingestion, real frontend transfer admission,
atomic sink integration, compact cutpoint reconstruction, dependent capsules,
cross-revision reuse, constructor projection, benchmarks and qualification remain
outstanding. The exhaustive tiny finite-path mutation fixture is authored only;
it has not been executed. Input allowances cover encoded state and bounded
cardinalities, not a measured process-heap bound or a producer cost claim.
