import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/build-index.js';
import { getIndexDir, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { resolveLanceDbPaths } from '../../../src/shared/lancedb.js';
import { clearLanceDbConnectionCache, rankLanceDb } from '../../../src/retrieval/lancedb.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// Real native creation, closed-payload publication and a query after relocation.
// Keep the ordinary generation layout, including long Windows final paths.
const { dir } = await prepareIsolatedTestCacheDir('lance-generation');
const repo = path.join(dir, 'repository');
await fs.mkdir(repo);
await fs.writeFile(path.join(repo, 'answer.js'), 'export function nativeGenerationAnswer() { return 42; }\n');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'stub',
  testConfig: { threads: 1, quality: 'fast', indexing: { typeInference: false, typeInferenceCrossFile: false,
    riskAnalysis: false, scm: { provider: 'none' } }, tooling: { autoEnableOnDetect: false, lsp: { enabled: false } } } });
try {
  const built = await buildIndex(repo, { modes: ['code'], threads: 1, stubEmbeddings: true, progress: 'off', log: () => {} });
  assert.equal(built.outcome.status, 'index-published');
  const indexDir = getIndexDir(repo, 'code', loadUserConfig(repo));
  const state = JSON.parse(await fs.readFile(path.join(indexDir, 'index_state.json'), 'utf8'));
  const backend = state.embeddings.backends.lancedb;
  assert.equal(backend.enabled, true);
  assert.equal(backend.available, true, 'native write failure cannot be relabeled as optional success');
  assert.ok(backend.count > 0);
  const files = resolveLanceDbPaths(path.join(indexDir, backend.backendGeneration))[backend.target];
  const meta = JSON.parse(await fs.readFile(files.metaPath, 'utf8'));
  assert.equal(meta.embeddingGeneration, state.embeddings.embeddingGeneration);
  if (process.platform === 'win32') assert.ok(path.join(files.dir, 'vectors.lance', 'data').length > 260,
    'read the real published generation beyond MAX_PATH without changing security settings');
  const queryEmbedding = Array(meta.dims).fill(0); queryEmbedding[0] = 1;
  const hits = await rankLanceDb({ lancedbInfo: { available: true, dir: files.dir, meta }, queryEmbedding, topN: 1 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].idx, 0, 'query the independently indexed source after the native stage has moved');
} finally {
  await clearLanceDbConnectionCache();
}
console.log('Native LanceDB generation writes, closes, publishes and queries through the ordinary long-path layout.');
