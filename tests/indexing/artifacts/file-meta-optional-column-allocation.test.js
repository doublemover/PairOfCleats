#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildFileMetaColumnar } from '../../../src/index/build/artifacts/file-meta.js';

const fixture = JSON.parse(await fs.readFile(
  new URL('../../fixtures/indexing/file-meta-columnar.json', import.meta.url), 'utf8'));
for (const row of fixture.rows) if (row) Object.freeze(row);
Object.freeze(fixture.rows);
const mixed = buildFileMetaColumnar(fixture.rows);
assert.deepEqual(mixed, fixture.expected, 'late optional fields retain original null prefixes, values, tables and column order');
assert.equal(JSON.stringify(mixed), JSON.stringify(fixture.expected), 'serialized columnar output remains byte-identical');
assert.equal(mixed.arrays.externalDocs[1], fixture.rows[1].externalDocs, 'optional values retain their original ownership');
assert.deepEqual(buildFileMetaColumnar([]), { format: 'columnar', columns: ['id', 'file', 'ext'],
  length: 0, arrays: { id: [], file: [], ext: [] }, tables: { file: [], ext: [] } });

// The previous accessor contract may produce undefined after its type check.
let reads = 0;
const dynamic = { id: 0, file: 'a.js', ext: '.js',
  get encodingFallback() { reads += 1; return reads === 1 ? true : undefined; } };
const dynamicPayload = buildFileMetaColumnar([dynamic,
  { id: 1, file: 'b.js', ext: '.js', encodingFallback: false }]);
assert.deepEqual(dynamicPayload.arrays.encodingFallback, [undefined, false]);
assert.equal(reads, 2);
const sparse = new Array(3);
sparse[2] = { id: 2, file: 'a.js', ext: '.js', size: 0 };
assert.deepEqual(buildFileMetaColumnar(sparse).arrays.size, [null, null, 0]);

const originalPush = Array.prototype.push;
let nullAppends = 0;
let minimal;
try {
  Array.prototype.push = function (...values) {
    if (values.length === 1 && values[0] === null) nullAppends += 1;
    return originalPush.apply(this, values);
  };
  minimal = buildFileMetaColumnar(Array.from({ length: 64 }, (_, id) =>
    ({ id, file: `src/${id}.js`, ext: '.js' })));
} finally {
  Array.prototype.push = originalPush;
}
assert.deepEqual(minimal.columns, ['id', 'file', 'ext']);
assert.equal(minimal.arrays.id.length, 64);
assert.equal(minimal.tables.file.length, 64);
assert.deepEqual(minimal.tables.ext, ['.js']);
assert.equal(nullAppends, 0, 'absent optional columns must not construct temporary64-entry null arrays');
console.log('Columnar optional allocation passed: exact original mixed bytes, sparse/getter compatibility;960 discarded null appends removed');
