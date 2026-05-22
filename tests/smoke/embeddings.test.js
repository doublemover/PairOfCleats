#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { cleanup, createSmokeIndexFixture, root, runSmokeNode } from './smoke-utils.js';
import { getIndexDir, loadUserConfig } from '../../tools/shared/dict-utils.js';
import { loadPiecesManifestPieces } from '../helpers/pieces-manifest.js';

let tempRoot = null;

let failure = null;
try {
  const fixture = await createSmokeIndexFixture({
    name: 'smoke-embeddings',
    token: 'embeddings_smoke_token'
  });
  tempRoot = fixture.tempRoot;
  const { env, repoRoot } = fixture;
  const run = (label, args) => runSmokeNode(label, args, { cwd: repoRoot, env });

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
if (tempRoot) {
  await cleanup([tempRoot]);
}

if (failure) {
  process.exit(failure.exitCode ?? 1);
}
console.log('smoke embeddings passed');

