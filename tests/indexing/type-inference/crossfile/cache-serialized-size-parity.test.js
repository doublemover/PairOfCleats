#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  measureCrossFileCachePayloadBytes,
  writeCrossFileInferenceCache
} from '../../../../src/index/type-inference-crossfile/cache.js';
import { writeJsonValue } from '../../../../src/shared/json-stream/encode.js';
import { writeJsonObjectFile } from '../../../../src/shared/json-stream/json-writers.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = resolveTestCachePath(process.cwd(), 'crossfile-cache-serialized-size-parity');
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });

const countRow = async (row) => {
  let rowBytes = 0;
  await writeJsonValue({ write(chunk) { rowBytes += Buffer.byteLength(chunk, 'utf8'); return true; } }, row);
  return {
    rowBytes,
    get row() { throw new Error('Final sizing must not inspect or reserialize retained rows.'); }
  };
};
const sparse = new Array(4);
sparse[2] = '非ASCII 💡\n"\\';
const cases = [
  { fields: {}, rows: [] },
  { fields: { missing: undefined, 'escaped\nkey': '💡\t"\\' }, rows: [] },
  { fields: { version: 1, numbers: [NaN, Infinity, -0] }, rows: [{ id: '漢字', sparse, typed: new Uint16Array([1, 256, 65535]) }] },
  { fields: { stats: { typed: new Uint8Array([1, 2]), optional: undefined } }, rows: [null, false, 'é\n', { value: { toJSON: () => ({ encoded: '✓' }) } }] },
  { fields: { version: 1 }, rows: Array.from({ length: 128 }, (_, index) => ({ id: index, nested: { value: `row-${index} 💡` } })) }
];

try {
  for (const [index, { fields, rows }] of cases.entries()) {
    const rowEntries = [];
    for (const row of rows) rowEntries.push(await countRow(row));
    const measured = await measureCrossFileCachePayloadBytes(fields, rowEntries);
    const file = path.join(root, `parity-${index}.json`);
    const written = await writeJsonObjectFile(file, { fields, arrays: { rows }, atomic: true, trailingNewline: false });
    assert.equal(measured, (await fs.stat(file)).size, `case ${index}: exact streamed bytes`);
    assert.equal(measured, written.bytes, `case ${index}: writer byte counter parity`);
  }

  const cachePath = path.join(root, 'output-cache.json');
  let relationSerializations = 0;
  const chunks = [
    {
      chunkUid: 'unicode:漢字💡',
      codeRelations: { toJSON() { relationSerializations += 1; return { calls: [['f', 'g']], sparse }; } },
      docmeta: { summary: 'escaped\n"\\💡', typed: new Uint8Array([1, 2, 255]) }
    },
    { chunkUid: 'second', codeRelations: { calls: [] }, docmeta: { nested: { value: 'é' } } }
  ];
  const logs = [];
  const write = (maxBytes) => writeCrossFileInferenceCache({
    cacheDir: root, cachePath, chunks, crossFileFingerprint: 'size-parity',
    stats: { linkedCalls: 1, bundleSizing: { typed: new Uint8Array([2, 4]) } },
    maxBytes, log: (line) => logs.push(line)
  });
  const stringify = JSON.stringify;
  JSON.stringify = (value, ...args) => {
    if (value && typeof value === 'object' && Array.isArray(value.rows) && value.rows.length > 0) {
      throw new Error('Whole-cache serialization is forbidden.');
    }
    if (Array.isArray(value) && value.some((entry) => entry && Object.hasOwn(entry, 'codeRelations') && Object.hasOwn(entry, 'docmeta'))) {
      throw new Error('Whole-row-array serialization is forbidden.');
    }
    return stringify(value, ...args);
  };
  try {
    await write(100000);
  } finally {
    JSON.stringify = stringify;
  }
  assert.equal(relationSerializations, 2, 'one row measurement plus one streamed write, with no final row serialization');
  assert.ok(!logs.some((line) => line.includes('write failed')));
  const decoded = JSON.parse(await fs.readFile(cachePath, 'utf8'));
  assert.deepEqual(decoded.rows[0].docmeta.typed, [1, 2, 255]);
  assert.deepEqual(decoded.rows[0].codeRelations.sparse, [null, null, sparse[2], null]);

  // The maxBytes number is itself metadata. Converge its digit width, then test
  // exact acceptance and one-byte rejection using the real producer output.
  let cap = (await fs.stat(cachePath)).size;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await write(cap);
    const size = (await fs.stat(cachePath)).size;
    if (size === cap) break;
    cap = size;
  }
  assert.equal((await fs.stat(cachePath)).size, cap, 'the exact final byte cap must be accepted');
  assert.equal(JSON.parse(await fs.readFile(cachePath, 'utf8')).admission.maxBytes, cap,
    'exact-cap acceptance must publish the new payload, not retain an older file');
  assert.equal(String(cap - 1).length, String(cap).length, 'boundary fixture keeps metadata digit width stable');
  const before = await fs.readFile(cachePath);
  logs.length = 0;
  await write(cap - 1);
  assert.ok(logs.some((line) => line.includes(`final payload ${cap} bytes exceeds max ${cap - 1} bytes`)),
    'the exact measured size must reject a one-byte-smaller cap');
  assert.deepEqual(await fs.readFile(cachePath), before, 'a rejected write must preserve the previous cache bytes');
  console.log('cross-file cache size matches streaming bytes without whole-payload materialization');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
