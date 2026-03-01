#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createChunkMetaIterator, enqueueChunkMetaArtifacts } from '../../../../src/index/build/artifacts/writers/chunk-meta.js';
import { writePiecesManifest } from '../../../../src/index/build/artifacts/checksums.js';
import { toPosix } from '../../../../src/shared/files.js';
import { loadPiecesManifestPieces } from '../../../helpers/pieces-manifest.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'sharded-meta-manifest');
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

const outDir = path.join(cacheRoot, 'index');
await fs.mkdir(outDir, { recursive: true });

const chunks = [
  { id: 0, file: 'alpha.js', start: 0, end: 1, startLine: 1, endLine: 1, kind: 'code' },
  { id: 1, file: 'beta.js', start: 0, end: 2, startLine: 1, endLine: 1, kind: 'code' }
];

const chunkMetaIterator = createChunkMetaIterator({
  chunks,
  fileIdByPath: new Map(),
  resolvedTokenMode: 'none',
  tokenSampleSize: 0
});

const writes = [];
const pieceEntries = [];
const enqueueWrite = (label, job) => writes.push({ label, job });
const enqueueJsonArray = () => {
  throw new Error('Unexpected enqueueJsonArray for sharded chunk_meta');
};
const formatArtifactLabel = (filePath) => toPosix(path.relative(outDir, filePath));
const addPieceFile = (entry, filePath) => {
  pieceEntries.push({ ...entry, path: formatArtifactLabel(filePath) });
};

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

await writePiecesManifest({
  pieceEntries,
  outDir,
  mode: 'code',
  indexState: null
});

const metaPath = path.join(outDir, 'chunk_meta.meta.json');
const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
const pieces = loadPiecesManifestPieces(outDir);

const hasMeta = pieces.some((piece) => piece?.name === 'chunk_meta_meta' && piece?.path === 'chunk_meta.meta.json');
assert.ok(hasMeta, 'expected chunk_meta.meta.json to be listed in pieces manifest');

for (const part of meta.parts || []) {
  const relPath = part?.path;
  assert.ok(relPath, 'expected meta parts to include path');
  const hasPart = pieces.some((piece) => piece?.name === 'chunk_meta' && piece?.path === relPath);
  assert.ok(hasPart, `expected manifest to include chunk_meta part ${relPath}`);
}

console.log('sharded meta manifest consistency test passed');

