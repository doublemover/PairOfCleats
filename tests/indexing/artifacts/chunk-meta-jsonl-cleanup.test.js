#!/usr/bin/env node

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import {
  createChunkMetaIterator,
  enqueueChunkMetaArtifacts
} from '../../../src/index/build/artifacts/writers/chunk-meta.js';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { loadChunkMeta } from '../../../src/shared/artifact-io.js';

const root = process.cwd();
const cacheRoot = path.join(root, '.testCache', 'chunk-meta-jsonl-cleanup');
const outDir = path.join(cacheRoot, 'index');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });

const chunks = [
  { id: 0, file: 'alpha.js', start: 0, end: 10, startLine: 1, endLine: 1, kind: 'code' },
  { id: 1, file: 'beta.js', start: 0, end: 12, startLine: 1, endLine: 1, kind: 'code' },
  { id: 2, file: 'gamma.js', start: 0, end: 14, startLine: 1, endLine: 1, kind: 'code' }
];

const chunkMetaIterator = createChunkMetaIterator({
  chunks,
  fileIdByPath: new Map(),
  resolvedTokenMode: 'none',
  tokenSampleSize: 0
});

const runWriter = async (chunkMetaPlan) => {
  const writes = [];
  const pieceEntries = [];
  const enqueueWrite = (label, job) => {
    writes.push({ label, job });
  };
  const enqueueJsonArray = (label, _payload, _options) => {
    throw new Error(`Unexpected enqueueJsonArray for chunk meta (${label})`);
  };
  const formatArtifactLabel = (filePath) => path.relative(outDir, filePath).split(path.sep).join('/');
  const addPieceFile = (entry, filePath) => {
    pieceEntries.push({ ...entry, path: formatArtifactLabel(filePath) });
  };

  const state = { chunks };
  await enqueueChunkMetaArtifacts({
    state,
    outDir,
    chunkMetaIterator,
    chunkMetaPlan,
    enqueueJsonArray,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });

  for (const { label, job } of writes) {
    try {
       
      await job();
    } catch (err) {
      throw new Error(`Failed write job (${label}): ${err?.message || err}`);
    }
  }
  await writePiecesManifest({
    pieceEntries,
    outDir,
    mode: 'code',
    indexState: null
  });
};

const metaPath = path.join(outDir, 'chunk_meta.meta.json');
const partsDir = path.join(outDir, 'chunk_meta.parts');
const jsonlPath = path.join(outDir, 'chunk_meta.jsonl');

await runWriter({
  chunkMetaUseJsonl: true,
  chunkMetaUseShards: true,
  chunkMetaShardSize: 1,
  chunkMetaCount: chunks.length
});

if (!fs.existsSync(metaPath) || !fs.existsSync(partsDir)) {
  console.error('Expected sharded chunk_meta artifacts (meta + parts).');
  process.exit(1);
}
if (fs.existsSync(jsonlPath)) {
  console.error('Did not expect chunk_meta.jsonl when writing sharded chunk_meta.');
  process.exit(1);
}
const loadedSharded = await loadChunkMeta(outDir);
if (!Array.isArray(loadedSharded) || loadedSharded.length !== chunks.length) {
  console.error('Expected loadChunkMeta to read sharded chunk_meta parts.');
  process.exit(1);
}

await runWriter({
  chunkMetaUseJsonl: true,
  chunkMetaUseShards: false,
  chunkMetaShardSize: 0,
  chunkMetaCount: chunks.length
});

if (!fs.existsSync(jsonlPath)) {
  console.error('Expected chunk_meta.jsonl when writing unsharded JSONL chunk_meta.');
  process.exit(1);
}
if (fs.existsSync(metaPath) || fs.existsSync(partsDir)) {
  console.error('Expected stale sharded chunk_meta artifacts to be removed when writing unsharded JSONL.');
  process.exit(1);
}
const loadedJsonl = await loadChunkMeta(outDir);
if (!Array.isArray(loadedJsonl) || loadedJsonl.length !== chunks.length) {
  console.error('Expected loadChunkMeta to read chunk_meta.jsonl.');
  process.exit(1);
}

console.log('chunk_meta JSONL cleanup test passed');

