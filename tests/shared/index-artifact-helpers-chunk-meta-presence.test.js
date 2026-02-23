#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  hasChunkMetaArtifactsAsync,
  hasChunkMetaArtifactsSync
} from '../../src/shared/index-artifact-helpers.js';
import { writePiecesManifest } from '../helpers/artifact-io-fixture.js';

import { resolveTestCachePath } from '../helpers/test-cache.js';

const root = process.cwd();
const testRoot = resolveTestCachePath(root, 'index-artifact-helpers-chunk-meta-presence');
await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(testRoot, { recursive: true });

const assertPresence = async (dir, expected, label) => {
  const syncValue = hasChunkMetaArtifactsSync(dir);
  const asyncValue = await hasChunkMetaArtifactsAsync(dir);
  assert.equal(syncValue, expected, `${label} (sync)`);
  assert.equal(asyncValue, expected, `${label} (async)`);
};

const compressedDir = path.join(testRoot, 'compressed');
await fs.mkdir(compressedDir, { recursive: true });
await fs.writeFile(path.join(compressedDir, 'chunk_meta.jsonl.gz'), 'compressed\n', 'utf8');
await assertPresence(compressedDir, true, 'compressed chunk meta should be detected');

const shardedMetaOnlyDir = path.join(testRoot, 'sharded-meta-only');
await fs.mkdir(shardedMetaOnlyDir, { recursive: true });
await fs.writeFile(path.join(shardedMetaOnlyDir, 'chunk_meta.meta.json'), JSON.stringify({ parts: [] }, null, 2), 'utf8');
await assertPresence(shardedMetaOnlyDir, false, 'sharded meta without parts should not be detected');

const shardedDir = path.join(testRoot, 'sharded-valid');
await fs.mkdir(path.join(shardedDir, 'chunk_meta.parts'), { recursive: true });
await fs.writeFile(path.join(shardedDir, 'chunk_meta.meta.json'), JSON.stringify({ parts: [] }, null, 2), 'utf8');
await assertPresence(shardedDir, true, 'sharded meta with parts should be detected');

const binaryMetaOnlyDir = path.join(testRoot, 'binary-meta-only');
await fs.mkdir(binaryMetaOnlyDir, { recursive: true });
await fs.writeFile(
  path.join(binaryMetaOnlyDir, 'chunk_meta.binary-columnar.meta.json'),
  JSON.stringify({ data: 'chunk_meta.binary-columnar.bin' }, null, 2),
  'utf8'
);
await assertPresence(binaryMetaOnlyDir, false, 'binary-columnar meta without sidecars should not be detected');

const binaryValidDir = path.join(testRoot, 'binary-valid');
await fs.mkdir(binaryValidDir, { recursive: true });
await fs.writeFile(
  path.join(binaryValidDir, 'chunk_meta.binary-columnar.meta.json'),
  JSON.stringify({
    data: 'chunk_meta.binary-columnar.bin',
    offsets: 'chunk_meta.binary-columnar.offsets.bin',
    lengths: 'chunk_meta.binary-columnar.lengths.varint'
  }, null, 2),
  'utf8'
);
await fs.writeFile(path.join(binaryValidDir, 'chunk_meta.binary-columnar.bin'), Buffer.from([1, 2, 3]));
await fs.writeFile(path.join(binaryValidDir, 'chunk_meta.binary-columnar.offsets.bin'), Buffer.from([0, 0, 0, 0]));
await fs.writeFile(path.join(binaryValidDir, 'chunk_meta.binary-columnar.lengths.varint'), Buffer.from([3]));
await assertPresence(binaryValidDir, true, 'binary-columnar sidecars should be detected');

const manifestDir = path.join(testRoot, 'manifest-custom');
await fs.mkdir(path.join(manifestDir, 'pieces', 'custom'), { recursive: true });
await fs.writeFile(path.join(manifestDir, 'pieces', 'custom', 'chunk-data.json'), '[]', 'utf8');
await writePiecesManifest(manifestDir, [
  { name: 'chunk_meta', path: 'pieces/custom/chunk-data.json', format: 'json' }
]);
await assertPresence(manifestDir, true, 'manifest chunk_meta entry should be detected');

const oversizedManifestDir = path.join(testRoot, 'manifest-oversized');
await fs.mkdir(path.join(oversizedManifestDir, 'pieces'), { recursive: true });
await fs.writeFile(
  path.join(oversizedManifestDir, 'pieces', 'manifest.json'),
  'x'.repeat((2 * 1024 * 1024) + 16),
  'utf8'
);
await assertPresence(
  oversizedManifestDir,
  true,
  'oversized manifest should still count as present for coarse chunk-meta checks'
);

console.log('index artifact helper chunk-meta presence tests passed');
