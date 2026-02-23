#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createChunkMetaIterator,
  enqueueChunkMetaArtifacts
} from '../../../src/index/build/artifacts/writers/chunk-meta.js';
import { toPosix } from '../../../src/shared/files.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'chunk-meta-cached-jsonl-reuse');
const outDir = path.join(tempRoot, 'index');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const chunks = [
  {
    id: 0,
    chunkId: 'cache-0',
    file: 'src/alpha.js',
    start: 0,
    end: 10,
    startLine: 1,
    endLine: 1,
    kind: 'code',
    metaV2: { schemaVersion: 3, chunkUid: 'uid-0' },
    preContext: 'before-0',
    postContext: 'after-0'
  },
  {
    id: 1,
    chunkId: 'cache-1',
    file: 'src/beta.js',
    start: 11,
    end: 22,
    startLine: 2,
    endLine: 3,
    kind: 'code',
    metaV2: { schemaVersion: 3, chunkUid: 'uid-1' },
    preContext: 'before-1',
    postContext: 'after-1'
  },
  {
    id: 2,
    chunkId: 'cache-2',
    file: 'src/gamma.js',
    start: 23,
    end: 38,
    startLine: 4,
    endLine: 6,
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
  maxJsonBytes: null
});

const writes = [];
const enqueueWrite = (_label, job) => writes.push(job);
const enqueueJsonArray = (label) => {
  throw new Error(`Unexpected enqueueJsonArray for chunk meta (${label})`);
};
const addPieceFile = () => {};
const formatArtifactLabel = (filePath) => toPosix(path.relative(outDir, filePath));

const originalStringify = JSON.stringify;
const counts = {
  hotRows: 0,
  coldRows: 0
};

JSON.stringify = function patchedStringify(value, replacer, space) {
  if (value && typeof value === 'object' && Number.isFinite(value.id)) {
    const hasHotShape = Object.prototype.hasOwnProperty.call(value, 'start')
      && Object.prototype.hasOwnProperty.call(value, 'end');
    if (hasHotShape) {
      counts.hotRows += 1;
    } else {
      counts.coldRows += 1;
    }
  }
  return originalStringify.call(JSON, value, replacer, space);
};

try {
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
      chunkMetaBinaryColumnar: false,
      chunkMetaEstimatedJsonlBytes: 0,
      chunkMetaShardSize: 100000,
      chunkMetaCount: chunks.length,
      maxJsonBytes: null
    },
    maxJsonBytes: null,
    enqueueJsonArray,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });

  for (const job of writes) {
    await job();
  }
} finally {
  JSON.stringify = originalStringify;
}

assert.equal(
  counts.hotRows,
  chunks.length,
  'hot chunk_meta rows should be serialized exactly once before JSONL fanout reuse'
);
assert.equal(
  counts.coldRows,
  chunks.length,
  'cold chunk_meta rows should be serialized exactly once before JSONL fanout reuse'
);

console.log('chunk_meta cached JSONL reuse test passed');
