import assert from 'node:assert/strict';
import { getQueryEmbedding } from '../../../src/retrieval/embedding.js';
import { __setAdapterFactoryForTests, disposeEmbeddingAdapterCaches } from '../../../src/shared/embedding-adapter.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ embeddings: null });
const modelId = 'intfloat/multilingual-e5-large-instruct';
let creates = 0, closed = 0, inputs = [];
const vector = new Float32Array(1024); vector[0] = 1;
const artifact = { status: 'verified', reuse: 'allow', digest: 'a'.repeat(64), revision: 'c9e87c786ffac96aeaeb42863276930883923ecb' };
const query = extra => getQueryEmbedding({ text: 'find parser', modelId, dims: 1024, provider: 'xenova',
  modelArtifact: artifact, normalize: true, ...extra });
const warnings = [], originalWarn = console.warn;
__setAdapterFactoryForTests(() => {
  creates++;
  return { provider: 'xenova', embedOne: async text => { inputs.push(text); return vector; },
    executionInfo: () => ({ provider: 'xenova', requestedProvider: 'xenova', stub: false, modelArtifact: artifact }),
    dispose() { closed++; } };
});
try {
  console.warn = value => warnings.push(String(value));
  assert.equal(await query({ inputFormatting: { family: 'e5', queryPrefix: 'query: ', passagePrefix: 'passage: ' } }), null);
  assert.equal(creates, 0, 'stale persisted formatting cannot acquire a lease outside its cleanup scope');
  assert.equal(closed, 0); assert.equal(inputs.length, 0);
  assert.equal(warnings.length, 1); assert.match(warnings[0], /Rebuild the dense index/);
  assert.deepEqual(await query({}), vector);
  assert.equal(creates, 1);
  assert.deepEqual(inputs, ['Instruct: Given a code search query, retrieve relevant source code or documentation passages that answer the query\nQuery: find parser']);
  await disposeEmbeddingAdapterCaches(); assert.equal(closed, 1, 'valid query keeps its original adapter lifecycle');
} finally { console.warn = originalWarn; await disposeEmbeddingAdapterCaches(); __setAdapterFactoryForTests(null); }
console.log('Stale persisted query formatting rejects before adapter admission;valid query cleanup remains owned.');
