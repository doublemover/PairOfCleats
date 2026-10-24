import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readOffsetsAt, readOffsetAt } from '../../../src/shared/artifact-io/offsets.js';
import { readVarintDeltasAt } from '../../../src/shared/artifact-io/varint.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: preserve the original offset and varint positive short-read
// assertions; varint now borrows actual descriptors with canonical fd/stat/close.
const bytes = Buffer.alloc(24);
[0n, 5n, 9n].forEach((value, index) => bytes.writeBigUInt64LE(value, index * 8));
const handle = { async read(buffer, offset, length, position) {
  const count = Math.min(3, length, Math.max(0, bytes.length - position));
  bytes.copy(buffer, offset, position, position + count); return { bytesRead: count };
} };
assert.deepEqual([...await readOffsetsAt('unused', [0, 1, 2], { handle })], [[0, 0], [1, 5], [2, 9]]);
assert.equal(await readOffsetAt('unused', 1, { handle }), 5);
assert.equal(await readOffsetAt('unused', 3, { handle }), null);
const root = await makeTempDir('poc-positioned-short-read-'), originalOpen = fs.open;
let closes = 0;
try {
  const file = path.join(root, 'varints'); await fs.writeFile(file, Buffer.from('AB'));
  fs.open = async (...args) => {
    const actual = await originalOpen(...args), originalRead = actual.read, originalClose = actual.close;
    actual.read = function (buffer, offset, length, position) {
      return originalRead.call(actual, buffer, offset, Math.min(1, length), position);
    };
    actual.close = function () { closes += 1; return originalClose.call(actual); };
    return actual;
  };
  assert.deepEqual(await readVarintDeltasAt(file, 0, 2), [65, 131]);
  await assert.rejects(readVarintDeltasAt(file, 0, 3), /Truncated varint read/);
  assert.equal(closes, 2);
} finally { fs.open = originalOpen; await rmDirRecursive(root); }
console.log('offset and varint consumers retain valid rows across positive short reads');
