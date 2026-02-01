#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../../tools/dict-utils.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const cacheRoot = path.join(root, '.testCache', 'embeddings-validate');
const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const buildPath = path.join(root, 'build_index.js');
const embeddingsPath = path.join(root, 'tools', 'build-embeddings.js');
const validatePath = path.join(root, 'tools', 'index-validate.js');

const run = (args, label) => {
  const result = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result.stdout || '';
};

run([buildPath, '--stub-embeddings', '--repo', fixtureRoot], 'build index');
run([embeddingsPath, '--stub-embeddings', '--repo', fixtureRoot], 'build embeddings');

const validateResult = spawnSync(
  process.execPath,
  [validatePath, '--repo', fixtureRoot, '--json'],
  { env, encoding: 'utf8' }
);
if (validateResult.status !== 0) {
  console.error('Expected index-validate to pass after build-embeddings.');
  if (validateResult.stderr) console.error(validateResult.stderr.trim());
  process.exit(validateResult.status ?? 1);
}
let payload;
try {
  payload = JSON.parse(validateResult.stdout);
} catch {
  console.error('index-validate did not return valid JSON.');
  process.exit(1);
}
if (!payload || payload.ok !== true) {
  console.error('index-validate JSON payload missing ok=true.');
  process.exit(1);
}

const previousCacheRoot = process.env.PAIROFCLEATS_CACHE_ROOT;
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
const userConfig = loadUserConfig(fixtureRoot);
const codeDir = getIndexDir(fixtureRoot, 'code', userConfig);
if (previousCacheRoot === undefined) {
  delete process.env.PAIROFCLEATS_CACHE_ROOT;
} else {
  process.env.PAIROFCLEATS_CACHE_ROOT = previousCacheRoot;
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

const denseJsonFiles = [
  path.join(codeDir, 'dense_vectors_uint8.json'),
  path.join(codeDir, 'dense_vectors_doc_uint8.json'),
  path.join(codeDir, 'dense_vectors_code_uint8.json')
];
for (const densePath of denseJsonFiles) {
  let densePayload;
  try {
    densePayload = JSON.parse(await fsPromises.readFile(densePath, 'utf8'));
  } catch {
    console.error(`Failed to read ${densePath}.`);
    process.exit(1);
  }
  const fields = densePayload?.fields || densePayload || {};
  if (!Number.isFinite(fields.minVal)) {
    console.error(`dense vectors missing minVal in ${densePath}.`);
    process.exit(1);
  }
  if (!Number.isFinite(fields.maxVal)) {
    console.error(`dense vectors missing maxVal in ${densePath}.`);
    process.exit(1);
  }
  if (!Number.isFinite(fields.levels)) {
    console.error(`dense vectors missing levels in ${densePath}.`);
    process.exit(1);
  }
}

console.log('Stage3 embeddings validation test passed');

