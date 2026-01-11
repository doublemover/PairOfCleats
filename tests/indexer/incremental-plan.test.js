#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { shouldReuseIncrementalIndex } from '../../src/index/build/incremental.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const root = process.cwd();
const baseDir = path.join(root, 'tests', '.cache', 'indexer-plan');
const outDir = path.join(baseDir, 'out');
const piecesDir = path.join(outDir, 'pieces');
const fixtureFile = path.join(baseDir, 'src', 'a.js');

const setup = async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(fixtureFile), { recursive: true });
  await fs.writeFile(fixtureFile, 'const a = 1;\n');
  await fs.mkdir(piecesDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'index_state.json'), JSON.stringify({ stage: 'stage2' }));
  await fs.writeFile(path.join(piecesDir, 'manifest.json'), JSON.stringify({ pieces: [{ id: 'piece-1' }] }));
};

const run = async () => {
  await setup();
  const stat = await fs.stat(fixtureFile);
  const entries = [{ rel: 'src/a.js', stat }];
  const manifest = { files: { 'src/a.js': { size: stat.size, mtimeMs: stat.mtimeMs } } };

  const reuse = await shouldReuseIncrementalIndex({ outDir, entries, manifest, stage: 'stage2' });
  if (!reuse) {
    fail('shouldReuseIncrementalIndex should return true for matching manifest entries.');
  }

  const stageMismatch = await shouldReuseIncrementalIndex({ outDir, entries, manifest, stage: 'stage3' });
  if (stageMismatch) {
    fail('shouldReuseIncrementalIndex should fail when stage is not satisfied.');
  }

  const manifestMismatch = { files: { 'src/a.js': { size: stat.size + 1, mtimeMs: stat.mtimeMs } } };
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
