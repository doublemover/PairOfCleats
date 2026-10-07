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

const { dir: tempRoot } = await prepareIsolatedTestCacheDir('embedding-inferred-dimensions', { clean: true });
const repoRoot = path.join(tempRoot, 'repo');
await fs.mkdir(repoRoot, { recursive: true });
const source = 'export const alpha = 1;\n';
await fs.writeFile(path.join(repoRoot, 'alpha.js'), source);
const env = applyTestEnv({
  cacheRoot: path.join(tempRoot, 'cache'),
  embeddings: 'real',
  testConfig: {
    threads: 1,
    sqlite: { use: false },
    indexing: {
      typeInference: false,
      typeInferenceCrossFile: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false,
      scm: { provider: 'none' },
      embeddings: { enabled: true, mode: 'inline', provider: 'xenova', hnsw: { enabled: false }, lancedb: { enabled: false } }
    },
    tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
  }
});
runNode([
  path.resolve('build_index.js'), '--repo', repoRoot, '--stage', 'stage2',
  '--mode', 'code', '--threads', '1', '--progress', 'off'
], 'build canonical dimension fixture', process.cwd(), env, { stdio: 'pipe' });
const buildsDir = path.join(getRepoCacheRoot(repoRoot), 'builds');
const builds = (await fs.readdir(buildsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory());
assert.equal(builds.length, 1, 'fixture owns exactly one isolated build');
const indexRoot = path.join(buildsDir, builds[0].name);
const indexDir = path.join(indexRoot, 'index-code');
let calls = 0;
const embed = async (texts) => {
  calls += 1;
  return texts.map(() => new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]));
};
__setAdapterFactoryForTests(() => ({ embed, embedOne: async () => (await embed(['alpha']))[0], embedderPromise: null, provider: 'xenova' }));
try {
  for (let run = 0; run < 2; run += 1) {
    const config = parseBuildEmbeddingsArgs(['--repo', repoRoot, '--index-root', indexRoot, '--mode', 'code', '--progress', 'off']);
    assert.equal(config.configuredDims, null);
    assert.equal(config.useStubEmbeddings, false);
    await runBuildEmbeddingsWithConfig(config);
    const state = JSON.parse(await fs.readFile(path.join(indexDir, 'index_state.json'), 'utf8'));
    const vectors = JSON.parse(await fs.readFile(path.join(indexDir, 'dense_vectors_uint8.meta.json'), 'utf8'));
    assert.equal(state.embeddings.ready, true);
    assert.equal(state.embeddings.pending, false);
    assert.equal(state.embeddings.embeddingIdentity.dims, 5);
    assert.equal(vectors.dims, 5);
    assert.equal(state.embeddings.embeddingIdentityKey, buildEmbeddingIdentityKey(state.embeddings.embeddingIdentity));
    if (run === 1) assert(state.embeddings.cacheStats.hits > 0, 'inferred identity must be reusable on a warm run');
  }
  assert(calls > 0, 'real-provider adapter must be exercised');
} finally {
  __resetEmbeddingAdapterCachesForTests();
}
console.log('inferred embedding dimensions identity/cache regression passed');
