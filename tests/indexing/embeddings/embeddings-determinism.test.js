#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getCacheRoot } from '../../../src/shared/cache-roots.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { loadPiecesManifestPieces } from '../../helpers/pieces-manifest.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const sha256File = async (filePath) => crypto
  .createHash('sha256')
  .update(await fsPromises.readFile(filePath))
  .digest('hex');

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'embeddings-determinism');
const repoRoot = path.join(tempRoot, 'repo');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });

await fsPromises.writeFile(path.join(repoRoot, 'alpha.js'), 'export const alpha = 1;\n');
await fsPromises.writeFile(path.join(repoRoot, 'beta.js'), 'export const beta = () => 2;\n');

const env = applyTestEnv({
  cacheRoot: tempRoot,
  embeddings: 'stub',
  testConfig: {
    sqlite: { use: false },
    indexing: {
      scm: { provider: 'none' },
      embeddings: {
        enabled: true,
        mode: 'stub',
        hnsw: { enabled: false },
        lancedb: { enabled: false }
      },
      treeSitter: { enabled: false },
      typeInference: false,
      typeInferenceCrossFile: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false
    }
  }
});

const runNode = (label, args) => {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, env, stdio: 'inherit' });
  assert.equal(result.status, 0, `expected ${label} to succeed`);
};

const clearEmbeddingsCache = async () => {
  const embeddingsCacheRoot = path.join(getCacheRoot(), 'embeddings');
  await fsPromises.rm(embeddingsCacheRoot, { recursive: true, force: true });
};

runNode('build_index', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot]);

const userConfig = loadUserConfig(repoRoot);
const codeDir = getIndexDir(repoRoot, 'code', userConfig);
const denseFiles = [
  path.join(codeDir, 'dense_vectors_uint8.json'),
  path.join(codeDir, 'dense_vectors_doc_uint8.json'),
  path.join(codeDir, 'dense_vectors_code_uint8.json')
];

const readEmbeddingPieces = async () => {
  const pieces = loadPiecesManifestPieces(codeDir);
  return pieces
    .filter((entry) => entry && entry.type === 'embeddings')
    .map((entry) => ({
      type: entry.type,
      name: entry.name,
      format: entry.format,
      path: entry.path,
      count: entry.count,
      dims: entry.dims,
      bytes: entry.bytes ?? null,
      checksum: entry.checksum ?? null
    }));
};

await clearEmbeddingsCache();
runNode('build_embeddings (first)', [
  path.join(root, 'tools', 'build/embeddings.js'),
  '--stub-embeddings',
  '--mode',
  'code',
  '--repo',
  repoRoot
]);

const snapshot1 = {
  dense: await Promise.all(denseFiles.map(sha256File)),
  pieces: await readEmbeddingPieces()
};

await clearEmbeddingsCache();
runNode('build_embeddings (second)', [
  path.join(root, 'tools', 'build/embeddings.js'),
  '--stub-embeddings',
  '--mode',
  'code',
  '--repo',
  repoRoot
]);

const snapshot2 = {
  dense: await Promise.all(denseFiles.map(sha256File)),
  pieces: await readEmbeddingPieces()
};

assert.deepEqual(snapshot2, snapshot1, 'expected deterministic Stage3 embedding artifacts');

console.log('embeddings determinism test passed');

