#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { runSearchSession } from '../../../src/retrieval/cli/run-search-session.js';
import { buildEmbeddingIdentity } from '../../../src/shared/embedding-identity.js';
import { __setAdapterFactoryForTests } from '../../../src/shared/embedding-adapter.js';
import { MINHASH_HASH_IDENTITY, SimpleMinHash } from '../../../src/index/minhash.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { buildAnnPipelineFixture } from './helpers/ann-scenarios.js';

const { dir } = await prepareIsolatedTestCacheDir('default-ann-sparse-artifact-availability');
let providerCalls = 0;
__setAdapterFactoryForTests(() => {
  providerCalls++;
  throw new Error('This fixture must not initialize a neural provider.');
});
const signature = tokens => {
  const hash = new SimpleMinHash();
  for (const token of tokens) hash.update(token);
  return hash.hashValues;
};
const identity = buildEmbeddingIdentity({ modelId: 'unverified-model', provider: 'xenova', dims: 2 });
const run = (context, idx, extra = {}) => runSearchSession({
  ...context, rootDir: dir, metricsDir: dir, userConfig: { retrieval: { ann: { adaptiveProviders: false } } },
  query: 'alpha', embeddingQueryText: 'alpha', searchMode: 'code', runCode: true,
  runProse: false, runExtractedProse: false, runRecords: false,
  idxCode: idx, annActive: true, cacheFilters: {}, queryCacheEnabled: false,
  modelConfig: { dir }, modelIds: { code: identity.modelId },
  embeddingProvider: 'xenova', useStubEmbeddings: false,
  annDiscovery: 'independent', backendLabel: 'memory', ...extra
});
try {
  const { context, idx, stageTracker } = buildAnnPipelineFixture();
  idx.denseVec = null;
  idx.state = { embeddings: { enabled: false, ready: false, embeddingIdentity: identity } };
  idx.minhash = { hashIdentity: MINHASH_HASH_IDENTITY, signatures: [signature(['alpha']), signature(['alpha', 'beta'])] };
  let probes = 0;
  idx.loadDenseVectors = async () => { probes++; return null; };
  const sparse = await run(context, idx);
  assert.ok(sparse.codeHits.length > 0, 'default ANN preserves sparse hits for embedding-off data');
  assert.equal(probes, 1, 'lazy loader capability is verified before query embedding selection');
  assert.equal(providerCalls, 0);
  assert.equal(stageTracker.stages.find(stage => stage.stage === 'ann').source, 'minhash', 'independent MinHash remains available without neural vectors');
  probes = 0;
  await run(context, idx, { annActive: false });
  assert.equal(probes, 0, 'explicit sparse search performs no lazy dense probe');

  const present = buildAnnPipelineFixture();
  present.idx.state = { embeddings: { enabled: true, ready: true, embeddingIdentity: identity } };
  await assert.rejects(run(present.context, present.idx), { code: 'ERR_EMBEDDING_ARTIFACT_INCOMPATIBLE' });
  assert.equal(providerCalls, 0, 'a real dense payload with unknown identity fails before provider initialization');
  const lazy = buildAnnPipelineFixture();
  const payload = lazy.idx.denseVec;
  lazy.idx.denseVec = null;
  lazy.idx.state = present.idx.state;
  lazy.idx.loadDenseVectors = async () => { lazy.idx.denseVec = payload; return payload; };
  await assert.rejects(run(lazy.context, lazy.idx), { code: 'ERR_EMBEDDING_ARTIFACT_INCOMPATIBLE' });
  const readyBackend = buildAnnPipelineFixture();
  readyBackend.idx.denseVec = null;
  readyBackend.idx.state = present.idx.state;
  readyBackend.context.vectorAnnState.code.available = true;
  readyBackend.idx.loadDenseVectors = async () => { assert.fail('a concrete available backend does not require eager dense fallback materialization'); };
  await assert.rejects(run(readyBackend.context, readyBackend.idx), { code: 'ERR_EMBEDDING_ARTIFACT_INCOMPATIBLE' });
} finally {
  __setAdapterFactoryForTests(null);
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Default ANN verifies lazy dense availability while preserving sparse/MinHash and explicit unknown dense rejection.');
