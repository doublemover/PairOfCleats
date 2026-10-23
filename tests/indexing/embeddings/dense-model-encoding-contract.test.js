import assert from 'node:assert/strict';
import { createEmbedder } from '../../../src/index/embedding.js';
import { getQueryEmbedding } from '../../../src/retrieval/embedding.js';
import { __setTransformersModuleLoaderForTests, disposeEmbeddingAdapterCaches } from '../../../src/shared/embedding-adapter.js';
import { createXenovaAdapter } from '../../../src/shared/embedding-provider-adapters.js';
import { resolveEmbeddingDenseContract, E5_CODE_RETRIEVAL_TASK } from '../../../src/shared/embedding-dense-contract.js';
import { formatEmbeddingInput, resolveEmbeddingInputFormatting } from '../../../src/shared/embedding-input-format.js';
import { buildEmbeddingIdentity, buildEmbeddingIdentityKey } from '../../../src/shared/embedding-identity.js';
import { decodeOnnxEmbeddingOutput, runOnnxEmbeddingSession } from '../../../src/shared/onnx-embeddings/output.js';
import { normalizeEmbeddingVectorInPlace } from '../../../src/shared/embedding-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1', embeddings: null });
const m3 = 'Xenova/bge-m3', e5 = 'intfloat/multilingual-e5-large-instruct';
const instruction = `Instruct: ${E5_CODE_RETRIEVAL_TASK}\nQuery: `;
for (const modelId of [m3, 'xenova/BGE-M3']) {
  assert.equal(formatEmbeddingInput('查找解析器', { modelId, kind: 'query' }), '查找解析器');
  assert.equal(formatEmbeddingInput('return value;', { modelId }), 'return value;');
}
assert.equal(formatEmbeddingInput('查找解析器', { modelId: e5, kind: 'query' }), `${instruction}查找解析器`);
assert.equal(formatEmbeddingInput(' source\n', { modelId: e5 }), ' source\n');
assert.equal(formatEmbeddingInput('', { modelId: e5, kind: 'query' }), '');
assert.equal(formatEmbeddingInput(`${instruction}alpha`, { modelId: e5, kind: 'query' }), `${instruction}alpha`);
assert.equal(formatEmbeddingInput('query: alpha', { modelId: e5, kind: 'query' }), `${instruction}query: alpha`);
for (const modelId of ['Xenova/e5-base-v2', 'intfloat/multilingual-e5-large']) {
  assert.equal(formatEmbeddingInput('alpha', { modelId, kind: 'query' }), 'query: alpha');
  assert.equal(formatEmbeddingInput('alpha', { modelId }), 'passage: alpha');
}
for (const modelId of ['intfloat/e5-mistral-7b-instruct', 'acme/multilingual-e5-large-instruct', 'BAAI/bge-m3', 'acme/bge-m3-custom']) {
  assert.throws(() => resolveEmbeddingInputFormatting(modelId), { code: 'ERR_EMBEDDING_MODEL_CONTRACT' });
}
for (const modelId of [m3, e5]) {
  const identity = buildEmbeddingIdentity({ modelId, provider: 'xenova', pooling: 'mean', normalize: true });
  const contract = resolveEmbeddingDenseContract(modelId);
  assert.equal(identity.pooling, contract.pooling);
  assert.equal(identity.dims, 1024);
  assert.equal(identity.inputFormatting.contract, contract.id);
  assert.equal(identity.denseEncoding.id, contract.id);
  const saved = JSON.parse(JSON.stringify(identity));
  assert.equal(formatEmbeddingInput('alpha', { modelId, kind: 'query', formatting: saved.inputFormatting }),
    modelId === m3 ? 'alpha' : `${instruction}alpha`);
  const legacy = { ...identity, pooling: 'mean', denseEncoding: undefined,
    inputFormatting: { family: modelId === m3 ? 'bge' : 'e5', queryPrefix: modelId === m3 ? 'Represent this sentence for searching relevant passages: ' : 'query: ', passagePrefix: modelId === m3 ? null : 'passage: ' } };
  assert.notEqual(buildEmbeddingIdentityKey(legacy), buildEmbeddingIdentityKey(identity));
  assert.throws(() => formatEmbeddingInput('alpha', { modelId, kind: 'query', formatting: legacy.inputFormatting }), /Rebuild/);
  assert.throws(() => buildEmbeddingIdentity({ modelId, inputFormatting: legacy.inputFormatting }), /Rebuild/);
  assert.throws(() => createXenovaAdapter({ modelId, normalize: false }), /requires normalized/);
}

const records = [], wrappers = [];
const module = { env: {}, pipeline: async (task, modelId) => Object.assign(async (texts, options) => {
  records.push({ modelId, texts, options });
  const data = new Float32Array(texts.length * 1024);
  for (let row = 0; row < texts.length; row++) data[row * 1024 + row] = 1;
  return { dims: [texts.length, 1024], type: 'float32', data, dispose() { data.fill(NaN); } };
}, { dispose() {} }) };
__setTransformersModuleLoaderForTests(async () => module);
try {
  for (const modelId of [m3, e5]) {
    const wrapper = createEmbedder({ modelId, provider: 'xenova', normalize: true }); wrappers.push(wrapper);
    const docs = await wrapper.getChunkEmbeddings(['alpha', '文档']);
    assert.deepEqual(records.at(-1).texts, ['alpha', '文档']);
    assert.equal(records.at(-1).options.pooling, modelId === m3 ? 'cls' : 'mean');
    assert.equal(records.at(-1).options.max_length, modelId === m3 ? 8192 : 512);
    assert.equal(docs[0][0], 1, 'vectors survive captured native tensor disposal');
    assert.equal(docs[1][1], 1, 'source item ordering is retained');
    const estimates = await wrapper.getChunkEmbeddings.estimateTokensBatch(['alpha', '文档']);
    assert.equal(estimates.length, 2);
    const query = await getQueryEmbedding({ modelId, provider: 'xenova', normalize: true, text: 'find parser' });
    assert.equal(query[0], 1);
    assert.deepEqual(records.at(-1).texts, [modelId === m3 ? 'find parser' : `${instruction}find parser`]);
  }
} finally {
  await Promise.all(wrappers.map(wrapper => wrapper.dispose()));
  await disposeEmbeddingAdapterCaches(); __setTransformersModuleLoaderForTests(null);
}

const contract = resolveEmbeddingDenseContract(m3);
const data = new Float32Array(2 * 3 * 1024);
data[0] = 3; data[1] = 4; data[1024] = 99;
data[3 * 1024 + 1] = 1; data[4 * 1024] = 99;
const tokenTensor = { type: 'float32', dims: [2, 3, 1024], data };
const decode = (overrides = {}) => decodeOnnxEmbeddingOutput({ outputs: { last_hidden_state: tokenTensor },
  count: 2, attentionMask: [[1, 1, 0], [1, 1, 0]], denseContract: contract,
  normalizeVector: normalizeEmbeddingVectorInPlace, ...overrides });
const vectors = decode();
assert(Math.abs(vectors[0][0] - 0.6) < 1e-6); assert(Math.abs(vectors[0][1] - 0.8) < 1e-6);
assert.equal(vectors[1][1], 1);
for (const attentionMask of [[[0, 1, 0], [1, 1, 0]], [[0, 0, 0], [1, 1, 0]], [[1], [1, 1, 0]], [[NaN, 1, 0], [1, 1, 0]]]) {
  assert.throws(() => decode({ attentionMask }), { code: 'ERR_ONNX_EMBEDDING_OUTPUT' });
}
const pooled = { dims: [2, 1024], type: 'float32', data: data.subarray(0, 2048) };
assert.throws(() => decode({ outputs: { pooler_output: pooled } }), { code: 'ERR_ONNX_EMBEDDING_OUTPUT' });
assert.throws(() => decode({ outputs: { last_hidden_state: pooled } }), { code: 'ERR_ONNX_EMBEDDING_OUTPUT' });
assert.equal(decodeOnnxEmbeddingOutput({ outputs: { sentence_embedding: pooled }, count: 2,
  normalizeVector: value => value })[0][0], 3, 'generic already-pooled outputs are copied without a second pooling step');
let calls = 0;
await runOnnxEmbeddingSession({ session: {
  outputNames: ['sentence_embedding', 'last_hidden_state'], outputMetadata: [
    { name: 'sentence_embedding', isTensor: true, type: 'float32', shape: ['batch', 1024] },
    { name: 'last_hidden_state', isTensor: true, type: 'float32', shape: ['batch', 'sequence', 1024] }
  ], run: async (feeds, fetches) => { calls++; assert.deepEqual(fetches, ['last_hidden_state']); return { last_hidden_state: tokenTensor }; }
}, feeds: {}, denseContract: contract });
assert.equal(calls, 1);
await assert.rejects(runOnnxEmbeddingSession({ session: { outputNames: ['pooler_output'],
  outputMetadata: [{ name: 'pooler_output', type: 'float32', isTensor: true, shape: ['batch', 1024] }],
  run: () => assert.fail('unsupported dense head must fail before inference') }, feeds: {}, denseContract: contract }), /qualified/);
console.log('Dense model formatting, adapter options, identity replay and CLS output assertions complete');
