#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';
import { resolveHnswPaths } from '../src/shared/hnsw.js';
import { loadChunkMeta, readJsonFile } from '../src/shared/artifact-io.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, 'tests', '.cache', 'hnsw-atomic');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const buildIndex = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
if (buildIndex.status !== 0) {
  console.error('hnsw atomic test failed: build_index failed');
  process.exit(buildIndex.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
const codeIndexDir = getIndexDir(repoRoot, 'code', userConfig);
const { indexPath: hnswIndexPath, metaPath: hnswMetaPath } = resolveHnswPaths(codeIndexDir);

await fsPromises.writeFile(hnswIndexPath, 'stub-index');
await fsPromises.writeFile(hnswMetaPath, JSON.stringify({ version: 1, dims: 1, count: 0 }));

const buildEmbeddings = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'build-embeddings.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
if (buildEmbeddings.status !== 0) {
  console.error('hnsw atomic test failed: build-embeddings failed');
  process.exit(buildEmbeddings.status ?? 1);
}

if (!fs.existsSync(`${hnswIndexPath}.bak`)) {
  console.error('hnsw atomic test failed: expected .bak for HNSW index after replace');
  process.exit(1);
}

const chunkMeta = loadChunkMeta(codeIndexDir);
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

console.log('hnsw atomic tests passed');
