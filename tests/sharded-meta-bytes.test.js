#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createChunkMetaIterator, enqueueChunkMetaArtifacts } from '../src/index/build/artifacts/writers/chunk-meta.js';

const root = process.cwd();
const cacheRoot = path.join(root, 'tests', '.cache', 'sharded-meta-bytes');
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

const outDir = path.join(cacheRoot, 'index');
await fs.mkdir(outDir, { recursive: true });

const chunks = [
  { id: 0, file: 'alpha.js', start: 0, end: 1, startLine: 1, endLine: 1, kind: 'code' },
  { id: 1, file: 'beta.js', start: 0, end: 2, startLine: 1, endLine: 1, kind: 'code' },
  { id: 2, file: 'gamma.js', start: 0, end: 3, startLine: 1, endLine: 1, kind: 'code' }
];

const chunkMetaIterator = createChunkMetaIterator({
  chunks,
  fileIdByPath: new Map(),
  resolvedTokenMode: 'none',
  tokenSampleSize: 0
});

const writes = [];
const enqueueWrite = (label, job) => writes.push({ label, job });
const enqueueJsonArray = () => {
  throw new Error('Unexpected enqueueJsonArray for sharded chunk_meta');
};
const addPieceFile = () => {};
const formatArtifactLabel = (value) => value;

await enqueueChunkMetaArtifacts({
  state: { chunks },
  outDir,
  chunkMetaIterator,
  chunkMetaPlan: {
    chunkMetaUseJsonl: true,
    chunkMetaUseShards: true,
    chunkMetaShardSize: 1,
    chunkMetaCount: chunks.length
  },
  enqueueJsonArray,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
});
for (const { job } of writes) {
  await job();
}

const metaPath = path.join(outDir, 'chunk_meta.meta.json');
const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
const parts = Array.isArray(meta?.parts) ? meta.parts : [];
let totalBytes = 0;
for (const part of parts) {
  const relPath = part?.path;
  assert.ok(relPath, 'expected meta parts to include path');
  const absPath = path.join(outDir, relPath.split('/').join(path.sep));
  const stat = await fs.stat(absPath);
  assert.equal(part.bytes, stat.size, `expected bytes to match stat for ${relPath}`);
  totalBytes += stat.size;
}
assert.equal(meta.totalBytes, totalBytes, 'expected totalBytes to match sum of part sizes');

console.log('sharded meta bytes test passed');
