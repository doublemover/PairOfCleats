#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildEmbeddingIdentity } from '../../../src/shared/embedding-identity.js';
import { resolveVersionedCacheRoot } from '../../../src/shared/cache-roots.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = resolveTestCachePath(root, 'embeddings-cache-identity');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRootBase = path.join(tempRoot, 'cache');
const cacheRoot = resolveVersionedCacheRoot(cacheRootBase);

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRootBase,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const runNode = (label, args, cwd = repoRoot) => {
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`embeddings cache identity test failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

const findPathsByName = async (rootDir, fileName) => {
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
      if (item.isFile() && item.name === fileName) {
        matches.push(fullPath);
      }
    }
  };
  await walk(rootDir);
  return matches.sort((a, b) => a.localeCompare(b));
};

runNode('build_index failed', [
  path.join(root, 'build_index.js'),
  '--stub-embeddings',
  '--scm-provider',
  'none',
  '--repo',
  repoRoot
]);

runNode('build-embeddings dims=8 failed', [
  path.join(root, 'tools', 'build/embeddings.js'),
  '--stub-embeddings',
  '--mode',
  'code',
  '--dims',
  '8',
  '--repo',
  repoRoot
]);

runNode('build-embeddings dims=12 failed', [
  path.join(root, 'tools', 'build/embeddings.js'),
  '--stub-embeddings',
  '--mode',
  'code',
  '--dims',
  '12',
  '--repo',
  repoRoot
]);

const cacheIndexPaths = await findPathsByName(cacheRoot, 'cache.index.json');
if (cacheIndexPaths.length > 0) {
  console.error('embeddings cache identity test failed: expected no cache index artifacts in stub mode');
  console.error(cacheIndexPaths.join('\n'));
  process.exit(1);
}

const cacheMetaPaths = await findPathsByName(cacheRoot, 'cache.meta.json');
if (cacheMetaPaths.length > 0) {
  console.error('embeddings cache identity test failed: expected no cache metadata artifacts in stub mode');
  console.error(cacheMetaPaths.join('\n'));
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

console.log('embeddings cache identity tests passed');
