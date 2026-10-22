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

Canonical public schema/report ingestion, real frontend transfer admission,
atomic sink integration, compact cutpoint reconstruction, dependent capsules,
cross-revision reuse, constructor projection, benchmarks and qualification remain
outstanding. The exhaustive tiny finite-path mutation fixture is authored only;
it has not been executed. Input allowances cover encoded state and bounded
cardinalities, not a measured process-heap bound or a producer cost claim.
