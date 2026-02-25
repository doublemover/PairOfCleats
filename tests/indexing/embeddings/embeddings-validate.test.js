#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const cacheRoot = resolveTestCachePath(root, 'embeddings-validate');
const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' }
    }
  }
});

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const buildPath = path.join(root, 'build_index.js');
const embeddingsPath = path.join(root, 'tools', 'build/embeddings.js');

const run = (args, label) => {
  const result = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result.stdout || '';
};

run([buildPath, '--stub-embeddings', '--stage', 'stage2', '--repo', fixtureRoot], 'build index');
run([embeddingsPath, '--stub-embeddings', '--repo', fixtureRoot], 'build embeddings');

const previousCacheRoot = process.env.PAIROFCLEATS_CACHE_ROOT;
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
const userConfig = loadUserConfig(fixtureRoot);
const codeDir = getIndexDir(fixtureRoot, 'code', userConfig);
const indexRoot = path.dirname(codeDir);
if (previousCacheRoot === undefined) {
  delete process.env.PAIROFCLEATS_CACHE_ROOT;
} else {
  process.env.PAIROFCLEATS_CACHE_ROOT = previousCacheRoot;
}
const payload = await validateIndexArtifacts({
  root: fixtureRoot,
  indexRoot,
  modes: ['code', 'prose', 'extracted-prose', 'records'],
  userConfig,
  sqliteEnabled: false,
  strict: true
});
if (!payload || payload.ok !== true) {
  console.error('Expected index validation to pass after build-embeddings.');
  if (Array.isArray(payload?.issues) && payload.issues.length) {
    payload.issues.slice(0, 10).forEach((issue) => console.error(`- ${issue}`));
  }
  process.exit(1);
}
const statePath = path.join(codeDir, 'index_state.json');
let state;
try {
  state = JSON.parse(await fsPromises.readFile(statePath, 'utf8'));
} catch {
  console.error('Failed to read index_state.json after build-embeddings.');
  process.exit(1);
}
const embeddings = state?.embeddings || {};
if (embeddings.enabled !== true || embeddings.ready !== true || embeddings.pending === true) {
  console.error('index_state embeddings flags not marked ready after build-embeddings.');
  process.exit(1);
}
if (!embeddings.embeddingIdentity || typeof embeddings.embeddingIdentity !== 'object') {
  console.error('index_state embeddings missing embeddingIdentity after build-embeddings.');
  process.exit(1);
}
if (!embeddings.embeddingIdentityKey || typeof embeddings.embeddingIdentityKey !== 'string') {
  console.error('index_state embeddings missing embeddingIdentityKey after build-embeddings.');
  process.exit(1);
}
const backends = embeddings.backends || null;
if (!backends || typeof backends !== 'object') {
  console.error('index_state embeddings missing backends after build-embeddings.');
  process.exit(1);
}
if (!('hnsw' in backends) || !('lancedb' in backends) || !('sqliteVec' in backends)) {
  console.error('index_state embeddings backends missing expected keys.');
  process.exit(1);
}

const denseBinaryArtifacts = [
  {
    binPath: path.join(codeDir, 'dense_vectors_uint8.bin'),
    metaPath: path.join(codeDir, 'dense_vectors_uint8.bin.meta.json')
  },
  {
    binPath: path.join(codeDir, 'dense_vectors_doc_uint8.bin'),
    metaPath: path.join(codeDir, 'dense_vectors_doc_uint8.bin.meta.json')
  },
  {
    binPath: path.join(codeDir, 'dense_vectors_code_uint8.bin'),
    metaPath: path.join(codeDir, 'dense_vectors_code_uint8.bin.meta.json')
  }
];
for (const { binPath, metaPath } of denseBinaryArtifacts) {
  let denseMetaPayload;
  try {
    denseMetaPayload = JSON.parse(await fsPromises.readFile(metaPath, 'utf8'));
  } catch {
    console.error(`Failed to read ${metaPath}.`);
    process.exit(1);
  }
  const fields = denseMetaPayload?.fields || denseMetaPayload || {};
  if (!Number.isFinite(fields.minVal)) {
    console.error(`dense vectors missing minVal in ${metaPath}.`);
    process.exit(1);
  }
  if (!Number.isFinite(fields.maxVal)) {
    console.error(`dense vectors missing maxVal in ${metaPath}.`);
    process.exit(1);
  }
  if (!Number.isFinite(fields.levels)) {
    console.error(`dense vectors missing levels in ${metaPath}.`);
    process.exit(1);
  }
  const dims = Number(fields.dims);
  const count = Number(fields.count);
  if (!Number.isFinite(dims) || dims <= 0 || !Number.isFinite(count) || count < 0) {
    console.error(`dense vectors missing dims/count in ${metaPath}.`);
    process.exit(1);
  }
  let binStat;
  try {
    binStat = await fsPromises.stat(binPath);
  } catch {
    console.error(`Failed to stat ${binPath}.`);
    process.exit(1);
  }
  const expectedBytes = Math.floor(dims) * Math.floor(count);
  if (binStat.size < expectedBytes) {
    console.error(`dense vectors payload too small in ${binPath} (${binStat.size} < ${expectedBytes}).`);
    process.exit(1);
  }
}

console.log('Stage3 embeddings validation test passed');

