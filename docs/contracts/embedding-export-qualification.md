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
Its current profile requires exact Transformers.js 4.3.2, matching the locked
dependency; other runtimes still fail before component loading. The immutable
export revision and supported dtype/dimension policies remain unchanged. Older
4.3.1 acquisition receipts and saved embedding identities do not qualify this
runtime, and the profile alignment alone is not actual-model acceptance.
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

## MiniLM independent raw-model comparison

The finite MiniLM reference supports only `Xenova/all-MiniLM-L6-v2`, its selected
`onnx/model_quantized.onnx` q8 graph, normalized384-dimensional outputs and the
committed `tests/fixtures/embeddings/minilm-provider-corpus.json`. Freeze its
exact UTF-8 SHA256 as `manifest.corpusSource = {path,sha256}`; manifest texts and
corpusProvenance must equal that JSON fixture. The32 authored inputs exercise
code, documentation, queries, padding, Unicode and repeated items. They are an
admission workload without relevance judgments or search-quality claims.

`--route upstream-reference` loads the actual upstream AutoTokenizer and
AutoModel directly. A separate test-only implementation applies the author's
attention-mask-weighted mean and L2 recipe to raw last_hidden_state. It calls no
pipeline, product adapter, pooling helper or output normalizer. Tokenizer input
and mask hashes, actual token counts, raw output geometry, copied vectors and
source/runtime/model identities are recorded before their original resources
close. The export's actual tokenizer truncation policy applies; this is not a
qualification of SentenceTransformer wrapper defaults or PyTorch conversion.

MiniLM consumer routes require `--numerical-reference <reference/receipt.json>`.
The receipt must come from that separately completed route with the same exact
manifest, corpus, verified artifact inventory, runtime and reference/upstream
source hashes. Single/batch/query comparisons retain count, ordering, finite
width, unit-norm, maximum absolute error and cosine assertions. MiniLM query
inputs are independently required to equal the raw corpus text. Prepared
MiniLM, other exports, EG2, M3 and E5 are explicitly unsupported by this reference.

Run each capsule through `tests/embeddings/run-actual-export-qualification.js`.
It reuses the original subprocess qualification owner with a fixed30-second
deadline, bounded captures and original process-tree termination evidence. Child
cleanup also remains inside its30-second budget. A child timeout or failed
prerequisite is a failure, never a skipped qualification; stop before subsequent
capsules and preserve its new output/adjacent process receipt.

After acquisition, prepare one new manifest from the exact selected inventory
and versions, replacing placeholder texts with the committed corpus. For an
existing task-owned manifest, this PowerShell preparation preserves its artifact
inventory and creates a separate frozen execution input:

```powershell
$manifest = Get-Content '<acquired-manifest.json>' -Raw | ConvertFrom-Json
$corpusPath = 'tests/fixtures/embeddings/minilm-provider-corpus.json'
$corpus = Get-Content $corpusPath -Raw | ConvertFrom-Json
$manifest.texts = @($corpus.texts)
$manifest.corpusProvenance = $corpus.provenance
$manifest | Add-Member -Force -NotePropertyName corpusSource -NotePropertyValue @{
  path = $corpusPath; sha256 = (Get-FileHash $corpusPath -Algorithm SHA256).Hash.ToLowerInvariant()
}
$manifestPath = '<new-minilm-manifest.json>'
if (Test-Path $manifestPath) { throw 'Use a new frozen manifest path.' }
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 20))
```

Use the prepared Node26 executable and explicit new output directories. Run the
reference first; each subsequent command requires its successful receipt:

```text
node tests/embeddings/run-actual-export-qualification.js --manifest <manifest> --route upstream-reference --out <new-reference-directory>
node tests/embeddings/run-actual-export-qualification.js --manifest <manifest> --route single --numerical-reference <new-reference-directory>/receipt.json --out <new-single-directory>
node tests/embeddings/run-actual-export-qualification.js --manifest <manifest> --route batch --numerical-reference <new-reference-directory>/receipt.json --out <new-batch-directory>
node tests/embeddings/run-actual-export-qualification.js --manifest <manifest> --route query --numerical-reference <new-reference-directory>/receipt.json --out <new-query-directory>
node tests/embeddings/run-actual-export-qualification.js --manifest <manifest> --route resources --observation upstream-comparison --numerical-reference <new-reference-directory>/receipt.json --out <new-resources-directory>
```

The raw reference and direct adapter explicitly request upstream CPU sessions
with intra/inter-op threads1/1. The public getQueryEmbedding consumer has no
sessionOptions parameter and uses upstream defaults; its receipt makes that
distinction explicit, with numerical rather than matched-thread query resource
claims. Receipts separate option handoff from unobserved native internal thread
counts. Resource comparisons retain cold/warm phases,
three full ordered batches, exact output bytes, existing single-owned-copy
admission bound (and a positive per-row copy witness for MiniLM), CPU/wall samples
and memory scope. Independent numerical checks
are timed separately from adapter embedding. Raw token output/scalar pooling and
pooled pipeline execution are different implementations: their observed costs
are not a before/after validation speedup. The existing `reference|candidate`
source-performance mode stays separate and rejects a candidate whose recorded
product sources equal the reference sources. MiniLM results do not close the
actual prepared EG2, M3/E5 numerical/quality, or optional-native acceptance.
