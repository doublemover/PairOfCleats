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
