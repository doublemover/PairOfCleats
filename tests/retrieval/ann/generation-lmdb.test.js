import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { open } from 'lmdb';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { runNode } from '../../helpers/run-node.js';
import { getIndexDir, loadUserConfig, resolveLmdbPaths } from '../../../tools/shared/dict-utils.js';
import { createLmdbHelpers } from '../../../src/retrieval/lmdb-helpers.js';

const checkout = process.cwd();
const { dir: root } = await prepareIsolatedTestCacheDir('ann-generation-lmdb');
const repo = path.join(root, 'repo');
await fs.mkdir(repo);
await fs.writeFile(path.join(repo, 'sample.js'), [
  'export function lmdbGenerationWitness() {',
  '  // Computes the fixture answer inside the indexed function span.',
  '  return 42;',
  '}',
  ''
].join('\n'));
const env = applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'stub', testConfig: {
  indexing: { scm: { provider: 'none' }, typeInference: false, typeInferenceCrossFile: false,
    riskAnalysis: false, riskAnalysisCrossFile: false,
    embeddings: { binaryDenseVectors: false, hnsw: { enabled: true }, lancedb: { enabled: false } } },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
} });
const invoke = (script, args) => runNode([path.join(checkout, script), ...args], script, repo, env,
  { stdio: 'pipe', timeoutMs: 30000 });
invoke('build_index.js', ['--repo', repo, '--mode', 'code', '--stage', 'stage1', '--stub-embeddings']);
invoke('tools/build/embeddings.js', ['--repo', repo, '--mode', 'code', '--stub-embeddings']);
invoke('tools/build/lmdb-index.js', ['--repo', repo, '--mode', 'code']);
const config = loadUserConfig(repo);
const indexDir = getIndexDir(repo, 'code', config);
const dbPath = resolveLmdbPaths(repo, config).codePath;
const db = open({ path: dbPath, readOnly: true });
try {
  for (const target of ['merged', 'doc', 'code']) {
    const helpers = createLmdbHelpers({ getDb: () => db, hnswConfig: { enabled: true },
      denseVectorMode: target, indexDirs: { code: indexDir } });
    const index = helpers.loadIndexFromLmdb('code', { includeFilterIndex: false, includeMinhash: false });
    assert.equal(index.hnsw.available, true, `${target}: actual LMDB build retains the generation-bound native metadata`);
    assert.equal(index.hnsw.meta.variant, target);
    assert.equal(index.hnsw.meta.embeddingGeneration, index.state.embeddings.embeddingGeneration);
    assert.equal(index.hnsw.index.getCurrentCount(), index.hnsw.meta.count);
  }
} finally { await db.close(); }
console.log('A real LMDB build and all three native retrieval variants retain the committed generation binding.');
