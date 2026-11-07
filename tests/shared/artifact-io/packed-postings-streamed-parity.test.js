#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { packTfPostings, encodePackedOffsets, iteratePackedTfPostings } from '../../../src/shared/packed-postings.js';
import { writePackedTfPostings } from '../../../src/shared/packed-postings-write.js';
applyTestEnv();
const varint = value => {
  let next = Number(value); if (!Number.isFinite(next) || next < 0) next = 0;
  next = Math.floor(next); const result = [];
  while (next >= 128) { result.push((next & 127) | 128); next = Math.floor(next / 128); }
  result.push(next); return Buffer.from(result);
};
const reference = (lists, blockSize) => {
  const parts = [], offsets = []; let size = 0;
  for (const list of lists) {
    offsets.push(size); const blocks = [varint(list.length)]; let previous = 0;
    for (let index = 0; index < list.length; index += 1) {
      if (index % blockSize === 0) previous = 0;
      const doc = Number(list[index]?.[0]) || 0, tf = Number(list[index]?.[1]) || 0;
      blocks.push(varint(Math.max(0, Math.floor(doc - previous))), varint(tf)); previous = doc;
    }
    const encoded = Buffer.concat(blocks); parts.push(encoded); size += encoded.length;
  }
  offsets.push(size); return { buffer: Buffer.concat(parts), offsets };
};
const lists = [[], ...Array.from({ length: 9000 }, (_, id) => [[id, 1], [id + 200, 129]]), [[-1, NaN], [0, 0], [300, 3.5]]];
const root = resolveTestCachePath(process.cwd(), 'packed-postings-streamed-parity'); await fs.mkdir(root, { recursive: true });
for (const blockSize of [1, 128, 3]) {
  const expected = reference(lists, blockSize), packed = packTfPostings(lists, { blockSize });
  assert.deepEqual(packed.buffer, expected.buffer); assert.deepEqual(packed.offsets, expected.offsets);
  for (const slab of iteratePackedTfPostings(lists, { blockSize })) assert.ok(slab.length <= 65536);
  const data = path.join(root, `data-${blockSize}.bin`), offsets = path.join(root, `offsets-${blockSize}.bin`);
  const receipt = await writePackedTfPostings(data, offsets, lists, { blockSize });
  assert.deepEqual(await fs.readFile(data), expected.buffer);
  assert.deepEqual(await fs.readFile(offsets), encodePackedOffsets(expected.offsets));
  assert.equal(receipt.data.bytes, expected.buffer.length);
  assert.equal(receipt.data.checksumHash, `sha256:${createHash('sha256').update(expected.buffer).digest('hex')}`);
}
