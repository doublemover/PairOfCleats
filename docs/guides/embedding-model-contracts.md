# Qualified dense embedding contracts

Query vectors are admitted before query-cache fulfillment and ANN work. Values
must be numeric, finite and representable as Float32, with the exact selected
model/index width. Generic unknown widths may use the provider's observed width;
known widths cannot be repaired through clipping or padding. Named model
projections remain in their qualified decoders. Models requiring L2 normalization
also require a nonzero unit norm (squared-norm tolerance `1e-4`); generic L2 inputs
retain their existing zero-vector policy. Invalid output yields the typed
`ERR_EMBEDDING_OUTPUT` diagnostic and sparse fallback, is evicted from the query
cache, and can be attempted afresh by the next request. Resource/identity failures
retain their existing ownership and rejection contracts.
Local result signatures and federated result keys include the shared query-vector
admission version, preventing earlier cached results from bypassing this policy.

`Xenova/bge-m3` uses unmodified query and document text, CLS pooling, 1024
dimensions, L2 normalization and an 8192-token limit. This follows the export
author's [Transformers.js recipe](https://huggingface.co/Xenova/bge-m3#usage-transformersjs).
The generic ONNX adapter accepts this profile only when loaded-session metadata
exposes a rank-3 `last_hidden_state` with the qualified width. It does not infer a
trained sentence head from an arbitrary rank-2 `pooler_output` name. Other M3
exports require their own qualified contract.

`intfloat/multilingual-e5-large-instruct` uses the author's
[instruction/query template and mask-mean pooling](https://huggingface.co/intfloat/multilingual-e5-large-instruct#usage),
1024 dimensions, L2 normalization and a 512-token limit. PairOfCleats fixes the
retrieval task to the following exact input prefix:

```text
Instruct: Given a code search query, retrieve relevant source code or documentation passages that answer the query
Query:
```

Each label is followed by one ASCII space, including the trailing space after
`Query:`. Documents remain unmodified. Formatting preserves original text bytes, including
Unicode and whitespace. Empty input remains empty. Reapplying the exact query
prefix is idempotent; other leading text is treated as raw query content. Plain E5
and multilingual E5 retain their existing `query: ` and `passage: ` prefixes.
Unknown instruction-tuned E5 exports, including E5 Mistral's different last-token
contract, fail preflight instead of inheriting legacy E5 semantics.

The exact instruct model selects the author's
[immutable export](https://huggingface.co/intfloat/multilingual-e5-large-instruct/commit/c9e87c786ffac96aeaeb42863276930883923ecb),
revision `c9e87c786ffac96aeaeb42863276930883923ecb`: a 686,499-byte fp32 graph and
2,235,367,440-byte `model.onnx_data` file. The loader explicitly declares external
data before native initialization; prefetch and readiness use the same revision
root and complete graph/data receipt. Exact author hashes supplement opened-byte
verification. Earlier q8 receipts and mismatched closures cannot authorize reuse.
The plain `Xenova/multilingual-e5-large` model keeps its existing q8 selection and
different text contract. No model substitution or precision fallback occurs.
The instruct acquisition recipe does not qualify real-model numerical quality or
resource use; those require the actual external weights and independent evaluation.

The shared identity records the contract ID, output meaning, pooling, token limit
and exact task/prefix bytes. Inline and Stage3 identity builders consume the same
projection, and query formatting rejects incompatible persisted contracts with a
rebuild diagnostic. Existing mean-pooled M3 and legacy-prefixed instruction-tuned
E5 generations require rebuilding. Model artifact provenance remains a separate
required identity; recognizing a model name does not prove any local graph's bytes.

These changes encode documented semantic contracts. Synthetic adapter/tensor
regressions do not qualify a real model revision, native runtime, retrieval score,
latency or memory improvement. Independent official-reference vector comparison
and judged multilingual code/document retrieval evaluation remain acceptance work.

Qualified-profile prefetch uses the same runtime, revision, precision and text
component loader as inference. It closes the temporary native loader before
hashing the local closure and atomically publishing its acquisition receipt.
Declared ONNX external-data paths belong to that closure even when their names
or subdirectories differ from generic cache conventions. Legacy file-list-only
profile receipts require prefetch again; acquisition preserves existing model
files and earlier selected ONNX installations.
Experimental EG2 graph stems retain unknown, attempt-scoped artifact provenance;
the default profile revision or acquisition receipt cannot qualify their bytes.

Setup readiness reports readable, nonempty selected assets and matching recorded
sizes. It does not initialize inference or promise content/native correctness.
Runtime verification hashes the selected profile closure asynchronously and
rejects bytes that disagree with the receipt, including same-size edits with
preserved modification times. Mutable warm acquisitions still rehash; a path/stat
match alone cannot authorize digest reuse. Concurrent requests coalesce only for
the exact selected closure. Cancelled callers retain an observable verification
owner while shared byte verification drains for other callers.
ONNX startup keeps the verified physical installation path if a newer selector
is published while verification is pending. It rechecks that same closure after
loading; the selector does not redirect an admitted request to another graph.

ONNX execution telemetry separates output conversion and captured tensor cleanup
time. Tensor disposal settlement is not evidence of measured native memory
release. Profile experiment source bindings include artifact/closure/lifetime
helpers, and corrected processing identities do not enable a faster default.
The ordinary ONNX low-memory guard counts selected external-data bytes as well
as the graph file. Cleanup error projection uses bounded captured diagnostics;
an independently pending inspection cannot authorize another native dispose or
release model/session capacity.
Experiment source reads use bounded original descriptors and must agree before
and after the case. The report distinguishes these source-byte observations
from loaded-module byte attribution, which remains unobserved. Workload,
configuration and resource-envelope inputs are captured before acquisition;
qualification keeps the selected physical ONNX installation.

Unpadded ONNX token rows are reused only with the same tokenizer object,
truncation setting, token limit and token-type policy. Estimation retains rows
in a bounded adapter store for dispatch; release removes only its original row
owner. Tokenizer output must have the requested row count, matching field widths,
safe nonnegative integer IDs and binary masks before feed assembly. Telemetry
counts tokenizer calls, row-cache hits, useful tokens and padded field cells;
these counts do not establish a model throughput improvement.

Generic prefetch preserves q8 selection. When the runtime registry exposes its
selected component list, the downloader uses that graph for relocation even if
an unused fp32 sibling is already cached. `--onnx-path` selects relocation itself;
profile exports needing multiple graphs and EmbeddingGemma 2's qualified text
runtime cannot be advertised as generic single-graph ONNX installations.
See [actual export qualification](../benchmarks/embedding-export-qualification.md) for the separate native routes, judged corpus, E5 persisted consumers and original/current admission-cost campaigns.
