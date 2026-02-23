#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { readJsonLinesIterator } from '../../../src/shared/artifact-io.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'jsonl-byte-range-compressed-fallback');
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

const jsonlPath = path.join(cacheRoot, 'rows.jsonl');
const lineOne = '{"id":1}\n';
const lineTwo = '{"id":2}\n';
const payload = `${lineOne}${lineTwo}`;
await fs.writeFile(jsonlPath, payload, 'utf8');
await fs.writeFile(`${jsonlPath}.gz`, gzipSync(payload));

const rangedRows = [];
for await (const row of readJsonLinesIterator(jsonlPath, {
  byteRange: {
    start: 0,
    end: Buffer.byteLength(lineOne)
  }
})) {
  rangedRows.push(row);
}
assert.deepEqual(rangedRows, [{ id: 1 }], 'byte-range reads should use uncompressed JSONL when compressed siblings exist');

let compressedRangeThrew = false;
try {
  for await (const _row of readJsonLinesIterator(`${jsonlPath}.gz`, {
    byteRange: {
      start: 0,
      end: Buffer.byteLength(lineOne)
    }
  })) {
    // no-op
  }
} catch (err) {
  compressedRangeThrew = true;
  assert.match(
    String(err?.message || ''),
    /uncompressed JSONL source/,
    'expected explicit error for byte-range reads on compressed JSONL'
  );
}
assert.equal(compressedRangeThrew, true, 'expected compressed byte-range reads to fail fast');

console.log('jsonl byte-range compressed fallback test passed');
