#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadChunkMeta } from '../src/shared/artifact-io.js';
import { ARTIFACT_SURFACE_VERSION } from '../src/contracts/versioning.js';

const root = process.cwd();
const cacheRoot = path.join(root, '.testCache', 'artifact-io-manifest');
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

const indexDir = path.join(cacheRoot, 'index');
await fs.mkdir(indexDir, { recursive: true });
await fs.writeFile(
  path.join(indexDir, 'chunk_meta.json'),
  JSON.stringify([{ id: 0, file: 'alpha.js', start: 0, end: 1 }])
);

let err = null;
try {
  await loadChunkMeta(indexDir);
} catch (next) {
  err = next;
}
assert.ok(err, 'expected missing manifest to throw');

await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
await fs.writeFile(
  path.join(indexDir, 'pieces', 'manifest.json'),
  JSON.stringify({
    version: 2,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    pieces: []
  }, null, 2)
);
err = null;
try {
  await loadChunkMeta(indexDir);
} catch (next) {
  err = next;
}
assert.ok(err, 'expected missing manifest entry to throw');
assert.ok(String(err.message).includes('Missing manifest entry'));

await fs.writeFile(
  path.join(indexDir, 'pieces', 'manifest.json'),
  JSON.stringify({
    version: 2,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    pieces: [
      { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' }
    ]
  }, null, 2)
);
const chunks = await loadChunkMeta(indexDir);
assert.equal(chunks.length, 1);

console.log('artifact-io manifest discovery test passed');

