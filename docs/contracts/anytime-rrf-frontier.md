# Internal anytime RRF frontier

Development slice for #1504; unvalidated. This is an opt-in internal API, with no
change to default finite-array retrieval or public request/response schemas.

`src/retrieval/sessions/rrf-frontier.js` admits a fixed weighted RRF target,
source-incarnation result unit, complete confirmed eligibility, after-filter
ranks and code-unit ID ties. Identity includes repository, generation, query,
eligible universe, semantic world/spec/receipt and each channel representation.
`binary64-channel-order-v1` fixes the numeric oracle: compute each
`weight / (k + rank)` with JavaScript binary64 arithmetic, then add contributions
in the frozen channel-array order. Bounds and ties refer to that computation,
not an exact-real sum or a reassociated native kernel. Admission allows at most
32 channels, 4 KiB per identity and 64 KiB serialized target before cloning.
Upstream adapters must attest complete ordered prefixes; finite ANN batches
cannot supply this capability. The reducer cannot independently prove an
external adapter's completeness declaration.

Each atomic prefix narrows candidate and unseen bounds. Certified order remains
separate from a point score; all certificates apply before boosts/diversity.
Unknown unseen IDs block equality certification. Zero-support entries are not
emitted. Failed channels never become exhausted. Capacity rejection leaves the
input prefix unconsumed. The allowance measures serialized retained candidate
state conservatively, not total process heap or upstream list memory.

`complete-list.js` consumes the reducer through a deterministic round-robin
adapter over copied, explicitly admitted complete lists. Work/page sizes affect
progress only. A continuation is opaque and valid only for the same live owner
and immutable target. Cancellation pauses without emitting or deleting state;
explicit close releases the supplied lease callback once and clears candidates.
The caller must close the session, including when only an early page is wanted.
Lease ownership transfers only on successful construction; a rejected input
leaves it with the caller. A separate `maxListBytes` allowance covers copied IDs
plus per-entry accounting, with preparation input-row/byte counters in receipts.
The caller's original lists and VM allocation overhead are outside both serialized
allowances. No constant-memory or total-heap bound is claimed for this pilot.

Remaining #1504 obligations include native sparse/vector ordered cursors,
outward-rounded vector bounds, three-valued semantic refinement, rank-before-
filter support, heap/spill execution, durable checkpoint recovery, federation,
public surfaces, independent runtime qualification and measured comparisons.
No exactness, performance or release acceptance has been established by running
the authored fixture. Existing generation/lease/spill owners must supply those
integrations; this slice introduces no competing storage or semantic truth store.
