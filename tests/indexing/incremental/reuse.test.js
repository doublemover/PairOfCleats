#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { shouldReuseIncrementalIndex } from '../../../src/index/build/incremental.js';
import { createReuseFixture, assertReuseSourceContract } from './reuse-fixture.js';

const fixture = await createReuseFixture('incremental-reuse');
await assertReuseSourceContract(fixture);
const { tempRoot, outDir, entries, manifest, pieceManifest } = fixture;

const outsideDir = path.join(tempRoot, 'outside');
await fs.mkdir(outsideDir, { recursive: true });
await fs.writeFile(path.join(outsideDir, 'chunk_meta.json'), '[]', 'utf8');
const symlinkPieceDir = path.join(outDir, 'symlink-piece');
let symlinkCreated = false;
try {
  await fs.symlink(outsideDir, symlinkPieceDir, process.platform === 'win32' ? 'junction' : 'dir');
  symlinkCreated = true;
} catch {}
if (symlinkCreated) {
  const escapedPieceManifest = {
    ...pieceManifest,
    pieces: [{ name: 'chunk_meta', path: 'symlink-piece/chunk_meta.json' }]
  };
  await fs.writeFile(path.join(outDir, 'pieces', 'manifest.json'), JSON.stringify(escapedPieceManifest));
  const escapedReuse = await shouldReuseIncrementalIndex({
    outDir,
    entries,
    manifest,
    stage: 'stage1'
  });
  if (escapedReuse) {
    console.error('incremental reuse test failed: expected symlink-escaped manifest piece to be rejected');
    process.exit(1);
  }
}

console.log('incremental reuse test passed');

