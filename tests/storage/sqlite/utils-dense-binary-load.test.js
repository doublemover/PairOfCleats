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
    && /missing required non-negative count/.test(String(error?.message || ''))
  ),
  'dense binary loader should hard-fail when .bin.meta.json omits count'
);
await fs.rm(metaPath, { force: true });

const largeBaseName = 'dense_vectors_code_uint8';
const largeBinPath = path.join(tempDir, `${largeBaseName}.bin`);
const largeMetaPath = path.join(tempDir, `${largeBaseName}.bin.meta.json`);
const largeDims = 256;
const largeCount = 20000; // 5.12MB payload -> exceeds 4MB streaming read window.
const largeVectors = Buffer.allocUnsafe(largeDims * largeCount);
for (let row = 0; row < largeCount; row += 1) {
  const offset = row * largeDims;
  largeVectors[offset] = row % 251;
  largeVectors[offset + 1] = (row * 3) % 251;
}
await fs.writeFile(largeBinPath, largeVectors);
await fs.writeFile(largeMetaPath, JSON.stringify({
  fields: {
    schemaVersion: '1.0.0',
    artifact: largeBaseName,
    format: 'uint8-row-major',
    path: `${largeBaseName}.bin`,
    dims: largeDims,
    count: largeCount,
    model: 'demo-model'
  }
}), 'utf8');

const previousInlineMaxMb = process.env.PAIROFCLEATS_DENSE_BINARY_MAX_INLINE_MB;
process.env.PAIROFCLEATS_DENSE_BINARY_MAX_INLINE_MB = '1';
try {
  const streamedOptional = loadSqliteIndexOptionalArtifacts(tempDir, { modelId: 'fallback-model' });
  assert.equal(streamedOptional?.denseVec?.streamed, true, 'expected dense binary payload to stream when inline budget is low');
  assert.equal(streamedOptional?.denseVec?.buffer, null, 'expected streamed dense payload to avoid materializing inline buffer');
  let seen = 0;
  let firstVector = null;
  let lastVector = null;
  for await (const entry of streamedOptional.denseVec.rows) {
    if (seen === 0) firstVector = Array.from(entry.vector.slice(0, 2));
    lastVector = Array.from(entry.vector.slice(0, 2));
    seen += 1;
  }
  assert.equal(seen, largeCount, 'expected streamed dense iterator to emit every row');
  assert.deepEqual(firstVector, [0, 0], 'expected first streamed row payload');
  assert.deepEqual(
    lastVector,
    [(largeCount - 1) % 251, ((largeCount - 1) * 3) % 251],
    'expected final streamed row payload'
  );
} finally {
  if (previousInlineMaxMb == null) delete process.env.PAIROFCLEATS_DENSE_BINARY_MAX_INLINE_MB;
  else process.env.PAIROFCLEATS_DENSE_BINARY_MAX_INLINE_MB = previousInlineMaxMb;
}

console.log('sqlite utils dense binary load test passed');
