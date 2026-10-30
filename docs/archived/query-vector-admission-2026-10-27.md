# Query-vector admission — 2026-10-27

Source: `294e971bb328feeb67c5049fb90f36935b895dc0`, tree
`324bc3efdfa32e8904b96335397e5ee3f1c07397`, on
`codex/pr557-audit-repairs-20261012`. Main implementation:
`755acc8d5c6662f61eba843aa76171f6c7717e79`; the final commit adds the
persisted/requested width conflict guard. Windows x64, Node 26.12.1.
Dependencies, patches and native binaries are unchanged; bootstrap was not rerun.

## Delivered

Queries now use shared provider-output admission before cache fulfillment and ANN.
Vectors require finite numeric Float32-representable values and the exact selected
model/index width. Named normalized model contracts additionally require a nonzero
unit norm, with squared-norm tolerance `1e-4`. Generic L2 zero vectors retain their
existing policy. Known mismatches cannot be repaired by incidental clipping or
zero padding; named model projections remain in their qualified decoders.

Invalid query output becomes unavailable, is evicted and leaves sparse hits and
candidates usable. The next request can perform fresh inference without an
automatic retry. Hits are rechecked against subsequent buffer corruption. Invalid
queries cannot reach ANN providers or the HNSW search boundary. Original provider,
artifact, cancellation and resource ownership failures retain their rejection.

Cache artifact selection now resolves the canonical model profile before identity
checking, fixing partial-profile versus inference-profile disagreement. A
persisted/requested width conflict rejects before provider work. Local result
signatures and federated keys include a shared admission version, preventing old
cached results from bypassing the repair. Valid vectors need no copy or mutation
for admission; cache-hit checks scan their current values.

## Evidence

The 27-case affected cohort passes at `755acc8d5`. All **14 cases affected by the
final width guard pass at `294e971bb`**, as does the complete front gate, including
**40/40 gate cases**. Format, config budget, environment audit, generated freshness,
command surface, workflow and diff checks pass. One job/thread, 30-second case
bounds, zero retries/native redo; no skips, timeouts or native crashes. These are
revision-specific observations, not a fresh complete deep-suite run.

Seven controlled prior-owner regressions fail: nonfinite query-cache fulfillment,
nonfinite query output, invalid HNSW admission, canonical profile selection,
incidental dimension transformation, result-cache policy and persisted/requested
width conflict. Child-only load hooks substitute the earlier owner modules; the
checkout was never reverted. The [structured receipt](query-vector-admission-2026-10-27.json)
records exact revisions, selected IDs and raw evidence paths.

New controls cover NaN and both infinities at every position of three-component
array/Float32/Float64 queries and all 128 positions of a normalized profile query;
nonnumeric/empty/short/long/overflow data; invalid-first/valid-next/cache-hit paths;
corrupted cache values; sparse preservation and zero ANN calls. Generic, ONNX and
prepared-model cases use actual query/resolver/adapter/decoder owners with
controlled inference, tokenization and session objects. They do not execute real
model weights or establish retrieval quality. Prepared cases retain qualified
128-dimensional projection and reject invalid source components outside that
projection. Existing identity, cleanup, cancellation, warm-cache, replacement,
LanceDB and result-key controls remain passing at their recorded revisions.

The older Gemma cache fixture now returns a unit vector of its requested width,
preserving dtype isolation and cache-call assertions. A signature fixture includes
the existing null effective-plan identity, while its new negative differs only by
admission policy. Clipping/padding warning branches were removed because exact
admission never returns `adjusted: true`; positive named projections remain tested.

## Tracking and limits

**#1006 is closed completed**, covering its original batch defect and query
follow-up. #1544 remains qualification pending for actual model exports,
representative batch performance/copies and final acceptance reconciliation; its
issue now records the bounded fixture progress. The live queue has **718 open**:
459 qualification pending, 146 partial/follow-up and 113 unresolved implementation
entries. **52 of the original 770 issues are closed.**

Real models, measured performance, full deep/release acceptance and other platforms
remain separate. No GUI, WSL, elevation, new physical links or security-setting
changes were used. Raw `.tmp/tasks/query-vector-admission-20261027/` and `.testLogs/`
paths are historical author-workspace receipts, absent from clean checkouts.
