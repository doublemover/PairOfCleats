#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildEmbeddingIdentity, buildEmbeddingIdentityKey } from '../../../../src/shared/embedding-identity.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'build-embeddings-cache');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'alpha.js'),
  'export const alpha = () => 1;\n'
);

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      embeddings: {
        hnsw: { enabled: false },
        lancedb: { enabled: false }
      }
    }
  }
});

const runNode = (label, args) => {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, env, stdio: 'inherit' });
  if (result.status !== 0) {
    const exitLabel = result.status ?? 'unknown';
    console.error(`Failed: ${label} (exit ${exitLabel})`);
    if (result.error) {
      console.error(result.error.message || result.error);
    }
    process.exit(result.status ?? 1);
  }
};

const findCacheIndexPaths = async (rootDir) => {
  const matches = [];
  const walk = async (dir) => {
    let entries = [];
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === 'cache.index.json') {
        matches.push(fullPath);
      }
    }
  };
  await walk(rootDir);
  return matches;
};

const loadCacheIndex = async (rootDir) => {
  const paths = await findCacheIndexPaths(rootDir);
  if (!paths.length) {
    console.error('Expected embedding cache index to be created');
    process.exit(1);
  }
  const indexPath = paths[0];
  const cacheDir = path.dirname(indexPath);
  const raw = await fsPromises.readFile(indexPath, 'utf8');
  return { indexPath, cacheDir, index: JSON.parse(raw) };
};

runNode('build_index', [path.join(root, 'build_index.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot]);
runNode('build_embeddings', [path.join(root, 'tools', 'build/embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot]);

const { cacheDir, index } = await loadCacheIndex(cacheRoot);
const entryKeys = Object.keys(index.entries || {});
if (!entryKeys.length) {
  console.error('Expected embedding cache index to contain entries');
  process.exit(1);
}
const entry = index.entries[entryKeys[0]];
if (!entry?.shard) {
  console.error('Expected embedding cache index to point at a shard entry');
  process.exit(1);
}
const shardPath = path.join(cacheDir, 'shards', entry.shard);
if (!fs.existsSync(shardPath)) {
  console.error('Expected embedding cache shard to exist');
  console.error(`Cache root: ${cacheRoot}`);
  console.error(`Cache dir: ${cacheDir}`);
  console.error(`Index path: ${path.join(cacheDir, 'cache.index.json')}`);
  console.error(`Shard path: ${shardPath}`);
  console.error(`Shard entry: ${JSON.stringify(entry)}`);
  try {
    const shardDir = path.join(cacheDir, 'shards');
    const shardList = await fsPromises.readdir(shardDir);
    console.error(`Shard dir contents: ${JSON.stringify(shardList)}`);
  } catch (err) {
    console.error(`Failed to read shard dir: ${err?.message || err}`);
  }
  process.exit(1);
}
const before = await fsPromises.stat(shardPath);

runNode('build_embeddings cached', [path.join(root, 'tools', 'build/embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot]);

const after = await fsPromises.stat(shardPath);
if (after.mtimeMs !== before.mtimeMs) {
  console.error('Expected embedding cache file to be reused without rewrite');
  process.exit(1);
}

const onnxBase = buildEmbeddingIdentity({
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
    tokenizerId: 'tokenizer-id'
  }
});
const onnxVariant = buildEmbeddingIdentity({
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
    modelPath: 'models/onnx/other.onnx',
    tokenizerId: 'tokenizer-id'
  }
});
if (buildEmbeddingIdentityKey(onnxBase) === buildEmbeddingIdentityKey(onnxVariant)) {
  console.error('Expected embedding cache identity to change with ONNX modelPath');
  process.exit(1);
}

console.log('embedding cache reuse test passed');

