#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openDenseVectorBinarySourceSync, iterateDenseVectorBinaryRows } from '../../src/shared/dense-vector-stream.js';
import { buildDenseVectorValidity } from '../../src/shared/dense-vector-validity.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';

const root = resolveTestCachePath(process.cwd(), `dense-stream-progress-${process.pid}-${Date.now()}`);
await fsPromises.mkdir(root, { recursive: true });
const filename = path.join(root, 'vectors.bin'), bytes = Buffer.from([1, 2, 3, 0, 0, 0, 0, 0, 0, 9, 8, 7]);
await fsPromises.writeFile(filename, bytes);
const meta = { count: 4, dims: 3, validity: buildDenseVectorValidity([[1, 2, 3], [], [0, 0, 0], [9, 8, 7]]) };
const originalRead = fs.readSync, originalOpen = fsPromises.open;
try {
  const work = {}, source = openDenseVectorBinarySourceSync({ root, filename, meta, maxBytes: 6, metrics: work });
  fs.readSync = (fd, buffer, offset, length, position) => originalRead(fd, buffer, offset, Math.min(length, 1), position);
  try {
    assert.deepEqual(Array.from(source, row => [row.docId, Array.from(row.vector)]),
      [[0, [1, 2, 3]], [1, []], [2, [0, 0, 0]], [3, [9, 8, 7]]]);
    assert.equal(work.bytesRead, bytes.length);
    assert.equal(work.readCalls, bytes.length);
    assert.equal(work.peakWindowBytes, 6);
  } finally { source.close(); fs.readSync = originalRead; }
  let closed = 0;
  fsPromises.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === filename) {
      const read = handle.read.bind(handle), close = handle.close.bind(handle);
      handle.read = (buffer, offset, length, position) => read(buffer, offset, Math.min(length, 2), position);
      handle.close = async () => { closed++; return close(); };
    }
    return handle;
  };
  const subset = [];
  for await (const row of iterateDenseVectorBinaryRows({ root, filename, meta, start: 1, count: 2, maxBytes: 6,
    expectedChecksum: `sha256:${createHash('sha256').update(bytes).digest('hex')}` })) subset.push([row.docId, Array.from(row.vector)]);
  assert.deepEqual(subset, [[1, []], [2, [0, 0, 0]]]);
  assert.equal(closed, 1);
  const controller = new AbortController();
  await assert.rejects(async () => {
    for await (const row of iterateDenseVectorBinaryRows({ root, filename, meta, signal: controller.signal })) {
      assert.equal(row.docId, 0); controller.abort();
    }
  }, { name: 'AbortError' });
  assert.equal(closed, 2, 'cancellation closes the owned descriptor');
  fsPromises.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === filename) {
      const close = handle.close.bind(handle);
      handle.read = async () => ({ bytesRead: 0 });
      handle.close = async () => { closed++; return close(); };
    }
    return handle;
  };
  await assert.rejects(async () => { for await (const row of iterateDenseVectorBinaryRows({ root, filename, meta })) void row; },
    { code: 'ERR_DENSE_VECTOR_STREAM' });
  assert.equal(closed, 3, 'zero progress refuses publication and closes the descriptor');
  console.log('Dense vector streams preserve short-read progress, range ordinals, bounded windows and cancellation ownership.');
} finally {
  fs.readSync = originalRead; fsPromises.open = originalOpen;
  await fsPromises.rm(root, { recursive: true, force: true });
}
