#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createChunkMetaIterator,
  enqueueChunkMetaArtifacts
} from '../../../src/index/build/artifacts/writers/chunk-meta.js';
import { stripChunkMetaColdFields, extractChunkMetaColdFields } from '../../../src/shared/chunk-meta-cold.js';
import { decodeBinaryRowFrameLengths, decodeU64Offsets } from '../../../src/shared/artifact-io/binary-columnar.js';
import { toPosix } from '../../../src/shared/files.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'chunk-meta-single-pass-fanout-parity');
const outDir = path.join(tempRoot, 'index');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const chunks = [
  {
    id: 0,
    chunkId: 'chunk-0',
    file: 'src/alpha.js',
    start: 0,
    end: 12,
    startLine: 1,
    endLine: 1,
    kind: 'code',
    metaV2: { schemaVersion: 3, chunkUid: 'uid-0' },
    preContext: 'before-0',
    postContext: 'after-0'
  },
  {
    id: 1,
    chunkId: 'chunk-1',
    file: 'src/beta.js',
    start: 13,
    end: 30,
    startLine: 2,
    endLine: 4,
    kind: 'code',
    metaV2: { schemaVersion: 3, chunkUid: 'uid-1' },
    preContext: 'before-1',
    postContext: 'after-1'
  },
  {
    id: 2,
    chunkId: 'chunk-2',
    file: 'src/alpha.js',
    start: 31,
    end: 46,
    startLine: 5,
    endLine: 7,
    kind: 'code',
    metaV2: { schemaVersion: 3, chunkUid: 'uid-2' },
    preContext: 'before-2',
    postContext: 'after-2'
  }
];

const chunkMetaIterator = createChunkMetaIterator({
  chunks,
  fileIdByPath: new Map(),
  resolvedTokenMode: 'none',
  tokenSampleSize: 0,
  maxJsonBytes: 1024 * 1024
});

const writes = [];
const enqueueWrite = (_label, job) => writes.push(job);
const enqueueJsonArray = (label) => {
  throw new Error(`Unexpected enqueueJsonArray for chunk meta (${label})`);
};
const addPieceFile = () => {};
const formatArtifactLabel = (filePath) => toPosix(path.relative(outDir, filePath));
const dropUndefinedFields = (value) => JSON.parse(JSON.stringify(value));

await enqueueChunkMetaArtifacts({
  state: { chunks },
  outDir,
  mode: 'code',
  chunkMetaIterator,
  chunkMetaPlan: {
    chunkMetaFormat: 'auto',
    chunkMetaStreaming: false,
    chunkMetaUseJsonl: true,
    chunkMetaUseShards: false,
    chunkMetaUseColumnar: false,
    chunkMetaBinaryColumnar: true,
    chunkMetaEstimatedJsonlBytes: 0,
    chunkMetaShardSize: 100000,
    chunkMetaCount: chunks.length,
    maxJsonBytes: 1024 * 1024
  },
  maxJsonBytes: 1024 * 1024,
  enqueueJsonArray,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
});

for (const job of writes) {
  await job();
}

const expectedHot = [];
const expectedCold = [];
const expectedBinaryRows = [];
for (const entry of chunkMetaIterator(0, chunks.length, false)) {
  const hotEntry = dropUndefinedFields(stripChunkMetaColdFields(entry));
  expectedHot.push(hotEntry);

  const coldEntry = dropUndefinedFields(extractChunkMetaColdFields(entry));
  if (coldEntry) expectedCold.push(coldEntry);
}

const readJsonl = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

const actualHot = await readJsonl(path.join(outDir, 'chunk_meta.jsonl'));
const actualCold = await readJsonl(path.join(outDir, 'chunk_meta_cold.jsonl'));
const compat = JSON.parse(await fs.readFile(path.join(outDir, 'chunk_meta.json'), 'utf8'));

assert.deepEqual(actualHot, expectedHot, 'hot JSONL rows should match canonical projection');
assert.deepEqual(actualCold, expectedCold, 'cold JSONL rows should match canonical projection');
assert.deepEqual(compat, expectedHot, 'compat JSON should match hot projection');

const binaryMetaRaw = JSON.parse(await fs.readFile(path.join(outDir, 'chunk_meta.binary-columnar.meta.json'), 'utf8'));
const binaryMeta = binaryMetaRaw?.fields && typeof binaryMetaRaw.fields === 'object'
  ? binaryMetaRaw.fields
  : binaryMetaRaw;
const binaryArrays = binaryMetaRaw?.arrays && typeof binaryMetaRaw.arrays === 'object'
  ? binaryMetaRaw.arrays
  : {};

const data = await fs.readFile(path.join(outDir, 'chunk_meta.binary-columnar.bin'));
const offsets = decodeU64Offsets(await fs.readFile(path.join(outDir, 'chunk_meta.binary-columnar.offsets.bin')));
const lengths = decodeBinaryRowFrameLengths(await fs.readFile(path.join(outDir, 'chunk_meta.binary-columnar.lengths.varint')));
const actualBinaryRows = [];
for (let i = 0; i < Number(binaryMeta.count || 0); i += 1) {
  const start = offsets[i];
  const end = start + lengths[i];
  actualBinaryRows.push(JSON.parse(data.subarray(start, end).toString('utf8')));
}

const actualFileTable = Array.isArray(binaryMeta.fileTable)
  ? binaryMeta.fileTable
  : (Array.isArray(binaryArrays.fileTable) ? binaryArrays.fileTable : []);
if (actualFileTable.length > 0) {
  assert.deepEqual(actualFileTable, ['src/alpha.js', 'src/beta.js'], 'binary file table should remain stable');
}

const expectedBinary = actualFileTable.length > 0
  ? expectedHot.map((row) => {
    const next = { ...row };
    const fileRef = actualFileTable.indexOf(row.file);
    if (fileRef >= 0) {
      next.fileRef = fileRef;
      delete next.file;
    }
    return next;
  })
  : expectedHot;

assert.deepEqual(actualBinaryRows, expectedBinary, 'binary rows should match canonical transformed payload');

console.log('chunk_meta single-pass fanout parity test passed');
