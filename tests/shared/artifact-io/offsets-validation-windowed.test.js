import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { validateOffsetsAgainstFile } from '../../../src/shared/artifact-io/offsets.js';

const root = await makeTempDir('poc-offset-window-');
const dataPath = path.join(root, 'rows.jsonl');
const offsetsPath = path.join(root, 'rows.offsets.bin');
const originalOpen = fs.open;
const originalReadFile = fs.readFile;
let reads = [], closed = 0, opened = 0, truncateOffsets = false, cancel = null;
fs.open = async (...args) => {
  const handle = await originalOpen(...args);
  opened += 1;
  const read = handle.read.bind(handle), close = handle.close.bind(handle);
  handle.read = async (buffer, offset, length, position) => {
    reads.push({ file: args[0], length, capacity: buffer.length, position });
    const result = await read(buffer, offset, length, position);
    if (truncateOffsets && args[0] === offsetsPath && position > 0) result.bytesRead -= 1;
    cancel?.abort();
    return result;
  };
  handle.close = async () => { closed += 1; return close(); };
  return handle;
};
fs.readFile = async (...args) => {
  assert.notEqual(args[0], offsetsPath, 'validation must not materialize the sidecar');
  return originalReadFile(...args);
};
const encode = values => {
  const buffer = Buffer.alloc(values.length * 8);
  values.forEach((value, index) => buffer.writeBigUInt64LE(BigInt(value), index * 8));
  return buffer;
};
const rowCount = 18000;
const data = Buffer.from('{}\n'.repeat(rowCount));
const offsets = encode(Array.from({ length: rowCount }, (_, index) => index * 3));
const reset = async () => {
  await fs.writeFile(dataPath, data);
  await fs.writeFile(offsetsPath, offsets);
  // Exact representable timestamp lets cache invalidation exercise ctime too.
  await fs.utimes(dataPath, 1000000000, 1000000000);
  await fs.utimes(offsetsPath, 1000000000, 1000000000);
  reads = [];
};
try {
  await reset();
  await validateOffsetsAgainstFile(dataPath, offsetsPath);
  assert.ok(reads.length <= 8, 'dense validation should batch across multiple offset windows');
  assert.ok(reads.every(read => read.capacity <= 65536), 'scratch buffers remain bounded');
  assert.equal(opened, closed);
  reads = [];
  await validateOffsetsAgainstFile(dataPath, offsetsPath);
  assert.equal(reads.length, 0, 'cache hit must not read either file');

  // Corruption on both sides of an offset-buffer seam and at EOF must survive
  // coalescing; restored mtime/size must not make it a validation-cache hit.
  for (const position of [8192 * 3 - 1, 8193 * 3 - 1, data.length - 1]) {
    await reset();
    await validateOffsetsAgainstFile(dataPath, offsetsPath);
    const changed = Buffer.from(data); changed[position] = 0x20;
    await fs.writeFile(dataPath, changed);
    await fs.utimes(dataPath, 1000000000, 1000000000);
    await assert.rejects(validateOffsetsAgainstFile(dataPath, offsetsPath), { code: 'ERR_OFFSETS_INVALID' });
  }
  await reset();
  await validateOffsetsAgainstFile(dataPath, offsetsPath);
  const bad = Buffer.from(offsets); bad.writeBigUInt64LE(BigInt(8191 * 3), 8192 * 8);
  await fs.writeFile(offsetsPath, bad);
  await fs.utimes(offsetsPath, 1000000000, 1000000000);
  await assert.rejects(validateOffsetsAgainstFile(dataPath, offsetsPath), /not monotonic/);

  await reset(); truncateOffsets = true;
  await assert.rejects(validateOffsetsAgainstFile(dataPath, offsetsPath), /sidecar short read/);
  truncateOffsets = false;
  assert.equal(opened, closed, 'short reads close both handles');
  await reset(); cancel = new AbortController();
  await assert.rejects(validateOffsetsAgainstFile(dataPath, offsetsPath, { signal: cancel.signal }), { name: 'AbortError' });
  cancel = null;
  assert.equal(opened, closed, 'cancellation closes both handles');
  reads = [];
  await validateOffsetsAgainstFile(dataPath, offsetsPath);
  assert.ok(reads.length > 0, 'cancellation must not cache partial validation');

  // Widely separated boundaries must not scan large record payloads.
  const sparse = Buffer.alloc(300000, 0x20);
  sparse[99999] = sparse[199999] = sparse[299999] = 0x0a;
  await fs.writeFile(dataPath, sparse);
  await fs.writeFile(offsetsPath, encode([0, 100000, 200000]));
  reads = [];
  await validateOffsetsAgainstFile(dataPath, offsetsPath);
  assert.deepEqual(reads.filter(read => read.file === dataPath).map(read => read.length), [1, 1, 1]);
  await fs.writeFile(offsetsPath, Buffer.alloc(9));
  await assert.rejects(validateOffsetsAgainstFile(dataPath, offsetsPath), /misaligned/);
  await fs.writeFile(dataPath, Buffer.alloc(0)); await fs.writeFile(offsetsPath, Buffer.alloc(0));
  await validateOffsetsAgainstFile(dataPath, offsetsPath);
  assert.equal(opened, closed);
} finally {
  fs.open = originalOpen; fs.readFile = originalReadFile;
  await rmDirRecursive(root);
}
console.log('Windowed offsets validation, integrity, cache, bounded I/O and cancellation passed');
