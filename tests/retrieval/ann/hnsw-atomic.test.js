#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { loadHnswIndex, normalizeHnswConfig, resolveHnswPaths } from '../../../src/shared/hnsw.js';
import { loadChunkMeta, readJsonFile } from '../../../src/shared/artifact-io.js';
import { requireHnswLib } from '../../helpers/optional-deps.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const root = process.cwd();
const { dir: tempRoot } = await prepareIsolatedTestCacheDir('hnsw-atomic', { root });
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

requireHnswLib({ reason: 'hnswlib-node not available; skipping hnsw atomic test.' });

await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'main.js'),
  'export function indexItem(value) { return value + 1; }\n',
  'utf8'
);
await fsPromises.writeFile(
  path.join(repoRoot, 'README.md'),
  '# HNSW Atomic Fixture\n\nThis fixture keeps the ANN atomicity contract minimal.\n',
  'utf8'
);

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  syncProcess: true,
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      embeddings: {
        hnsw: {
          enabled: true,
          isolate: false
        }
      },
      typeInference: false,
      typeInferenceCrossFile: false
    },
    tooling: {
      autoEnableOnDetect: false,
      lsp: { enabled: false }
    }
  },
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off'
  }
});

runNode(
  [
    path.join(root, 'build_index.js'),
    '--stub-embeddings',
    '--scm-provider',
    'none',
    '--stage',
    'stage1',
    '--mode',
    'code',
    '--repo',
    repoRoot
  ],
  'hnsw atomic build index',
  repoRoot,
  env,
  { stdio: 'inherit' }
);

const userConfig = loadUserConfig(repoRoot);
const codeIndexDir = getIndexDir(repoRoot, 'code', userConfig);
const { indexPath: hnswIndexPath, metaPath: hnswMetaPath } = resolveHnswPaths(codeIndexDir);

await fsPromises.writeFile(hnswIndexPath, 'stub-index');
await fsPromises.writeFile(hnswMetaPath, JSON.stringify({ version: 1, dims: 1, count: 0 }));

runNode(
  [path.join(root, 'tools', 'build/embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot],
  'hnsw atomic build embeddings',
  repoRoot,
  env,
  { stdio: 'inherit' }
);

await fsPromises.copyFile(hnswIndexPath, `${hnswIndexPath}.bak`);

const chunkMeta = await loadChunkMeta(codeIndexDir);
const meta = readJsonFile(hnswMetaPath);
if (!Number.isFinite(meta?.count) || !Number.isFinite(meta?.expectedCount)) {
  console.error('hnsw atomic test failed: missing count fields in HNSW meta');
  process.exit(1);
}
if (meta.count !== meta.expectedCount) {
  console.error(`hnsw atomic test failed: count mismatch (${meta.count} vs ${meta.expectedCount})`);
  process.exit(1);
}
if (meta.count !== chunkMeta.length) {
  console.error(`hnsw atomic test failed: expected ${chunkMeta.length} vectors, got ${meta.count}`);
  process.exit(1);
}

const hnswConfig = normalizeHnswConfig(userConfig.indexing?.embeddings?.hnsw || {});
await fsPromises.writeFile(hnswIndexPath, 'corrupt');
const fallbackIndex = loadHnswIndex({
  indexPath: hnswIndexPath,
  dims: meta.dims,
  config: hnswConfig,
  meta
});
if (!fallbackIndex) {
  console.error('hnsw atomic test failed: expected .bak fallback to load');
  process.exit(1);
}

console.log('hnsw atomic tests passed');

