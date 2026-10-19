#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesFile } from '../../../src/shared/json-stream/jsonl-write.js';
import {
  OFFSETS_COMPRESSION,
  OFFSETS_FORMAT,
  OFFSETS_FORMAT_VERSION,
  openJsonlRowReader,
  readJsonlRowAt,
  readJsonlRowsAt,
  resolveOffsetsCount,
  validateOffsetsAgainstFile
} from '../../../src/shared/artifact-io/offsets.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'offsets-unified');
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

const jsonlPath = path.join(cacheRoot, 'rows.jsonl');
const offsetsPath = path.join(cacheRoot, 'rows.jsonl.offsets.bin');

const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
await writeJsonLinesFile(jsonlPath, rows, {
  atomic: true,
  offsets: { path: offsetsPath, atomic: true }
});

const count = await resolveOffsetsCount(offsetsPath);
assert.equal(count, rows.length);
const middle = await readJsonlRowAt(jsonlPath, offsetsPath, 1, { maxBytes: 1024 });
assert.equal(middle.id, 2);
await assert.rejects(
  () => readJsonlRowAt(jsonlPath, offsetsPath, 1, { maxBytes: 0.5 }),
  (err) => err?.code === 'ERR_INVALID_MAX_BYTES',
  'expected fractional maxBytes to be rejected in strict integer mode'
);
const batch = await readJsonlRowsAt(jsonlPath, offsetsPath, [2, 0, 1], { maxBytes: 1024 });
assert.deepEqual(batch.map((entry) => entry?.id ?? null), [3, 1, 2]);
await validateOffsetsAgainstFile(jsonlPath, offsetsPath);

// Keep real file handles observable when either peer open fails. A successful
// open may resolve after its peer rejects; rejection must await its disposal.
const originalOpen = fs.open;
const missingPath = path.join(cacheRoot, 'missing.jsonl');
for (const read of [
  (data, offsets) => readJsonlRowAt(data, offsets, 0),
  (data, offsets) => readJsonlRowsAt(data, offsets, [0]),
  (data, offsets) => openJsonlRowReader(data, offsets)
]) {
  for (const [data, offsets] of [[missingPath, offsetsPath], [jsonlPath, missingPath]]) {
    const handles = [], pending = [];
    fs.open = (...args) => {
      const open = originalOpen(...args);
      pending.push(open);
      return open.then(handle => { handles.push(handle); return handle; });
    };
    try {
      await assert.rejects(() => read(data, offsets), { code: 'ENOENT' });
      await Promise.allSettled(pending);
      assert.equal(handles.length, 1, 'the valid peer opened a real file');
      assert.ok(handles.every(handle => handle.fd === -1), 'partial-open rejection closes its successful peer');
    } finally {
      fs.open = originalOpen;
      await Promise.allSettled(handles.map(handle => handle.close()));
    }
  }
}

const opened = [];
fs.open = async (...args) => {
  const handle = await originalOpen(...args);
  opened.push(handle);
  return handle;
};
let scoped;
try {
  scoped = await openJsonlRowReader(jsonlPath, offsetsPath);
  const [first, second] = await Promise.all([
    scoped.readRows([2, 0, 2], { maxBytes: 1024 }),
    scoped.readRows([1], { maxBytes: 1024 })
  ]);
  assert.deepEqual(first, [rows[2], rows[0], rows[2]]);
  assert.deepEqual(second, [rows[1]]);
  await assert.rejects(() => scoped.readRows([0], { maxBytes: 1 }), { code: 'ERR_JSON_TOO_LARGE' });
  assert.equal(opened.length, 2, 'positioned probes share just one handle pair');
} finally {
  fs.open = originalOpen;
  await scoped?.close();
}
assert.ok(opened.every(handle => handle.fd === -1), 'scoped readers dispose both files after failed reads');
await scoped.close();
assert.throws(() => scoped.readRows([0]), /reader is closed/);

// Disposal must drain an already-started read instead of closing its files
// while that read is still using them. Gate actual I/O, rather than a timer.
const readStarted = Promise.withResolvers(), releaseRead = Promise.withResolvers();
const pendingHandles = [];
let closeCalls = 0, pendingReader, reading, closing;
fs.open = async (...args) => {
  const handle = await originalOpen(...args);
  pendingHandles.push(handle);
  const read = handle.read.bind(handle), close = handle.close.bind(handle);
  handle.read = async (...readArgs) => {
    const result = await read(...readArgs);
    readStarted.resolve();
    await releaseRead.promise;
    return result;
  };
  handle.close = async () => { closeCalls += 1; return close(); };
  return handle;
};
try {
  pendingReader = await openJsonlRowReader(jsonlPath, offsetsPath);
  reading = pendingReader.readRows([1]);
  await readStarted.promise;
  closing = pendingReader.close();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closeCalls, 0, 'close must wait for outstanding positioned reads');
  releaseRead.resolve();
  assert.deepEqual(await reading, [rows[1]]);
  await closing;
  assert.equal(closeCalls, 2);
  assert.ok(pendingHandles.every(handle => handle.fd === -1));
} finally {
  fs.open = originalOpen;
  releaseRead.resolve();
  await Promise.allSettled([reading, closing]);
  await pendingReader?.close();
}

const encodeOffsets = (values) => {
  const buffer = Buffer.alloc(values.length * 8);
  for (let i = 0; i < values.length; i += 1) {
    buffer.writeBigUInt64LE(BigInt(values[i]), i * 8);
  }
  return buffer;
};

const invalidStartOffsetsPath = path.join(cacheRoot, 'rows.invalid-start.offsets.bin');
await fs.writeFile(invalidStartOffsetsPath, encodeOffsets([1, 11, 21]));
await assert.rejects(
  () => validateOffsetsAgainstFile(jsonlPath, invalidStartOffsetsPath),
  (err) => String(err?.message || '').includes('Offsets must start at zero'),
  'expected offsets validator to reject non-zero first offset'
);

const invalidBoundaryOffsetsPath = path.join(cacheRoot, 'rows.invalid-boundary.offsets.bin');
await fs.writeFile(invalidBoundaryOffsetsPath, encodeOffsets([0, 10, 21]));
await assert.rejects(
  () => validateOffsetsAgainstFile(jsonlPath, invalidBoundaryOffsetsPath),
  (err) => String(err?.message || '').includes('Offset boundary missing newline'),
  'expected offsets validator to reject offsets that are not newline-aligned'
);

assert.equal(OFFSETS_FORMAT, 'u64-le');
assert.equal(OFFSETS_FORMAT_VERSION, 1);
assert.equal(OFFSETS_COMPRESSION, 'none');
