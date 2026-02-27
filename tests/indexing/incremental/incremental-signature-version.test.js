#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { shouldReuseIncrementalIndex } from '../../../src/index/build/incremental.js';
import { SIGNATURE_VERSION } from '../../../src/index/build/indexer/signatures.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'incremental-signature-version');
const repoRoot = path.join(tempRoot, 'repo');
const outDir = path.join(tempRoot, 'out');
const piecesDir = path.join(outDir, 'pieces');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fs.mkdir(piecesDir, { recursive: true });

const filePath = path.join(repoRoot, 'src', 'a.js');
await fs.writeFile(filePath, 'export const a = 1;\n');
const stat = await fs.stat(filePath);

const indexState = {
  generatedAt: new Date().toISOString(),
  mode: 'code',
  artifactSurfaceVersion: '0.0.1'
};
await fs.writeFile(path.join(outDir, 'index_state.json'), JSON.stringify(indexState, null, 2));

const pieceManifest = {
  version: 1,
  artifactSurfaceVersion: '0.0.1',
  pieces: [
    { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json' }
  ]
};
await fs.writeFile(path.join(piecesDir, 'manifest.json'), JSON.stringify(pieceManifest, null, 2));

const manifest = {
  signatureVersion: SIGNATURE_VERSION - 1,
  files: {
    'src/a.js': {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      hash: 'deadbeef',
      bundles: ['bundle.json']
    }
  }
};

const reuse = await shouldReuseIncrementalIndex({
  outDir,
  entries: [{ rel: 'src/a.js', stat }],
  manifest,
  stage: null
});

assert.equal(reuse, false, 'expected signatureVersion mismatch to skip reuse');

console.log('incremental signature version test passed');

