#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { shouldReuseIncrementalIndex } from '../../../src/index/build/incremental.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { SIGNATURE_VERSION } from '../../../src/index/build/indexer/signatures.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'index-reuse-validation');
const outDir = path.join(tempRoot, 'out');
const piecesDir = path.join(outDir, 'pieces');
const fixtureFile = path.join(tempRoot, 'src', 'a.js');

const setup = async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(path.dirname(fixtureFile), { recursive: true });
  await fs.writeFile(fixtureFile, 'export const a = 1;\n', 'utf8');
  await fs.mkdir(piecesDir, { recursive: true });
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
  await fs.writeFile(
    path.join(piecesDir, 'manifest.json'),
    JSON.stringify({
      version: 2,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      pieces: [
        { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' },
        { name: 'index_state', path: 'index_state.json', format: 'json' }
      ]
    }, null, 2),
    'utf8'
  );
};

await setup();

const stat = await fs.stat(fixtureFile);
const entries = [{ rel: 'src/a.js', stat }];
const manifest = {
  signatureVersion: SIGNATURE_VERSION,
  files: { 'src/a.js': { size: stat.size, mtimeMs: stat.mtimeMs } }
};

const reusable = await shouldReuseIncrementalIndex({
  outDir,
  entries,
  manifest,
  stage: 'stage2'
});
assert.equal(reusable, true, 'expected incremental reuse when required artifacts are present');

await fs.rm(path.join(outDir, 'chunk_meta.json'), { force: true });
const reusableAfterCorruption = await shouldReuseIncrementalIndex({
  outDir,
  entries,
  manifest,
  stage: 'stage2'
});
assert.equal(
  reusableAfterCorruption,
  false,
  'expected incremental reuse to fail when required piece artifact is missing'
);

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('index reuse validation test passed');
