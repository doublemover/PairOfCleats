#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { updatePieceManifest } from '../../../tools/build/embeddings/manifest.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { rmDirRecursive } from '../../helpers/temp.js';
import { writeIndexState } from '../../../tools/build/embeddings/state.js';
import { updateSqliteState } from '../../../src/storage/sqlite/build/index-state.js';
import { updateIndexStateManifest } from '../../../src/shared/index-state-utils.js';
import { checksumFile } from '../../../src/shared/hash.js';

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
  extensions: { rootCaller: { keep: true }, __poc_generated: { stale: true } },
  pieces: [
    {
      type: 'chunks',
      name: 'chunk_meta',
      format: 'json',
      path: 'chunk_meta.json',
      extensions: { pieceCaller: 'keep' },
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
    },
    {
      type: 'embeddings',
      name: 'dense_vectors',
      format: 'bin',
      path: 'dense_vectors_uint8.bin',
      extensions: { embeddingCaller: 'keep' }
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
assert.deepEqual(updated.extensions.rootCaller, { keep: true });
assert.equal(updated.extensions.__poc_generated.kind, 'pieces-manifest');
assert.equal(Object.keys(updated)[0], 'extensions');
assert.deepEqual(byName.get('chunk_meta').extensions, { pieceCaller: 'keep' });
assert.deepEqual(byName.get('dense_vectors').extensions, { embeddingCaller: 'keep' });

const statePath = path.join(indexDir, 'index_state.json');
await writeIndexState(statePath, { mode: 'code', extensions: { caller: { keep: true } } });
await updateSqliteState(indexDir, { status: 'ready' });
const patchedState = JSON.parse(await fs.readFile(statePath, 'utf8'));
assert.equal(patchedState.extensions.__poc_generated.kind, 'index-state');
assert.deepEqual(patchedState.extensions.caller, { keep: true });
assert.equal(Object.keys(patchedState)[0], 'extensions');
const patchedManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const statePiece = patchedManifest.pieces.find((piece) => piece.path === 'index_state.json');
const checksum = await checksumFile(statePath);
assert.equal(statePiece.checksum, `${checksum.algo}:${checksum.value}`);
assert.equal(statePiece.bytes, (await fs.stat(statePath)).size);
assert.deepEqual(patchedManifest.extensions.rootCaller, { keep: true });

// Migration is required even when the state's recorded checksum already matches.
delete patchedManifest.extensions.__poc_generated;
await fs.writeFile(manifestPath, JSON.stringify(patchedManifest));
await updateIndexStateManifest(indexDir);
const migrated = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
assert.equal(migrated.extensions.__poc_generated.kind, 'pieces-manifest');
assert.deepEqual(migrated.extensions.rootCaller, { keep: true });
const stableBytes = await fs.readFile(manifestPath, 'utf8');
await updateIndexStateManifest(indexDir);
assert.equal(await fs.readFile(manifestPath, 'utf8'), stableBytes);

console.log('embeddings manifest preserves non-embedding pieces test passed');
