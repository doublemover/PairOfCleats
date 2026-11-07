# Local retrieval adaptation

The #1529 owners compile offline training cohorts, evaluate masked objectives,
train small directional query factors and export their numerical kernel. They
do not load a model, activate a serving profile, mutate a document generation or
qualify retrieval quality. Existing production embedding and generation checks
remain unchanged.

`src/shared/retrieval-adaptation/directional-query.js` implements
`normalize(e + U(V^T e))` with row-major d-by-r Float32 factors, Float64
accumulators and normalized Float32 output. Dimensions are bounded by 4,096 and
rank by 64 and d. Input rounding to Float32 is explicit. The helper owns its
output and keeps borrowed inputs unchanged; nonfinite values, zero norms,
shared storage, sparse/accessor arrays and ambiguous factor encodings fail.
The factorized kernel performs 2*d*r multiply-add terms without constructing a
d-by-d matrix. This operation count is not a measured latency improvement.

The authoritative schema binds the exact query and document encoder artifact,
provider, model, roles, represented-input/format/pooling policies and width.
Document identity also includes merge, normalization, cosine metric and original
versus dequantized stored-vector representation. Quantized targets require their
own quantization identity. Matching dimensions do not establish compatibility.
Artifact identity uses the existing verified/revision embedding authority; stub
or unknown artifacts cannot become an adapted pair.

Factor exports have canonical little-endian Float32 bytes, strict base64,
SHA-256 digests and a composed pair ID binding all bytes and contracts. Import
owns and validates the actual bytes. An untrained identity control requires
U=0; SHA-256-seeded xorshift32-v1 initializes a small nonzero V. A trained
candidate requires cohort, split, source dependency, objective and rights
identities. These lineage fields alone do not establish valid training.

Private handles retain immutable snapshots and own factors. Explicit retirement
rejects subsequent use; copying a token does not copy its ownership. The kernel
requires both actual query and opened-document descriptors and returns a
pair-scoped query-cache identity. A descriptor is not a generation lease or live
source authority. The future serving owner must retain the actual opened
generation and atomically select/rollback a qualified pair; this offline helper
does not change production cache admission or grant deployment eligibility.

The authored regressions compare the factored result with an independent dense
reference, round-trip exact exports, unchanged input bytes, same-width wrong
models/providers/roles/pooling/quantization targets, malformed/nonfinite factors,
zero projected norms, caller mutation and retirement. Runtime execution remains
pending with the other development-first fixtures. Serving integration and independent held-out
quality/cost qualification remain required before closing #1529.

## Task judgments and training cohorts

`src/retrieval/evaluation/tasks/judgments.js` extends the existing #1525 task
owner with source-pinned authored relevance annotations. It requires the original
compiled task and frozen split manifest. Task, private oracle, raw query,
requirement and split identities must match. Every nonempty source span must
match the original compiled source and exact UTF-16 boundaries. Positive grades,
negative weights, named counterexample bases, explicit unknowns, review receipt
IDs, producer, assumptions and rights remain separate fields. Receipt IDs record
authored provenance; they do not execute a checker or establish semantic proof.
Candidate-facing task views expose none of these private annotations.

`compileRetrievalTrainingCohort` checks every original membership before reading
any labels/text and admits training members from exactly one frozen manifest.
Dev/calibration/test members, copied handles, stale source/oracle identities and
retired original task owners fail. Exact/declared leakage components come from
the existing split owner; this adds no second split or contamination authority.

Documents bind world, exact source/span and representation. Query IDs bind the
compilation, requirement and raw query hash; normalization is explicitly identity.
Annotation and source order cannot change the stable corpus identity. Duplicate
annotations/documents do not add probability mass. The current bounded slice
admits 32 tasks, 256 annotations per task and 8 MiB of canonical corpus input;
oversized input fails instead of silently truncating. It performs no mining,
teacher calls, model acquisition, code execution or telemetry collection.

Each query retains positives, explicitly reviewed negatives, unknowns and
conflicts. Conflicting annotations have mask zero. Source intervals participating
in any declared sufficient oracle alternative are protected against negatives.
Reviewed exact-text aliases extend that protection to renamed source; aliasing
does not turn unknowns into positives or establish behavioral equivalence.
Other documents in a minibatch or cross-batch queue remain unknown unless that
same query has an explicit annotation. Unedited files, missing edges, absent
results and grade zero never create negatives. Queries without both an admitted
positive and negative remain in skipped-coverage counts.

The shared mask owner deduplicates/sorts each bounded candidate support.
`evaluateMaskedContrastiveObjective` uses it for explicitly named any-positive,
mean-positive or graded-positive objectives. It centers cosine scores before
temperature division, uses stable log-sum-exp and nonnegative declared negative
weights, and returns score gradients. Positive weights are one; graded targets
use the declared `2^grade-1` mapping. Unknown/conflicting/zero-weight pairs have
zero mass. No admitted negative skips the term with a null loss, rather than
inventing supervision. Mean-positive can lower a dominant positive's score;
any-positive can concentrate on one alternative. Neither certifies AND/OR task
completion. Nine additional unrun cases retain exact stable tuples, held-out and
stale-source rejection, alias conflicts, queue masks, skipped coverage, independent
finite-difference gradients and extreme-temperature numerical controls.

## Frozen vectors and deterministic CPU training

`training.js` copies every query/document vector under the original cohort,
source input hash and exact directional contracts. It fingerprints actual
canonical Float32 bytes. Every cohort query and document needs exactly one
record; there are at most 1,024 records per role and 1,048,576 total values.
The initial optimizer requires normalized original-float32 documents. Stored
quantized targets are a separate contract and are rejected by this trainer.
This import proves source/byte binding, not that a named encoder produced the
supplied floats. Actual local encoder execution remains a qualification owner.

The explicitly selected run contract fixes the objective, temperature, constant
learning rate, momentum, factor regularizer, gradient norm cap, seed and total
sampler visits. A visit without admitted positive and negative support increments
the skipped count without an optimizer update. SHA-256 of seed, epoch and query
identity defines each epoch's permutation; sampler position is complete-update
step/epoch/offset. No ambient RNG or candidate-selection callback is involved.

Training calls the same Float32 forward kernel as exported inference. Cosine and
normalization derivatives accumulate in Float64. The named output rounding
gradient uses a straight-through estimator for Float32 output; it is not the
mathematical derivative of the discontinuous rounding map. Momentum/factors
round to Float32 after each full update. The regularizer is
`lambda * (||U||^2 + ||V-V_initial||^2)`, not a claim to regularize the full
residual matrix by an equivalent norm. Gradient clipping is global across U/V.

Checkpoint identity includes cohort, split, actual vector-set bytes, the complete
run and directional specs, factor bytes, momentum and sampler state. Resume
validates all identities, finite canonical buffers and counter relationships.
Partial optimizer writes never commit: all new arrays must pass before replacing
the prior complete state. Each bounded advance yields between updates and accepts
cancellation; original errors propagate and the last complete state remains.
Concurrent advances and exports/retirement during an advance fail. Source or
judgment retraction invalidates its original local cohort and refuses further
training, resume, masks or exports; a clean cohort and retrain are required.
Previously distributed artifacts require the external qualification/revocation
registry; local invalidation does not pretend to erase copies or unlearn labels.

Explicit retirement releases a session's vector ownership. A frozen-vector owner
cannot retire while sessions still hold it; cleanup remains possible after
retraction. No file, native resource or production profile is published by these
library operations. Eight additional unrun regressions cover source/byte binding,
first nonzero update, exported forward parity, synthetic loss reduction, exact
resume under all three objectives, changed/corrupt state, cancellation, absent
negatives, retraction, retirement and overflow preserving the prior checkpoint.
Synthetic learning and operation counts do not establish held-out search quality,
latency, real-model parity or deployment eligibility.
