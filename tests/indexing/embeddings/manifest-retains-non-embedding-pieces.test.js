#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { updatePieceManifest } from '../../../tools/build/embeddings/manifest.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { rmDirRecursive } from '../../helpers/temp.js';

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'manifest-retains-non-embedding-pieces');
const indexDir = path.join(cacheRoot, 'index-code');
const piecesDir = path.join(indexDir, 'pieces');
const manifestPath = path.join(piecesDir, 'manifest.json');

await rmDirRecursive(cacheRoot, { retries: 8, delayMs: 100 });
await fs.mkdir(piecesDir, { recursive: true });

await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[]\n');
await fs.writeFile(path.join(indexDir, 'index_state.json'), '{}\n');
await fs.writeFile(path.join(indexDir, 'dense_vectors_uint8.bin'), Buffer.from([1, 2, 3, 4]));
await fs.writeFile(path.join(indexDir, 'dense_vectors_uint8.bin.meta.json'), JSON.stringify({ count: 1, dims: 4 }));
await fs.writeFile(path.join(indexDir, 'dense_vectors_doc_uint8.bin'), Buffer.from([1, 2, 3, 4]));
await fs.writeFile(path.join(indexDir, 'dense_vectors_doc_uint8.bin.meta.json'), JSON.stringify({ count: 1, dims: 4 }));
await fs.writeFile(path.join(indexDir, 'dense_vectors_code_uint8.bin'), Buffer.from([1, 2, 3, 4]));
await fs.writeFile(path.join(indexDir, 'dense_vectors_code_uint8.bin.meta.json'), JSON.stringify({ count: 1, dims: 4 }));

await fs.writeFile(manifestPath, JSON.stringify({
  version: 2,
  artifactSurfaceVersion: '2026-02-01',
  compatibilityKey: null,
  generatedAt: new Date().toISOString(),
  updatedAt: null,
  mode: 'code',
  stage: 'stage2',
  repoId: null,
  buildId: null,
  pieces: [
    {
      type: 'chunks',
      name: 'chunk_meta',
      format: 'json',
      path: 'chunk_meta.json',
      count: 1
    },
    {
      type: 'stats',
      name: 'index_state',
      format: 'json',
      path: 'index_state.json',
      count: 1
    },
    {
      type: 'embeddings',
      name: 'dense_vectors',
      format: 'bin',
      path: 'dense_vectors-stale.bin',
      count: 1,
      dims: 4
    }
  ]
}, null, 2));

await updatePieceManifest({
  indexDir,
  mode: 'code',
  totalChunks: 1,
  dims: 4
});

const updated = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const pieces = Array.isArray(updated?.pieces) ? updated.pieces : [];
const byName = new Map(pieces.map((entry) => [entry.name, entry]));

assert.ok(byName.has('chunk_meta'), 'expected chunk_meta to be preserved');
assert.ok(byName.has('index_state'), 'expected index_state to be preserved');
assert.ok(byName.has('dense_vectors'), 'expected dense_vectors entry to be written');
assert.equal(byName.get('dense_vectors')?.path, 'dense_vectors_uint8.bin');
assert.ok(!pieces.some((entry) => entry?.path === 'dense_vectors-stale.bin'), 'expected stale embedding entry to be replaced');

console.log('embeddings manifest preserves non-embedding pieces test passed');
