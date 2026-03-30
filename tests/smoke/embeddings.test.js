#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { cleanup, root } from './smoke-utils.js';
import { getIndexDir, loadUserConfig } from '../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { loadPiecesManifestPieces } from '../helpers/pieces-manifest.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';

const tempRoot = resolveTestCachePath(root, 'smoke-embeddings');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      typeInference: false,
      typeInferenceCrossFile: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false,
      scm: { provider: 'none' }
    },
    tooling: {
      autoEnableOnDetect: false,
      lsp: { enabled: false }
    }
  }
});

const fail = (message, exitCode = 1) => {
  const error = new Error(message);
  error.exitCode = exitCode;
  throw error;
};

const run = (label, args) => {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    if (stderr) console.error(stderr);
    if (stdout) console.error(stdout);
    fail(`Failed: ${label}`, result.status ?? 1);
  }
  return result;
};

let failure = null;
try {
  await cleanup([tempRoot]);
  await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });
  await fsPromises.writeFile(
    path.join(repoRoot, 'src', 'alpha.js'),
    'export const alpha = () => "embeddings_smoke_token";\n'
  );

  run('build_index', [
    path.join(root, 'build_index.js'),
    '--stub-embeddings',
    '--mode',
    'code',
    '--repo',
    repoRoot
  ]);
  run('build_embeddings', [
    path.join(root, 'tools', 'build', 'embeddings.js'),
    '--stub-embeddings',
    '--mode',
    'code',
    '--repo',
    repoRoot
  ]);

  const userConfig = loadUserConfig(repoRoot);
  const codeDir = getIndexDir(repoRoot, 'code', userConfig);
  const pieces = loadPiecesManifestPieces(codeDir);
  const pieceNames = new Set(
    pieces
      .filter((entry) => entry && typeof entry.name === 'string')
      .map((entry) => entry.name)
  );

  assert.ok(pieceNames.has('dense_vectors'), 'expected dense_vectors entry in pieces manifest');
  assert.ok(pieceNames.has('dense_vectors_lancedb_meta'), 'expected lancedb metadata entry in pieces manifest');
} catch (err) {
  console.error(err?.message || err);
  failure = err;
}
await cleanup([tempRoot]);

if (failure) {
  process.exit(failure.exitCode ?? 1);
}
console.log('smoke embeddings passed');

