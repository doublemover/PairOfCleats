# Actual embedding export qualification

Shape/cardinality/dtype and cleanup regressions using recording inference retain
their controlled-route scope. They do not qualify an actual model export or its
large-batch resource cost. Tiny generated ONNX graphs are installer/lifetime
controls and are not substitutes for supported embedding models.

`tests/embeddings/actual-export-qualification.js` is an explicit offline capsule,
outside ordinary test discovery. It requires `--manifest`, `--route`, and a new
`--out` directory. Routes are `single`, `batch`, `prepared`, `query`, and
`resources`. Every capsule retains the original30-second total bound, including
cleanup. Parent supervision must also enforce that bound for native calls that
do not support cooperative cancellation. A timeout is never passing evidence.

The frozen JSON manifest has schemaVersion1, provider (`xenova` or `onnx`), exact
modelId/modelsDir, dimensions, normalization policy, optional modelProfile and
onnxConfig, numeric tolerance (at most1e-4), actual installed runtime versions
(`runtime.transformers` and `runtime.onnxruntimeNode`), corpusProvenance,2–64
texts, and the complete verified model/tokenizer `artifacts` inventory of
`{path,bytes,sha256}`. The capsule refuses unknown or merely named immutable
closures. Remote acquisition is disabled; it does not download, patch, copy, or
promote model weights. Supply a previously verified task-owned export.

Prepared inference is currently the explicit EmbeddingGemma2 text-model route.
Generic feature-extraction and ONNX adapters do not gain invented prepared
capability. A requested unsupported route fails its prerequisite. Qualify
supported exports individually: generic pooled outputs, qualified BGE-M3/E5
decoders, and EG2 profile/dimension projections have different model meanings.
The existing malformed-output and original-resource regressions remain required
alongside these actual-export positives.

Resource capsules require32–64 supplied corpus texts and explicit
`--observation reference|candidate`. A candidate also requires `--reference`
pointing to a same-manifest, same-artifact, same-runtime `sampled-reference`
receipt from the independently frozen reference source. Compare exact vectors
within the declared tolerance, ordering, necessary host Float32 copies, wall/CPU
samples,5ms process-memory samples, and process-lifetime OS high-water. Receipts
bind source hashes and keep cold two-row loading separate from three warm large
batches. JS-visible admission/projection allocation counts do not measure every
native allocation. Samples establish only that supplied workload; they assert no
general throughput improvement. A reference observation alone is not candidate
acceptance.

Actual-model qualification for issues1544,1541 and1542 remains pending until the
verified export/tokenizer/corpus/reference inputs exist and these native routes
have source-bound successful receipts. No tiny-model or stub result fills that
acceptance remainder.
