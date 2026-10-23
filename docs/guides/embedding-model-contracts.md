# Qualified dense embedding contracts

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

Setup readiness reports readable, nonempty selected assets and matching recorded
sizes. It does not initialize inference or promise content/native correctness.
Runtime verification hashes the selected profile closure asynchronously and
rejects bytes that disagree with the receipt, including same-size edits with
preserved modification times. Mutable warm acquisitions still rehash; a path/stat
match alone cannot authorize digest reuse. Concurrent requests coalesce only for
the exact selected closure. Cancelled callers retain an observable verification
owner while shared byte verification drains for other callers.

ONNX execution telemetry separates output conversion and captured tensor cleanup
time. Tensor disposal settlement is not evidence of measured native memory
release. Profile experiment source bindings include artifact/closure/lifetime
helpers, and corrected processing identities do not enable a faster default.

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
