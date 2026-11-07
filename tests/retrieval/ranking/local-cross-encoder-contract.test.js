import assert from 'node:assert/strict';
import { admitLocalCrossEncoderProfile, decodeCrossEncoderLogit } from '../../../src/retrieval/rerankers/onnx-cross-encoder.js';
import { LOCAL_RERANKER_VERSION } from '../../../src/contracts/schemas/reranker.js';

const profile = { schemaVersion: LOCAL_RERANKER_VERSION, kind: 'pinned-local-bert-cross-encoder',
  modelId: 'Xenova/ms-marco-MiniLM-L-6-v2', revision: 'a'.repeat(40), tokenizerRevision: 'a'.repeat(40), graph: 'model.onnx',
  graphClosureDigest: 'b'.repeat(64), artifactDigest: 'c'.repeat(64), tokenizerDigest: 'd'.repeat(64),
  license: { spdx: 'Apache-2.0', path: 'LICENSE', sha256: 'e'.repeat(64) },
  runtime: { transformers: '@huggingface/transformers@4.3.1', onnx: 'onnxruntime-node@1.30.0' },
  formatting: 'bert-query-passage-pair.v1', truncation: 'reject-over-budget.v1', maxQueryChars: 2048,
  maxPassageChars: 8192, maxTotalChars: 262144, maxQueryTokens: 128, maxPairTokens: 512, maxTotalTokens: 32768,
  output: 'logits', score: 'sigmoid-single-logit.v1' };
const admitted = admitLocalCrossEncoderProfile(profile);
assert.equal(Object.isFrozen(admitted), true); assert.equal(Object.isFrozen(admitted.license), true);
assert.equal(decodeCrossEncoderLogit({ type: 'float32', dims: [1, 1], data: new Float32Array([0]) }), 0.5);
assert.equal(decodeCrossEncoderLogit({ type: 'float32', dims: [1, 1], data: new Float32Array([1000]) }), 1);
assert.equal(decodeCrossEncoderLogit({ type: 'float32', dims: [1, 1], data: new Float32Array([-1000]) }), 0);
for (const mutate of [value => { value.revision = 'main'; }, value => { value.tokenizerRevision = 'f'.repeat(40); },
  value => { value.graph = '../model.onnx'; }, value => { value.license.spdx = 'unknown'; },
  value => { value.truncation = 'silent-prefix'; }, value => { value.maxPairTokens = 8192; },
  value => { value.runtime.transformers = '@huggingface/transformers@4.0.0'; }]) {
  const value = structuredClone(profile); mutate(value);
  assert.throws(() => admitLocalCrossEncoderProfile(value), { code: 'ERR_LOCAL_RERANKER_PROFILE' });
}
for (const tensor of [{ type: 'float32', dims: [1, 2], data: new Float32Array([1, 2]) },
  { type: 'float64', dims: [1, 1], data: new Float64Array([1]) },
  { type: 'float32', dims: [1, 1], data: new Float32Array([NaN]) }]) assert.throws(() => decodeCrossEncoderLogit(tensor));
console.log('pinned local cross-encoder profile, token/format/license and logit capability assertions complete');
