#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildEmbeddingIdentity, buildEmbeddingIdentityKey } from '../../../../src/shared/embedding-identity.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { runNode as runNodeSync } from '../../../helpers/run-node.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';
import { rmDirRecursive } from '../../../helpers/temp.js';


const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'build-embeddings-cache');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await rmDirRecursive(tempRoot, { retries: 8, delayMs: 150 });
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

const runNode = (label, args) => runNodeSync(args, label, repoRoot, env, { stdio: 'pipe' });

const findPathsByName = async (rootDir, fileName) => {
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
      if (entry.isFile() && entry.name === fileName) {
        matches.push(fullPath);
      }
    }
  };
  await walk(rootDir);
  return matches.sort((a, b) => a.localeCompare(b));
};

const assertNoStubCacheArtifacts = async () => {
  const indexPaths = await findPathsByName(cacheRoot, 'cache.index.json');
  if (indexPaths.length > 0) {
    console.error('Expected stub fast-path to skip embedding cache index writes');
    console.error(`Found cache indexes: ${indexPaths.join(', ')}`);
    process.exit(1);
  }
  const metaPaths = await findPathsByName(cacheRoot, 'cache.meta.json');
  if (metaPaths.length > 0) {
    console.error('Expected stub fast-path to skip embedding cache metadata writes');
    console.error(`Found cache metadata: ${metaPaths.join(', ')}`);
    process.exit(1);
  }
};

runNode('build_index', [path.join(root, 'build_index.js'), '--stub-embeddings', '--stage', 'stage3', '--mode', 'code', '--repo', repoRoot]);
runNode('build_embeddings', [path.join(root, 'tools', 'build/embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot]);
await assertNoStubCacheArtifacts();

runNode('build_embeddings cached', [path.join(root, 'tools', 'build/embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot]);
await assertNoStubCacheArtifacts();

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

console.log('stub fast-path cache disable test passed');

