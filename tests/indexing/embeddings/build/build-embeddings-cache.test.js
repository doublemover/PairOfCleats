#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getRepoCacheRoot } from '../../../../tools/dict-utils.js';
import { buildEmbeddingIdentity, buildEmbeddingIdentityKey } from '../../../../src/shared/embedding-identity.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'build-embeddings-cache');
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

runNode('build_index', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot]);
runNode('build_embeddings', [path.join(root, 'tools', 'build/embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot]);

const repoCacheRoot = getRepoCacheRoot(repoRoot, null);
const cacheDir = path.join(repoCacheRoot, 'embeddings', 'code', 'files');
const cacheFiles = fs.existsSync(cacheDir)
  ? fs.readdirSync(cacheDir).filter((name) => name.endsWith('.json'))
  : [];
if (!cacheFiles.length) {
  console.error('Expected embedding cache files to be created');
  process.exit(1);
}
const cachePath = path.join(cacheDir, cacheFiles[0]);
const before = await fsPromises.stat(cachePath);

runNode('build_embeddings cached', [path.join(root, 'tools', 'build/embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot]);

const after = await fsPromises.stat(cachePath);
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

