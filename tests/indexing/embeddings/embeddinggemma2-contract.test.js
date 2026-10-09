#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEmbedder } from '../../../src/index/embedding.js';
import { resolveEmbeddingRuntime } from '../../../src/index/build/runtime/embeddings.js';
import { getQueryEmbedding } from '../../../src/retrieval/embedding.js';
import { createEmbeddingResolver } from '../../../src/retrieval/cli/run-search-session/embedding-cache.js';
import {
  __setTransformersModuleLoaderForTests,
  getEmbeddingAdapter
} from '../../../src/shared/embedding-adapter.js';
import { buildEmbeddingIdentity, buildEmbeddingIdentityKey } from '../../../src/shared/embedding-identity.js';
import { formatEmbeddingInput } from '../../../src/shared/embedding-input-format.js';
import {
  normalizeEmbeddingGemma2Output,
  resolveEmbeddingModelProfile
} from '../../../src/shared/embedding-model-profile.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1', embeddings: null });
const modelId = 'onnx-community/embeddinggemma-2-ONNX';
const profile = resolveEmbeddingModelProfile(modelId, { dtype: 'q8', dimensions: 128 });
assert.equal(resolveEmbeddingModelProfile('Xenova/all-MiniLM-L6-v2'), null);
assert.equal(resolveEmbeddingModelProfile(modelId).dimensions, 768);
assert.equal(resolveEmbeddingModelProfile(modelId).dtype, 'fp32');
for (const options of [{ dtype: 'fp16' }, { dtype: 'q4f16' }, { dimensions: 384 }, { dimensions: '128' }, { revision: '' }, { revision: 'main' }]) {
  assert.throws(() => resolveEmbeddingModelProfile(modelId, options));
}
assert.throws(() => getEmbeddingAdapter({ modelId, provider: 'onnx' }), /requires the xenova/);
assert.throws(() => getEmbeddingAdapter({ modelId, normalize: false }), /requires normalization/);
assert.equal(formatEmbeddingInput('find parser', { modelId, kind: 'query' }), 'task: code retrieval | query: find parser');
assert.equal(formatEmbeddingInput('return value;', { modelId }), 'title: none | text: return value;');
assert.equal(formatEmbeddingInput('task: code retrieval | query: find parser', { modelId, kind: 'query' }),
  'task: code retrieval | query: find parser');

const tensor = (rows = 1) => ({
  sentence_embedding: { dims: [rows, 768], data: new Float32Array(rows * 768).fill(1) },
  last_hidden_state: { dims: [rows, 2, 512], data: new Float32Array(rows * 1024).fill(99) }
});
for (const dimensions of [128, 256, 512, 768]) {
  const output = tensor(2);
  const vectors = normalizeEmbeddingGemma2Output(output, 2, dimensions);
  assert.equal(vectors.length, 2);
  assert.equal(vectors[0].length, dimensions);
  assert.ok(Math.abs(vectors[0].reduce((sum, value) => sum + value * value, 0) - 1) < 1e-6);
  assert.equal(output.sentence_embedding.data[0], 1, 'must not mutate model-owned output');
  vectors[0][0] = 7;
  assert.notEqual(vectors[1][0], 7, 'rows must not alias');
}
assert.throws(() => normalizeEmbeddingGemma2Output({ last_hidden_state: tensor().last_hidden_state }, 1, 128), /shape/);
assert.throws(() => normalizeEmbeddingGemma2Output(tensor(2), 1, 128), /shape/);
const nonfinite = tensor();
nonfinite.sentence_embedding.data[767] = NaN;
assert.throws(() => normalizeEmbeddingGemma2Output(nonfinite, 1, 128), /nonfinite/);
const zero = tensor();
zero.sentence_embedding.data.fill(0);
assert.throws(() => normalizeEmbeddingGemma2Output(zero, 1, 128), /norm/);

const identity = (options) => buildEmbeddingIdentity({ modelId, provider: 'xenova', modelProfile: options });
const baseIdentity = identity(profile);
assert.equal(baseIdentity.dims, 128);
assert.equal(baseIdentity.pooling, 'sentence_embedding');
const baseKey = buildEmbeddingIdentityKey(baseIdentity);
for (const changed of [{ ...profile, dimensions: 256 }, { ...profile, dtype: 'fp32' }, { ...profile, revision: 'a'.repeat(40) }]) {
  assert.notEqual(buildEmbeddingIdentityKey(identity(changed)), baseKey);
}
assert.equal('modelProfile' in buildEmbeddingIdentity({ modelId: 'legacy-model' }), false);

const calls = { loads: [], tokens: [], generic: 0 };
const fakeModule = {
  env: { version: '4.3.1' },
  EmbeddingGemma2Model: class {},
  AutoConfig: { from_pretrained: async () => ({ model_type: 'embedding_gemma2', vision_config: {}, audio_config: {} }) },
  AutoTokenizer: { from_pretrained: async () => async (texts, options) => {
    calls.tokens.push({ texts, options });
    return { count: texts.length };
  } },
  AutoModel: { from_pretrained: async (id, options) => {
    calls.loads.push({ id, options });
    return async ({ count }) => tensor(count);
  } },
  pipeline: async (task, id, options) => {
    calls.generic += 1;
    assert.deepEqual(options, { dtype: 'q8' }, 'existing model precision must remain unchanged');
    return async () => [[0.25, 0.5]];
  }
};
__setTransformersModuleLoaderForTests(async () => fakeModule);
try {
  const options = { modelId, provider: 'xenova', modelsDir: '/tmp/embeddinggemma2-model-test', modelProfile: profile };
  const adapter = getEmbeddingAdapter(options);
  assert.equal(adapter, getEmbeddingAdapter(options));
  const chunk = createEmbedder({ ...options, useStubEmbeddings: false });
  const results = await chunk.getChunkEmbeddings(['alpha', 'beta']);
  assert.equal(results[0].length, 128);
  const query = await getQueryEmbedding({ text: 'alpha', ...options, modelDir: options.modelsDir, dims: 128 });
  assert.equal(query.length, 128);
  assert.equal(calls.loads.length, 1, 'query and document wrappers should share matching model loads');
  assert.equal(calls.loads[0].options.config.vision_config, null);
  assert.equal(calls.loads[0].options.config.audio_config, null);
  assert.equal(calls.loads[0].options.dtype, 'q8');
  assert.equal(calls.loads[0].options.device, 'cpu');
  assert.deepEqual(calls.tokens[0].options, { padding: true, truncation: true, max_length: 8192 });
  assert.deepEqual(calls.tokens[0].texts, ['title: none | text: alpha', 'title: none | text: beta']);
  assert.deepEqual(calls.tokens[1].texts, ['task: code retrieval | query: alpha']);
  assert.equal(await getQueryEmbedding({ text: 'x', ...options, dims: 256 }), null,
    'mismatched dimensions must disable ANN instead of scoring incompatible vectors');
  await getEmbeddingAdapter({ ...options, modelProfile: { ...profile, dtype: 'q4' } }).embedOne('x');
  assert.equal(calls.loads.length, 2, 'different precision must not reuse the same loaded model');
  const offline = getEmbeddingAdapter({ ...options, localFilesOnly: true });
  assert.notEqual(offline, adapter, 'offline loading policy must not share an online adapter');
  await offline.embedOne('archive');
  assert.equal(calls.loads.at(-1).options.local_files_only, true);
  assert.equal(calls.loads.at(-1).options.cache_dir, options.modelsDir);
  await getEmbeddingAdapter({ modelId: 'legacy-model', provider: 'xenova' }).embedOne('x');
  assert.equal(calls.generic, 1);

  const cacheCalls = [];
  const resolve = createEmbeddingResolver({
    throwIfAborted: () => {}, embeddingQueryText: 'alpha', modelConfig: {},
    embeddingProvider: 'xenova', rootDir: process.cwd(),
    getQueryEmbeddingImpl: async (request) => { cacheCalls.push(request); return [1]; }
  });
  await resolve(modelId, 128, true, null, profile);
  await resolve(modelId, 128, true, null, profile);
  await resolve(modelId, 128, true, null, { ...profile, dtype: 'q4' });
  assert.equal(cacheCalls.length, 2);
  assert.deepEqual(cacheCalls[0].modelProfile, profile);

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'embeddinggemma2-runtime-'));
  try {
    const runtime = await resolveEmbeddingRuntime({
      rootDir: temp, userConfig: { cache: { root: temp } },
      indexingConfig: { embeddings: { mode: 'stub', provider: 'xenova', embeddinggemma2: { dimensions: 128, dtype: 'q8' } } },
      envConfig: {}, argv: { model: modelId }, cpuConcurrency: 1
    });
    assert.deepEqual(runtime.embeddingIdentity.modelProfile, profile);
    assert.equal(runtime.embeddingIdentity.dims, 128);
    assert.equal((await runtime.getChunkEmbedding('alpha')).length, 128);
    await getQueryEmbedding({ text: 'persisted', modelId, provider: 'xenova', dims: 128,
      modelProfile: runtime.embeddingIdentity.modelProfile,
      inputFormatting: runtime.embeddingIdentity.inputFormatting });
    assert.deepEqual(calls.tokens.at(-1).texts, ['task: code retrieval | query: persisted'],
      'persisted query formatting must preserve the separator byte');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
} finally {
  __setTransformersModuleLoaderForTests(null);
}

// Failed initialization must be retryable, without substituting a generic model.
let attempts = 0;
__setTransformersModuleLoaderForTests(async () => ({
  ...fakeModule,
  AutoModel: { from_pretrained: async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('temporary model initialization failure');
    return async ({ count }) => tensor(count);
  } }
}));
try {
  const adapter = getEmbeddingAdapter({ modelId, modelProfile: profile });
  await assert.rejects(() => adapter.embedOne('alpha'), /temporary model/);
  assert.equal((await adapter.embedOne('alpha')).length, 128);
  assert.equal(attempts, 2);
} finally {
  __setTransformersModuleLoaderForTests(null);
}

for (const moduleOverride of [
  { env: { version: '4.3.0' } },
  { AutoConfig: { from_pretrained: async () => ({ model_type: 'other' }) } }
]) {
  __setTransformersModuleLoaderForTests(async () => ({ ...fakeModule, ...moduleOverride }));
  try {
    await assert.rejects(() => getEmbeddingAdapter({ modelId }).embedOne('alpha'),
      /cache identity|unexpected model_type/);
  } finally {
    __setTransformersModuleLoaderForTests(null);
  }
}
console.log('EmbeddingGemma 2 text adapter, runtime, identity, and query-cache contracts passed');
