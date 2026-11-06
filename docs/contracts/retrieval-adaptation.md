# Local retrieval adaptation

The first #1529 owner is an offline directional query artifact and numerical
kernel. It does not train, load a model, activate a serving profile, mutate a
document generation or qualify retrieval quality. Existing production embedding
and generation checks remain unchanged.

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
pending with the other development-first fixtures. Cohort judgments/masks,
deterministic training/resume, serving integration and independent held-out
quality/cost qualification remain required before closing #1529.
