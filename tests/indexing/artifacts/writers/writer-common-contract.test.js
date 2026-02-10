#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  resolveJsonlExtension,
  resolveJsonExtension,
  measureJsonlRows,
  buildJsonlVariantPaths,
  buildJsonVariantPaths,
  buildShardedPartEntries,
  writeShardedJsonlMeta
} from '../../../../src/index/build/artifacts/writers/_common.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'writer-common-contract');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

assert.equal(resolveJsonlExtension(null), 'jsonl');
assert.equal(resolveJsonlExtension('gzip'), 'jsonl.gz');
assert.equal(resolveJsonlExtension('zstd'), 'jsonl.zst');
assert.equal(resolveJsonExtension(null), 'json');
assert.equal(resolveJsonExtension('gzip'), 'json.gz');
assert.equal(resolveJsonExtension('zstd'), 'json.zst');

const measured = measureJsonlRows([{ id: 1 }, { id: 22 }]);
assert.equal(typeof measured.totalBytes, 'number');
assert.equal(typeof measured.maxLineBytes, 'number');
assert.ok(measured.totalBytes >= measured.maxLineBytes, 'total bytes should include max line bytes');

const jsonlVariants = buildJsonlVariantPaths({ outDir: tempRoot, baseName: 'symbols', includeOffsets: true });
assert.deepEqual(
  jsonlVariants.map((entry) => path.basename(entry)),
  ['symbols.jsonl', 'symbols.jsonl.gz', 'symbols.jsonl.zst', 'symbols.jsonl.offsets.bin']
);

const jsonVariants = buildJsonVariantPaths({ outDir: tempRoot, baseName: 'file_relations' });
assert.deepEqual(
  jsonVariants.map((entry) => path.basename(entry)),
  ['file_relations.json', 'file_relations.json.gz', 'file_relations.json.zst']
);

const result = {
  parts: ['symbols.parts/part-00000.jsonl', 'symbols.parts/part-00001.jsonl'],
  counts: [2, 1],
  bytes: [120, 80],
  total: 3,
  totalBytes: 200,
  maxPartRecords: 2,
  maxPartBytes: 120,
  targetMaxBytes: 150
};

const parts = buildShardedPartEntries(result);
assert.deepEqual(parts, [
  { path: 'symbols.parts/part-00000.jsonl', records: 2, bytes: 120 },
  { path: 'symbols.parts/part-00001.jsonl', records: 1, bytes: 80 }
]);

const metaPath = path.join(tempRoot, 'symbols.meta.json');
await writeShardedJsonlMeta({
  metaPath,
  artifact: 'symbols',
  compression: null,
  result,
  parts,
  extensions: { offsets: { suffix: 'offsets.bin' } }
});
const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
assert.equal(meta.artifact, 'symbols');
assert.equal(meta.format, 'jsonl-sharded');
assert.equal(meta.totalRecords, 3);
assert.equal(meta.parts.length, 2);

console.log('writer common contract test passed');
