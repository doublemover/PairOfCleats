# Bounded type candidate admission

Status: UNVALIDATED source and authored controls, 2026-10-22.

The existing type merger deduplicates by canonical type and source, retaining
different provenance as separate facts. Before display sorting it selects capped
candidates by descending explicit finite confidence. An absent/nonfinite score
is unknown and follows every explicit finite score, including zero. No implicit
confidence is assigned from a source label, and no probability calibration or
independent-evidence score aggregation is claimed. Propagation's origin-score
basis remains separate work under #818.

Equal-strength admission uses canonical type, source, display type and original
text as stable code-unit tie breakers. Same-key updates retain the stronger
variant and use the same deterministic spelling tie break. The selected facts
then use the existing type/source/confidence display order. A stronger ZResult
can no longer be evicted merely because five weaker alternatives sort first.

For a positive effective cap K, the retained map never exceeds K entries. Each
new valid key beyond capacity sets the existing truncated observation, selects
against the weakest retained fact and evicts before insertion. A later stronger
version of an evicted key may enter again. Retained admission state is O(K),
with O(K) selection work per new distinct candidate and one final display sort.
Set/Map/iterable input is traversed without a new full collection copy inside
the merger. Input iteration/normalization and caller-owned collections remain
their existing work and memory; some provider callers still prepare arrays.
Zero, absent, invalid and fractional-to-zero caps retain legacy uncapped semantics.
No cap, public knob or type wire shape changes.

Shared typeNormalization advances to8 so semantic replay cannot reuse earlier
selection meaning. The existing provider payload and provider-map merge owners
inherit this policy without new paths or source priorities. Authored controls
cover permutations/splits, stronger updates, distinct provenance, missing/zero
scores, exact caps/truncation, evicted-key updates, repeat merges, streamed input
and actual default-five provider consumers. None has run. Added selection cost,
memory/quality effects and supported-runtime/full-pipeline acceptance require
later measurement; these source work bounds are not measured speedups.
