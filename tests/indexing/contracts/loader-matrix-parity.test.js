#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadChunkMeta } from '../../../src/shared/artifact-io.js';
import { ARTIFACT_SURFACE_VERSION, SHARDED_JSONL_META_SCHEMA_VERSION } from '../../../src/contracts/versioning.js';

applyTestEnv();

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-loader-matrix-'));
const expected = [{ id: 0, file: 'src/a.js', start: 0, end: 1 }];

const writeManifest = async (dir, pieces) => {
  const piecesDir = path.join(dir, 'pieces');
  await fs.mkdir(piecesDir, { recursive: true });
  const manifest = {
    version: 2,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    compatibilityKey: 'compat-test',
    pieces
  };
  await fs.writeFile(path.join(piecesDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
};

const jsonDir = path.join(rootDir, 'json');
await fs.mkdir(jsonDir, { recursive: true });
await fs.writeFile(path.join(jsonDir, 'chunk_meta.json'), JSON.stringify(expected, null, 2));
await writeManifest(jsonDir, [
  { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' }
]);

const jsonlDir = path.join(rootDir, 'jsonl');
await fs.mkdir(jsonlDir, { recursive: true });
await fs.writeFile(
  path.join(jsonlDir, 'chunk_meta.jsonl'),
  `${expected.map((row) => JSON.stringify(row)).join('\n')}\n`
);
await writeManifest(jsonlDir, [
  { name: 'chunk_meta', path: 'chunk_meta.jsonl', format: 'jsonl' }
]);

const shardedDir = path.join(rootDir, 'sharded');
const partsDir = path.join(shardedDir, 'chunk_meta.parts');
await fs.mkdir(partsDir, { recursive: true });
const partName = 'chunk_meta.part-00000.jsonl';
const partPath = path.join(partsDir, partName);
await fs.writeFile(partPath, `${JSON.stringify(expected[0])}\n`);
const partStat = await fs.stat(partPath);
await fs.writeFile(
  path.join(shardedDir, 'chunk_meta.meta.json'),
  JSON.stringify({
    schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION,
    artifact: 'chunk_meta',
    format: 'jsonl-sharded',
    generatedAt: new Date().toISOString(),
    compression: 'none',
    totalRecords: 1,
    totalBytes: partStat.size,
    maxPartRecords: 1,
    maxPartBytes: partStat.size,
    targetMaxBytes: null,
    parts: [{
      path: path.posix.join('chunk_meta.parts', partName),
      records: 1,
      bytes: partStat.size
    }]
  }, null, 2)
);
await writeManifest(shardedDir, [
  { name: 'chunk_meta', path: path.posix.join('chunk_meta.parts', partName), format: 'jsonl' },
  { name: 'chunk_meta_meta', path: 'chunk_meta.meta.json', format: 'json' }
]);

const loadedJson = await loadChunkMeta(jsonDir, { strict: true });
const loadedJsonl = await loadChunkMeta(jsonlDir, { strict: true });
const loadedSharded = await loadChunkMeta(shardedDir, { strict: true });

assert.deepStrictEqual(loadedJson, expected, 'json chunk_meta should load');
assert.deepStrictEqual(loadedJsonl, expected, 'jsonl chunk_meta should load');
assert.deepStrictEqual(loadedSharded, expected, 'sharded chunk_meta should load');

console.log('loader matrix parity test passed');
