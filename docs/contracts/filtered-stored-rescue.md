# Filtered stored-vector rescue pilot

Unvalidated first slice of #1514. The opt-in session accepts a pinned immutable
index lease, explicit complete eligible row/source-incarnation map and the
existing stored-dot scalar target. A single optional candidate probe is followed
by deterministic eligible scan slices using the actual `rankDenseVectors`
backend. Probe scores are ignored; exact stored scores are cached and reused.

Nonempty results remain provisional until the complete eligible set is scored.
Native failure is recorded while exact rescue may continue. Missing authoritative
row scores fail explicitly. Cancellation pauses the same-owner cursor. Native
frontier reuse, original-vector exactness and semantic closure are not claimed.
Result ties use source-incarnation code-unit order. Index/vector bytes remain
under the caller's lease; construction transfers release ownership only on success.

The first slice copies a bounded eligible map and retains its score cache in
memory. Native hooks, widening reserves, semantic unknown eligibility, spill,
durable continuations, canonical public integration, physical metrics, policy
calibration and benchmarks remain open. The fixture consumes the real scalar
backend but has not been executed under the development-first instruction.
