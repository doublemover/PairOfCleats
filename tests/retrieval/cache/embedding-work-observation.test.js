#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { createEmbeddingResolver } from '../../../src/retrieval/cli/run-search-session/embedding-cache.js';
import { createRetrievalWorkObservation, isRetrievalModelObservation } from '../../../src/contracts/retrieval-work.js';
import { EMBEDDING_IDENTITY_VERSION } from '../../../src/shared/embedding-identity.js';

let calls = 0;
const encode = async input => { calls++; assert.equal(input.useStub, true); return new Float32Array(8).fill(0.25); };
const makeWork = createRetrievalWorkObservation;
const makeResolver = work => createEmbeddingResolver({ throwIfAborted() {}, embeddingQueryText: 'frozen query',
  modelConfig: { dir: path.resolve('.tmp/no-model-acquisition') }, useStubEmbeddings: true, embeddingProvider: 'xenova',
  embeddingOnnx: {}, rootDir: process.cwd(), generation: { buildId: 'one' }, getQueryEmbeddingImpl: encode, work });
const cold = makeWork();
const first = await makeResolver(cold)('declared-stub', 8, true, { family: 'default' }, null, null, 'code');
assert.equal(first.length, 8); assert.equal(calls, 1);
assert.equal(cold.embeddingRequests, 1); assert.equal(cold.embeddingApiCalls, 1); assert.equal(cold.embeddingCacheHits, 0);
assert.equal(isRetrievalModelObservation(cold.models.code), true);
assert.equal(cold.models.code.dimensions, 8); assert.equal(cold.models.code.stub, true);
assert.equal(cold.models.code.provider, 'stub');
assert.equal(cold.models.code.artifactIdentity, `stub:embeddings-v${EMBEDDING_IDENTITY_VERSION}`);
const warm = makeWork();
const second = await makeResolver(warm)('declared-stub', 8, true, { family: 'default' }, null, null, 'code');
assert.equal(second, first); assert.equal(calls, 1, 'warm query-embedding reuse must not be reported as another API computation');
assert.equal(warm.embeddingRequests, 1); assert.equal(warm.embeddingApiCalls, 0); assert.equal(warm.embeddingCacheHits, 1);
assert.deepEqual(warm.models.code, cold.models.code);
const changed = makeWork();
await makeResolver(changed)('declared-stub', 8, true, { family: 'default', queryPrefix: 'query: ' }, null, null, 'code');
assert.equal(calls, 2); assert.equal(changed.embeddingApiCalls, 1);
assert.notEqual(changed.models.code.inputFormatIdentity, cold.models.code.inputFormatIdentity);
assert.equal(isRetrievalModelObservation({ ...cold.models.code, dimensions: null }), false);
assert.equal(isRetrievalModelObservation({ ...cold.models.code, stub: false }), false);
console.log('Query embedding work records actual API calls/cache reuse and canonical artifact/format observations without model acquisition.');
