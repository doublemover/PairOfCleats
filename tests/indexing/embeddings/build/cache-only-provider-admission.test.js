#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { __setAdapterFactoryForTests, __resetEmbeddingAdapterCachesForTests } from '../../../../src/shared/embedding-adapter.js';
import { runBuildEmbeddingsWithConfig } from '../../../../tools/build/embeddings/runner.js';
import { parseBuildEmbeddingsArgs } from '../../../../tools/build/embeddings/args.js';
import { resolveCacheDir, readCacheIndex, writeCacheIndex } from '../../../../tools/build/embeddings/cache.js';
import { getRepoCacheRoot } from '../../../../src/shared/repo-paths.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';
import { runNode } from '../../../helpers/run-node.js';

const { dir } = await prepareIsolatedTestCacheDir('cache-only-provider-admission', { clean: true });
const repo = path.join(dir, 'repo'), models = path.join(dir, 'models');
const modelId = 'fixture/cache-only', modelDir = path.join(models, 'fixture', 'cache-only');
await fs.mkdir(repo, { recursive: true }); await fs.mkdir(modelDir, { recursive: true });
await fs.writeFile(path.join(repo, 'alpha.js'), '/** Alpha documentation. */\nexport const alpha = 1;\n');
await fs.writeFile(path.join(repo, 'beta.js'), '/** Beta documentation. */\nexport const beta = 2;\n');
// Synthetic bytes qualify byte identity only. An inert adapter owns execution;
// this fixture deliberately does not claim a decodable/native model.
const graph = path.join(modelDir, 'model.onnx'), tokenizer = path.join(modelDir, 'tokenizer.json');
await fs.writeFile(graph, 'inert graph bytes'); await fs.writeFile(tokenizer, '{"inert":1}');
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'real', testConfig: {
  threads: 1, sqlite: { use: false }, indexing: {
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false,
    scm: { provider: 'none' }, embeddings: { enabled: true, mode: 'inline', provider: 'xenova',
      hnsw: { enabled: false }, lancedb: { enabled: false } }
  }, tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
} });
runNode([path.resolve('build_index.js'), '--repo', repo, '--stage', 'stage2', '--mode', 'code',
  '--threads', '1', '--progress', 'off'], 'build cache-only canonical fixture', process.cwd(), env, { stdio: 'pipe' });
const cacheRepo = getRepoCacheRoot(repo), builds = path.join(cacheRepo, 'builds');
const children = (await fs.readdir(builds, { withFileTypes: true })).filter(value => value.isDirectory());
assert.equal(children.length, 1);
const indexRoot = path.join(builds, children[0].name), indexDir = path.join(indexRoot, 'index-code');
const cacheRoot = path.join(dir, 'embedding-cache');
const makeConfig = () => {
  const config = parseBuildEmbeddingsArgs(['--repo', repo, '--index-root', indexRoot, '--mode', 'code', '--progress', 'off', '--model', modelId]);
  config.modelsDir = models; config.embeddingProvider = 'onnx'; config.configuredDims = 4;
  config.argv.dims = 4; config.embeddingOnnx = { modelPath: graph, tokenizerId: modelId };
  config.embeddingsConfig.cache = { dir: cacheRoot };
  return config;
};
let loads = 0, probes = 0, calls = 0, disposals = 0;
const install = (provider = 'onnx', value = 0.25) => __setAdapterFactoryForTests(() => {
  loads++;
  return { provider, embedderPromise: null, embed: async texts => {
    calls++; if (texts.some(text => text.includes('pairofcleats-provider-probe'))) probes++;
    return texts.map(() => new Float32Array([value, 0.2, 0.3, 0.4]));
  }, dispose: async () => { disposals++; } };
});
const state = async () => JSON.parse(await fs.readFile(path.join(indexDir, 'index_state.json'), 'utf8'));
const attempt = async () => JSON.parse(await fs.readFile(path.join(indexRoot, 'build_state.json'), 'utf8')).runtime.attempts.at(-1);
try {
  install();
  await runBuildEmbeddingsWithConfig(makeConfig());
  assert.equal(loads, 1); assert.equal(probes, 1); assert.equal(disposals, 1);
  const firstState = await state(), firstBytes = await fs.readFile(path.join(indexDir, 'dense_vectors_uint8.bin'));
  const before = { loads, probes, calls, disposals };
  __setAdapterFactoryForTests(() => { throw Error('cache-only path attempted to construct a provider'); });
  await runBuildEmbeddingsWithConfig(makeConfig());
  assert.deepEqual({ loads, probes, calls, disposals }, before, 'complete verified cache coverage never constructs or probes a model');
  assert.deepEqual(await fs.readFile(path.join(indexDir, 'dense_vectors_uint8.bin')), firstBytes);
  const cached = await attempt();
  assert.equal(cached.embeddings.observation.state, 'cache-only');
  assert.equal(cached.embeddings.observation.provider, null);
  assert.equal(cached.embeddings.observation.dims, null, 'persisted dimensions are not current execution observations');
  assert.equal(cached.embeddings.observation.method, 'validated-cache-reuse');
  assert.equal(cached.runtime.providerMeasurement.execution.loaded, false);
  assert.equal(cached.runtime.providerMeasurement.stage3.cachePreflight.eligible, true);
  assert.equal(cached.runtime.providerMeasurement.stage3.cachePreflight.work.modesChecked, 1);
  assert.equal(cached.runtime.providerMeasurement.stage3.vectorSpool.closed, true);
  assert.equal(cached.runtime.providerMeasurement.stage3.vectorSpool.pendingWrites, 0);
  assert.equal(cached.runtime.providerMeasurement.stage3.vectorSpool.retainedCorpusVectorBytes, 0);
  assert.equal((await fs.readdir(indexDir)).some(name => name.startsWith('.stage3-vector-spool-')), false);

  const identity = firstState.embeddings.embeddingIdentity;
  const fileDir = resolveCacheDir(cacheRoot, identity, 'code');
  const index = await readCacheIndex(fileDir, firstState.embeddings.embeddingIdentityKey, { strict: true });
  const missing = index.files['beta.js']; assert.ok(missing);
  delete index.entries[missing]; delete index.files['beta.js'];
  await writeCacheIndex(fileDir, index);
  install();
  const beforeMiss = probes;
  await runBuildEmbeddingsWithConfig(makeConfig());
  assert.equal(probes, beforeMiss + 1, 'one missing file triggers the probe before accepting any mixed generation');
  assert.equal((await attempt()).runtime.providerMeasurement.stage3.cachePreflight.eligible, false);
  assert.equal((await attempt()).embeddings.observation.method, 'provider-probe');

  const unknownDims = makeConfig(); unknownDims.configuredDims = null; delete unknownDims.argv.dims;
  const beforeUnknown = probes;
  await runBuildEmbeddingsWithConfig(unknownDims);
  assert.equal(probes, beforeUnknown + 1, 'unknown width cannot select cache-only from a previous entry');
  assert.equal((await state()).embeddings.embeddingIdentity.dims, 4);
  await fs.writeFile(tokenizer, '{"inert":2}');
  const beforeTokenizer = probes;
  await runBuildEmbeddingsWithConfig(makeConfig());
  assert.equal(probes, beforeTokenizer + 1, 'changed tokenizer bytes invalidate cache-only selection');
  assert.notEqual((await state()).embeddings.embeddingIdentityKey, firstState.embeddings.embeddingIdentityKey);

  // Fallback must select fresh cache authority before old ONNX rows are mixed.
  await fs.writeFile(graph, 'changed inert graph bytes');
  install('xenova', 0.75);
  const beforeFallback = probes;
  await runBuildEmbeddingsWithConfig(makeConfig());
  assert.equal(probes, beforeFallback + 1);
  assert.equal((await state()).embeddings.embeddingIdentity.provider, 'xenova');
  assert.equal((await state()).embeddings.cacheStats.hits, 0);
  assert.notDeepEqual(await fs.readFile(path.join(indexDir, 'dense_vectors_uint8.bin')), firstBytes);
} finally { __resetEmbeddingAdapterCachesForTests(); }
console.log('cache-only provider admission, missing coverage and fallback identity assertions complete');
