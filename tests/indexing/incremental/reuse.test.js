#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { shouldReuseIncrementalIndex } from '../../../src/index/build/incremental.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { SIGNATURE_VERSION } from '../../../src/index/build/indexer/signatures.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'incremental-reuse');
const outDir = path.join(tempRoot, 'index');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(outDir, 'pieces'), { recursive: true });

const indexState = { stage: 'stage2', mode: 'code', generatedAt: new Date().toISOString(), artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION };
const pieceManifest = {
  version: 2,
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  pieces: [{ name: 'chunk_meta', path: 'chunk_meta.json' }]
};
await fs.writeFile(path.join(outDir, 'index_state.json'), JSON.stringify(indexState));
await fs.writeFile(path.join(outDir, 'pieces', 'manifest.json'), JSON.stringify(pieceManifest));
await fs.writeFile(path.join(outDir, 'chunk_meta.json'), '[]', 'utf8');

const entries = [
  { rel: 'src/a.js', stat: { size: 10, mtimeMs: 123 } },
  { rel: 'src/b.js', stat: { size: 20, mtimeMs: 456 } }
];

const manifest = {
  signatureVersion: SIGNATURE_VERSION,
  files: {
    'src/a.js': { size: 10, mtimeMs: 123 },
    'src/b.js': { size: 20, mtimeMs: 456 }
  }
};

const reuse = await shouldReuseIncrementalIndex({
  outDir,
  entries,
  manifest,
  stage: 'stage1'
});

if (!reuse) {
  console.error('incremental reuse test failed: expected reuse');
  process.exit(1);
}

const extraManifest = {
  files: {
    ...manifest.files,
    'src/c.js': { size: 30, mtimeMs: 789 }
  }
};

const noReuseDeleted = await shouldReuseIncrementalIndex({
  outDir,
  entries,
  manifest: extraManifest,
  stage: 'stage1'
});

if (noReuseDeleted) {
  console.error('incremental reuse test failed: expected deletion mismatch');
  process.exit(1);
}

const noReuse = await shouldReuseIncrementalIndex({
  outDir,
  entries: [{ rel: 'src/a.js', stat: { size: 11, mtimeMs: 123 } }],
  manifest,
  stage: 'stage2'
});

if (noReuse) {
  console.error('incremental reuse test failed: expected mismatch');
  process.exit(1);
}

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

