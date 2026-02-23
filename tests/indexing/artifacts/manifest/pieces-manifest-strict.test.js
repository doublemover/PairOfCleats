#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { writePiecesManifest } from '../../../../src/index/build/artifacts/checksums.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'pieces-manifest-strict');
const outDir = path.join(tempRoot, 'index-code');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });

let threw = false;
try {
  await writePiecesManifest({
    pieceEntries: [{ type: 'chunks', name: 'chunk_meta', format: 'json', path: 'missing.json' }],
    outDir,
    mode: 'code',
    indexState: { stage: 'stage1' }
  });
} catch {
  threw = true;
}

if (!threw) {
  console.error('Expected pieces manifest to hard-fail on missing files.');
  process.exit(1);
}

console.log('pieces manifest strictness test passed');

