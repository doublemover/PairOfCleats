#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  decodeBinaryRowFrameLengths,
  decodeU64Offsets,
  encodeBinaryRowFrames,
  writeBinaryRowFrames
} from '../../../src/shared/artifact-io/binary-columnar.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'binary-columnar-streaming-frames');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const rows = [
  JSON.stringify({ id: 0, file: 'src/a.js', text: 'hello' }),
  JSON.stringify({ id: 1, file: 'src/b.js', text: 'multi-byte-😀-ß' }),
  JSON.stringify({ id: 2, file: 'src/c.js', text: '' })
];

const expected = encodeBinaryRowFrames(rows);

const dataPath = path.join(tempRoot, 'chunk_meta.binary-columnar.bin');
const offsetsPath = path.join(tempRoot, 'chunk_meta.binary-columnar.offsets.bin');
const lengthsPath = path.join(tempRoot, 'chunk_meta.binary-columnar.lengths.varint');

const written = await writeBinaryRowFrames({
  rowBuffers: rows,
  dataPath,
  offsetsPath,
  lengthsPath
});

assert.equal(written.count, rows.length, 'row count mismatch');
assert.equal(written.totalBytes, expected.dataBuffer.length, 'total byte size mismatch');

const [dataBuffer, offsetsBuffer, lengthsBuffer] = await Promise.all([
  fs.readFile(dataPath),
  fs.readFile(offsetsPath),
  fs.readFile(lengthsPath)
]);

assert.equal(
  Buffer.compare(dataBuffer, expected.dataBuffer),
  0,
  'data frame payload mismatch'
);
assert.deepEqual(
  decodeU64Offsets(offsetsBuffer),
  expected.offsets,
  'offset sidecar mismatch'
);
assert.deepEqual(
  decodeBinaryRowFrameLengths(lengthsBuffer),
  expected.lengths,
  'length sidecar mismatch'
);

console.log('binary columnar streaming frames test passed');
