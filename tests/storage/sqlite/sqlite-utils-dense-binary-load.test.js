#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadSqliteIndexOptionalArtifacts } from '../../../src/storage/sqlite/utils.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempDir = resolveTestCachePath(root, 'sqlite-utils-dense-binary-load');
await fs.rm(tempDir, { recursive: true, force: true });
await fs.mkdir(tempDir, { recursive: true });

const baseName = 'dense_vectors_uint8';
const binPath = path.join(tempDir, `${baseName}.bin`);
const metaPath = path.join(tempDir, `${baseName}.bin.meta.json`);
const vectors = new Uint8Array([
  1, 2, 3,
  4, 5, 6
]);
await fs.writeFile(binPath, vectors);
await fs.writeFile(metaPath, JSON.stringify({
  fields: {
    schemaVersion: '1.0.0',
    artifact: baseName,
    format: 'uint8-row-major',
    path: `${baseName}.bin`,
    dims: 3,
    count: 2,
    model: 'demo-model'
  }
}), 'utf8');

const optional = loadSqliteIndexOptionalArtifacts(tempDir, { modelId: 'fallback-model' });
assert.ok(optional?.denseVec, 'expected denseVec');
assert.ok(ArrayBuffer.isView(optional.denseVec.buffer), 'expected binary dense buffer');
assert.equal(optional.denseVec.dims, 3, 'dims mismatch');
assert.equal(optional.denseVec.count, 2, 'count mismatch');
assert.equal(optional.denseVec.model, 'demo-model', 'model mismatch');

const rows = [];
for await (const entry of optional.denseVec.rows) {
  rows.push(Array.from(entry.vector));
}
assert.deepEqual(rows, [[1, 2, 3], [4, 5, 6]], 'dense rows mismatch');

const outsideBinPath = path.join(root, '.testCache', 'sqlite-utils-dense-binary-outside.bin');
await fs.writeFile(outsideBinPath, vectors);
await fs.writeFile(metaPath, JSON.stringify({
  fields: {
    schemaVersion: '1.0.0',
    artifact: baseName,
    format: 'uint8-row-major',
    path: path.posix.join('..', '..', '.testCache', 'sqlite-utils-dense-binary-outside.bin'),
    dims: 3,
    count: 2,
    model: 'demo-model'
  }
}), 'utf8');

const blockedTraversal = loadSqliteIndexOptionalArtifacts(tempDir, { modelId: 'fallback-model' });
assert.equal(
  blockedTraversal?.denseVec,
  null,
  'dense binary loader should reject traversal paths in .bin.meta.json'
);

await fs.writeFile(metaPath, JSON.stringify({
  fields: {
    schemaVersion: '1.0.0',
    artifact: baseName,
    format: 'uint8-row-major',
    path: `${baseName}.bin`,
    dims: 3,
    model: 'demo-model'
  }
}), 'utf8');

assert.throws(
  () => loadSqliteIndexOptionalArtifacts(tempDir, { modelId: 'fallback-model' }),
  (error) => (
    error?.code === 'ERR_SQLITE_DENSE_BINARY_META_INVALID'
    && /missing required positive count/.test(String(error?.message || ''))
  ),
  'dense binary loader should hard-fail when .bin.meta.json omits count'
);

console.log('sqlite utils dense binary load test passed');
