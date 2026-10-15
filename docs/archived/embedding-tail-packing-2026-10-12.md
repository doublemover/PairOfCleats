# Bounded embedding tail packing

The admitted global window still owns request-count and retained-byte bounds.
Within it, the batch planner compares source order with ascending and descending
power-of-two length buckets. File/code/document ownership remains a secondary
ordering key; outputs scatter back to their original indices before publication.

A reordered plan is eligible only when it uses no more provider calls and no
more estimated padded tokens than source order. Selection minimizes padding,
then call count, with deterministic source order retained on ties. This avoids
trading an unmeasured locality gain for extra calls or padding. Sum-token and
item bounds, including the existing intact oversized-item exception, are unchanged.

The reported three-file tail case, each with lengths `[8,128,8,128,16,16]`, has
18 inputs, a 16-item cap and a 2048-token sum budget. Previous ascending grouping
used 2304 estimated padded tokens versus source order's 2080. The selected
descending plan uses 2064; all three plans make two calls and return the same
source-indexed vectors. This is a packing result, not a real-model speedup claim.

Focused coverage also checks 200 deterministic varied shapes against the
no-worse baseline, intact inputs, item/token limits and deterministic scatter.
Existing grouped failure/cancellation and batch-policy fixtures remain applicable.

## Reading progress correctly

- `provider_active` and `provider_peak_active` count calls inside the existing
  scheduled provider dispatch; file admission and scheduler token ceilings do not
  imply concurrent native model execution. The global flush/batch loop currently
  serializes provider calls; ONNX session serialization is preserved.
- `inflight_claims` and `inflight_join_hits` are cumulative request counters.
  `inflight_live` is the live coalescer size, not the cumulative claims count.
- Writer pending includes admitted/scheduler-queued work. It is not the number
  of simultaneous physical disk writes. Running scheduler I/O is reported separately.
- The micro-batching underfilled counter is a cumulative token-capacity shortfall,
  not a count of batches. Fill is summed useful estimated tokens divided by summed
  token targets; padding is a different measure.
- Compute ETA uses known remaining estimated tokens and recent completed batch
  cost. It is unknown before samples and excludes final writer/backend publication.
  Cache reuse, sequence-length nonlinearity and provider behavior limit accuracy.

No provider-concurrency default, model choice, index format or cache identity is
changed by this planner. No model download or full indexing run is needed to test it.
