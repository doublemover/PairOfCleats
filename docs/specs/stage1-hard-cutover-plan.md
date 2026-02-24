# Stage1 Hard Cutover Plan

## Objective
Complete Stage1 migration to order-contiguous runtime with one active behavior surface and no compatibility shims.

## Preconditions
1. Runtime/spec docs are merged and aligned with implementation.
2. New Stage1 tests for ledger/window/commit/replay/cancellation/backpressure pass.
3. Legacy gap-recovery behavior is no longer required by any contract.

## Cutover Steps
1. Land seq-ledger and contiguous window planner as default Stage1 path.
2. Switch ordered commit to commit cursor + contiguous run micro-batching.
3. Remove gap-recovery branches from Stage1 processing modules.
4. Remove shard-first ordered-drain assumptions from Stage1 planning surfaces.
5. Persist/replay new checkpoint fields (`nextCommitSeq`, terminal bitmap hash, retry metadata, planner seed hash).
6. Update docs/spec/tests to describe only the new behavior.

## Cleanup Checklist
- Delete legacy ordered append gap-recovery branches.
- Delete compatibility guards that select old Stage1 ordering path.
- Delete tests that assert legacy recovery semantics; replace with invariant-failure expectations.
- Update architecture diagrams to show two-lane runtime and two-window overlap.

## Rollback Boundary
Rollback is code-revert to pre-cutover commit. No runtime dual-path toggles are maintained in post-cutover code.

## Governance
`STAGE1_ORDERED_THROUGHPUT_REDESIGN.md` must stay synchronized with:
1. Implemented touchpoints.
2. Added/updated tests.
3. Completed phase status.

## Acceptance
Cutover is complete when:
1. Only contiguous window + commit cursor path exists for Stage1.
2. Test suite validates deterministic order, no deadlock stalls, and bounded memory behavior.
