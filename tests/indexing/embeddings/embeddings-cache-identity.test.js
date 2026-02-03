#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readCacheEntry } from '../../../tools/build/embeddings/cache.js';
import { buildEmbeddingIdentity } from '../../../src/shared/embedding-identity.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, '.testCache', 'embeddings-cache-identity');
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
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--scm-provider', 'none', '--repo', repoRoot],
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
      path.join(root, 'tools', 'build/embeddings.js'),
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

const findCacheIndexPaths = async (rootDir) => {
  const matches = [];
  const walk = async (dir) => {
    let items;
    try {
      items = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (item.isFile() && item.name === 'cache.index.json') {
        matches.push(fullPath);
      }
    }
  };
  await walk(rootDir);
  return matches.sort((a, b) => a.localeCompare(b));
};

const loadCacheEntries = async (cacheRootDir) => {
  const entries = [];
  const indexPaths = await findCacheIndexPaths(cacheRootDir);
  for (const indexPath of indexPaths) {
    let index;
    try {
      index = JSON.parse(await fsPromises.readFile(indexPath, 'utf8'));
    } catch {
      continue;
    }
    const cacheDir = path.dirname(indexPath);
    const keys = Object.keys(index.entries || {});
    for (const key of keys) {
      try {
        const result = await readCacheEntry(cacheDir, key, index);
        if (result?.entry) {
          entries.push({ name: key, path: indexPath, cache: result.entry });
        }
      } catch {}
    }
  }
  return entries;
};

const findCacheEntry = (entries, predicate) => (
  entries.find((entry) => predicate(entry?.cache?.cacheMeta?.identity || null))
);

runEmbeddings(8);

const cacheDir = path.join(cacheRoot, 'embeddings');
const firstIndexPaths = await findCacheIndexPaths(cacheDir);
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
const secondIndexPaths = await findCacheIndexPaths(cacheDir);
const firstSet = new Set(firstIndexPaths);
const hasNew = secondIndexPaths.some((entry) => !firstSet.has(entry));
if (!hasNew) {
  console.error('embeddings cache identity test failed: expected new cache entries after dims change');
  process.exit(1);
}

console.log('embeddings cache identity tests passed');

