#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { __setAdapterFactoryForTests, __resetEmbeddingAdapterCachesForTests } from '../../../../src/shared/embedding-adapter.js';
import { buildEmbeddingIdentityKey } from '../../../../src/shared/embedding-identity.js';
import { parseBuildEmbeddingsArgs } from '../../../../tools/build/embeddings/args.js';
import { runBuildEmbeddingsWithConfig } from '../../../../tools/build/embeddings/runner.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';
import { runNode } from '../../../helpers/run-node.js';
import { getRepoCacheRoot } from '../../../../src/shared/repo-paths.js';

const { dir: tempRoot } = await prepareIsolatedTestCacheDir('embeddinggemma2-profile-cache', { clean: true });
const repoRoot = path.join(tempRoot, 'repo');
await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, 'alpha.js'), 'export const alpha = 1;\n');
const env = applyTestEnv({
  cacheRoot: path.join(tempRoot, 'cache'), embeddings: 'real',
  testConfig: {
    threads: 1, sqlite: { use: false },
    indexing: {
      typeInference: false, typeInferenceCrossFile: false,
      riskAnalysis: false, riskAnalysisCrossFile: false,
      scm: { provider: 'none' },
      embeddings: { enabled: true, mode: 'inline', provider: 'xenova', hnsw: { enabled: false }, lancedb: { enabled: false } }
    },
    tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
  }
});
runNode([
  path.resolve('build_index.js'), '--repo', repoRoot, '--stage', 'stage2',
  '--mode', 'code', '--threads', '1', '--progress', 'off'
], 'build model-profile fixture', process.cwd(), env, { stdio: 'pipe' });
const buildsDir = path.join(getRepoCacheRoot(repoRoot), 'builds');
const builds = (await fs.readdir(buildsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory());
assert.equal(builds.length, 1);
const indexRoot = path.join(buildsDir, builds[0].name);
const indexDir = path.join(indexRoot, 'index-code');
const modelId = 'onnx-community/embeddinggemma-2-ONNX';
const profilesSeen = [];
let calls = 0;
__setAdapterFactoryForTests((options) => {
  profilesSeen.push(options.modelProfile);
  const embed = async (texts) => {
    calls += 1;
    return texts.map(() => new Float32Array(options.modelProfile.dimensions).fill(1 / Math.sqrt(options.modelProfile.dimensions)));
  };
  return { embed, embedOne: async () => (await embed(['alpha']))[0], embedderPromise: null, provider: 'xenova' };
});
try {
  let firstIdentityKey = null;
  for (const [run, dtype] of ['q8', 'q8', 'q4'].entries()) {
    const config = parseBuildEmbeddingsArgs([
      '--repo', repoRoot, '--index-root', indexRoot, '--mode', 'code', '--progress', 'off', '--model', modelId
    ]);
    config.embeddingsConfig.embeddinggemma2 = { dtype, dimensions: 128 };
    const callsBefore = calls;
    await runBuildEmbeddingsWithConfig(config);
    const state = JSON.parse(await fs.readFile(path.join(indexDir, 'index_state.json'), 'utf8'));
    const vectors = JSON.parse(await fs.readFile(path.join(indexDir, 'dense_vectors_uint8.meta.json'), 'utf8'));
    const identity = state.embeddings.embeddingIdentity;
    assert.equal(identity.modelProfile.dtype, dtype);
    assert.equal(identity.modelProfile.dimensions, 128);
    assert.equal(identity.dims, 128);
    assert.equal(identity.inputFormatting.queryPrefix, 'task: code retrieval | query: ');
    assert.equal(vectors.dims, 128);
    assert.equal(state.embeddings.embeddingIdentityKey, buildEmbeddingIdentityKey(identity));
    assert.equal(state.embeddings.ready, true);
    if (run === 0) firstIdentityKey = state.embeddings.embeddingIdentityKey;
    if (run === 1) {
      assert(state.embeddings.cacheStats.hits > 0, 'matching profile should reuse cached embeddings');
      assert.equal(state.embeddings.embeddingIdentityKey, firstIdentityKey);
    }
    if (run === 2) {
      assert.notEqual(state.embeddings.embeddingIdentityKey, firstIdentityKey);
      assert(calls > callsBefore, 'changed precision must run inference instead of reusing the old space');
    }
  }
  assert.deepEqual(profilesSeen.map((entry) => entry.dtype), ['q8', 'q4']);
} finally {
  __resetEmbeddingAdapterCachesForTests();
}
console.log('EmbeddingGemma 2 standalone build/profile/cache isolation passed');
