export const LOCAL_RERANKER_VERSION = 1;
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const record = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
export const LOCAL_CROSS_ENCODER_PROFILE_SCHEMA = record({ schemaVersion: { const: LOCAL_RERANKER_VERSION },
  kind: { const: 'pinned-local-bert-cross-encoder' }, modelId: { const: 'Xenova/ms-marco-MiniLM-L-6-v2' },
  revision: { type: 'string', pattern: '^[a-f0-9]{40}$' }, tokenizerRevision: { type: 'string', pattern: '^[a-f0-9]{40}$' },
  graph: { type: 'string', minLength: 1, maxLength: 4096 }, graphClosureDigest: hash, artifactDigest: hash, tokenizerDigest: hash,
  license: record({ spdx: { const: 'Apache-2.0' }, path: { type: 'string', minLength: 1, maxLength: 4096 }, sha256: hash }),
  runtime: record({ transformers: { const: '@huggingface/transformers@4.3.1' }, onnx: { type: 'string', pattern: '^onnxruntime-node@[0-9]+\\.[0-9]+\\.[0-9]+$' } }),
  formatting: { const: 'bert-query-passage-pair.v1' }, truncation: { const: 'reject-over-budget.v1' },
  maxQueryChars: { type: 'integer', minimum: 1, maximum: 2048 }, maxPassageChars: { type: 'integer', minimum: 1, maximum: 8192 },
  maxTotalChars: { type: 'integer', minimum: 1, maximum: 262144 }, maxQueryTokens: { type: 'integer', minimum: 1, maximum: 128 },
  maxPairTokens: { type: 'integer', minimum: 8, maximum: 512 }, maxTotalTokens: { type: 'integer', minimum: 8, maximum: 32768 },
  output: { const: 'logits' }, score: { const: 'sigmoid-single-logit.v1' }
});
