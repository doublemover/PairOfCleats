#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';
import {
  OFFSETS_COMPRESSION,
  OFFSETS_FORMAT,
  OFFSETS_FORMAT_VERSION,
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
const batch = await readJsonlRowsAt(jsonlPath, offsetsPath, [2, 0, 1], { maxBytes: 1024 });
assert.deepEqual(batch.map((entry) => entry?.id ?? null), [3, 1, 2]);
await validateOffsetsAgainstFile(jsonlPath, offsetsPath);

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
