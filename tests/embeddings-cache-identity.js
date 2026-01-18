#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getRepoCacheRoot, loadUserConfig } from '../tools/dict-utils.js';
import { buildEmbeddingIdentity } from '../src/shared/embedding-identity.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, 'tests', '.cache', 'embeddings-cache-identity');
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
  console.error('embeddings cache identity test failed: build_index failed');
  process.exit(buildIndex.status ?? 1);
}

const runEmbeddings = (dims) => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'tools', 'build-embeddings.js'),
      '--stub-embeddings',
      '--mode',
      'code',
      '--dims',
      String(dims),
      '--repo',
      repoRoot
    ],
    { cwd: repoRoot, env, stdio: 'inherit' }
  );
  if (result.status !== 0) {
    console.error(`embeddings cache identity test failed: build-embeddings dims=${dims} failed`);
    process.exit(result.status ?? 1);
  }
};

const loadCacheEntries = async (cacheDir) => {
  const files = (await fsPromises.readdir(cacheDir))
    .filter((name) => name.endsWith('.json'))
    .sort();
  const entries = [];
  for (const name of files) {
    try {
      const cache = JSON.parse(await fsPromises.readFile(path.join(cacheDir, name), 'utf8'));
      entries.push({ name, cache });
    } catch {}
  }
  return entries;
};

const findCacheEntry = (entries, predicate) => (
  entries.find((entry) => predicate(entry?.cache?.cacheMeta?.identity || null))
);

runEmbeddings(8);

const userConfig = loadUserConfig(repoRoot);
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const cacheDir = path.join(repoCacheRoot, 'embeddings', 'code', 'files');
const firstEntries = await loadCacheEntries(cacheDir);
if (!firstEntries.length) {
  console.error('embeddings cache identity test failed: missing cache files');
  process.exit(1);
}

const firstEntry = findCacheEntry(firstEntries, (identity) => (
  identity?.dims === 8 && identity?.stub === true
));
if (!firstEntry) {
  console.error('embeddings cache identity test failed: no cache entry for dims=8 stub=true');
  process.exit(1);
}
const firstCache = firstEntry.cache;
const meta = firstCache?.cacheMeta?.identity;
if (!meta) {
  console.error('embeddings cache identity test failed: missing cache metadata');
  process.exit(1);
}
if (meta.dims !== 8 || meta.scale !== 2 / 255 || meta.stub !== true) {
  console.error('embeddings cache identity test failed: cache identity did not include expected dims/scale/stub');
  process.exit(1);
}
if (!meta.modelId || typeof meta.modelId !== 'string') {
  console.error('embeddings cache identity test failed: cache identity missing modelId');
  process.exit(1);
}
if (!meta.provider || typeof meta.provider !== 'string') {
  console.error('embeddings cache identity test failed: cache identity missing provider');
  process.exit(1);
}

const onnxIdentity = buildEmbeddingIdentity({
  modelId: 'onnx-model',
  provider: 'onnx',
  mode: 'inline',
  stub: false,
  dims: 384,
  scale: 0.5,
  pooling: 'mean',
  normalize: true,
  truncation: 'truncate',
  maxLength: 128,
  onnx: {
    modelPath: 'models/onnx/model.onnx',
    tokenizerId: 'tokenizer-id',
    executionProviders: ['cpu'],
    intraOpNumThreads: 2,
    interOpNumThreads: 1,
    graphOptimizationLevel: 'basic'
  }
});
if (!onnxIdentity?.onnx?.modelPath || !onnxIdentity?.onnx?.tokenizerId) {
  console.error('embeddings cache identity test failed: ONNX identity missing modelPath/tokenizerId');
  process.exit(1);
}

runEmbeddings(12);
const secondEntries = await loadCacheEntries(cacheDir);
const firstSet = new Set(firstEntries.map((entry) => entry.name));
const hasNew = secondEntries.some((entry) => !firstSet.has(entry.name));
if (!hasNew) {
  console.error('embeddings cache identity test failed: expected new cache entries after dims change');
  process.exit(1);
}

console.log('embeddings cache identity tests passed');
