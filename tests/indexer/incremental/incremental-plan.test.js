#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { shouldReuseIncrementalIndex } from '../../../src/index/build/incremental.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { SIGNATURE_VERSION } from '../../../src/index/build/indexer/signatures.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const root = process.cwd();
const baseDir = path.join(root, '.testCache', 'indexer-plan');
const outDir = path.join(baseDir, 'out');
const piecesDir = path.join(outDir, 'pieces');
const fixtureFile = path.join(baseDir, 'src', 'a.js');

const setup = async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(fixtureFile), { recursive: true });
  await fs.writeFile(fixtureFile, 'const a = 1;\n');
  await fs.mkdir(piecesDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, 'index_state.json'),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      mode: 'code',
      stage: 'stage2',
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION
    })
  );
  await fs.writeFile(
    path.join(piecesDir, 'manifest.json'),
    JSON.stringify({
      version: 2,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      pieces: [{ name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' }]
    })
  );
};

const run = async () => {
  await setup();
  const stat = await fs.stat(fixtureFile);
  const entries = [{ rel: 'src/a.js', stat }];
  const manifest = {
    signatureVersion: SIGNATURE_VERSION,
    files: { 'src/a.js': { size: stat.size, mtimeMs: stat.mtimeMs } }
  };

  const reuse = await shouldReuseIncrementalIndex({ outDir, entries, manifest, stage: 'stage2' });
  if (!reuse) {
    fail('shouldReuseIncrementalIndex should return true for matching manifest entries.');
  }

  const stageMismatch = await shouldReuseIncrementalIndex({ outDir, entries, manifest, stage: 'stage3' });
  if (stageMismatch) {
    fail('shouldReuseIncrementalIndex should fail when stage is not satisfied.');
  }

  const manifestMismatch = {
    signatureVersion: SIGNATURE_VERSION,
    files: { 'src/a.js': { size: stat.size + 1, mtimeMs: stat.mtimeMs } }
  };
  const reuseMismatch = await shouldReuseIncrementalIndex({ outDir, entries, manifest: manifestMismatch, stage: 'stage2' });
  if (reuseMismatch) {
    fail('shouldReuseIncrementalIndex should fail when file sizes differ.');
  }
};

try {
  await run();
  console.log('indexer incremental plan tests passed');
} finally {
  await fs.rm(baseDir, { recursive: true, force: true });
}

