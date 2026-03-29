#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { shouldReuseIncrementalIndex } from '../../../src/index/build/incremental.js';
import { SIGNATURE_VERSION } from '../../../src/index/build/indexer/signatures.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'indexer-incremental-contract-matrix');
const outDir = path.join(tempRoot, 'out');
const piecesDir = path.join(outDir, 'pieces');
const fixtureFile = path.join(tempRoot, 'src', 'a.js');
const piecesManifestPath = path.join(piecesDir, 'manifest.json');

const validPiecesManifest = {
  version: 2,
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  pieces: [
    { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' },
    { name: 'index_state', path: 'index_state.json', format: 'json' }
  ]
};

const setup = async ({ source = 'export const a = 1;\n' } = {}) => {
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(path.dirname(fixtureFile), { recursive: true });
  await fs.mkdir(piecesDir, { recursive: true });
  await fs.writeFile(fixtureFile, source, 'utf8');
  await fs.writeFile(
    path.join(outDir, 'index_state.json'),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      mode: 'code',
      stage: 'stage2',
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION
    }, null, 2),
    'utf8'
  );
  await fs.writeFile(
    path.join(outDir, 'chunk_meta.json'),
    JSON.stringify([{ id: 0, file: 'src/a.js', start: 0, end: 1 }], null, 2),
    'utf8'
  );
  await fs.writeFile(piecesManifestPath, JSON.stringify(validPiecesManifest, null, 2), 'utf8');
};

await setup();
const stat = await fs.stat(fixtureFile);
const entries = [{ rel: 'src/a.js', stat }];
const manifest = {
  signatureVersion: SIGNATURE_VERSION,
  files: { 'src/a.js': { size: stat.size, mtimeMs: stat.mtimeMs } }
};

assert.equal(await shouldReuseIncrementalIndex({ outDir, entries, manifest, stage: 'stage2' }), true);
assert.equal(await shouldReuseIncrementalIndex({ outDir, entries, manifest, stage: 'stage3' }), false);
assert.equal(
  await shouldReuseIncrementalIndex({
    outDir,
    entries,
    manifest: {
      signatureVersion: SIGNATURE_VERSION,
      files: { 'src/a.js': { size: stat.size + 1, mtimeMs: stat.mtimeMs } }
    },
    stage: 'stage2'
  }),
  false
);

await fs.writeFile(
  piecesManifestPath,
  JSON.stringify({
    ...validPiecesManifest,
    pieces: [
      { name: 'chunk_meta', path: '../escaped-chunk-meta.json', format: 'json' },
      { name: 'index_state', path: 'index_state.json', format: 'json' }
    ]
  }, null, 2),
  'utf8'
);
assert.equal(await shouldReuseIncrementalIndex({ outDir, entries, manifest, stage: 'stage2' }), false);

await fs.writeFile(piecesManifestPath, JSON.stringify(validPiecesManifest, null, 2), 'utf8');
await fs.rm(path.join(outDir, 'chunk_meta.json'), { force: true });
assert.equal(await shouldReuseIncrementalIndex({ outDir, entries, manifest, stage: 'stage2' }), false);

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('indexer incremental contract matrix test passed');
