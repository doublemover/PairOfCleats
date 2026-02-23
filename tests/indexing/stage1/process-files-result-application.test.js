#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  createStage1FileResultApplier,
  resolveResultLifecycleRecord
} from '../../../src/index/build/indexer/steps/process-files/result-application.js';

ensureTestingEnv(process.env);

/**
 * Reproduce stage1 lifecycle-map behavior used by process-files orchestration.
 *
 * @param {{
 *  orderIndex:number,
 *  file?:string|null,
 *  fileIndex?:number|null,
 *  shardId?:string|null
 * }} input
 * @returns {object}
 */
const buildEnsureLifecycleRecord = (lifecycleByOrderIndex) => ({
  orderIndex,
  file = null,
  fileIndex = null,
  shardId = null
} = {}) => {
  const normalizedOrderIndex = Math.floor(orderIndex);
  const existing = lifecycleByOrderIndex.get(normalizedOrderIndex);
  if (existing) {
    if (file && !existing.file) existing.file = file;
    if (Number.isFinite(fileIndex) && !Number.isFinite(existing.fileIndex)) {
      existing.fileIndex = Math.floor(fileIndex);
    }
    if (shardId && !existing.shardId) existing.shardId = shardId;
    return existing;
  }
  const created = {
    orderIndex: normalizedOrderIndex,
    file: file || null,
    fileIndex: Number.isFinite(fileIndex) ? Math.floor(fileIndex) : null,
    shardId: shardId || null,
    enqueuedAtMs: null,
    dequeuedAtMs: null,
    parseStartAtMs: null,
    parseEndAtMs: null,
    writeStartAtMs: null,
    writeEndAtMs: null
  };
  lifecycleByOrderIndex.set(normalizedOrderIndex, created);
  return created;
};

const lifecycleByOrderIndex = new Map();
const lifecycleByRelKey = new Map([
  ['src/alpha.js', 7]
]);
const ensureLifecycleRecord = buildEnsureLifecycleRecord(lifecycleByOrderIndex);

const lifecycleFromRelKey = resolveResultLifecycleRecord({
  result: {
    abs: 'C:/repo/src/alpha.js',
    relKey: 'src/alpha.js',
    orderIndex: 2,
    fileIndex: 3
  },
  lifecycleByRelKey,
  ensureLifecycleRecord
});
assert.equal(lifecycleFromRelKey?.orderIndex, 7, 'expected rel-key mapping to win over result.orderIndex');

const lifecycleFromResultOrder = resolveResultLifecycleRecord({
  result: {
    abs: 'C:/repo/src/beta.js',
    relKey: 'src/beta.js',
    orderIndex: 12,
    fileIndex: 4
  },
  lifecycleByRelKey: new Map(),
  ensureLifecycleRecord
});
assert.equal(lifecycleFromResultOrder?.orderIndex, 12, 'expected result.orderIndex fallback when rel-key map is absent');

const appendedChunks = [];
const sharedState = { marker: 'shared-state' };
const incrementalState = {
  manifest: {
    files: {}
  }
};
const applyFileResult = createStage1FileResultApplier({
  appendChunkWithRetention: (stateRef, chunk, sharedStateRef) => {
    appendedChunks.push({ stateRef, chunk, sharedStateRef });
  },
  ensureLifecycleRecord,
  incrementalState,
  lifecycleByOrderIndex,
  lifecycleByRelKey,
  log: () => {},
  perfProfile: {},
  runtime: {
    buildRoot: process.cwd(),
    root: process.cwd()
  },
  sharedState
});

const stageState = {
  scannedFilesTimes: [],
  scannedFiles: [],
  fileRelations: new Map()
};
const alphaResult = {
  abs: 'C:/repo/src/alpha.js',
  relKey: 'src/alpha.js',
  fileIndex: 3,
  durationMs: 42.6,
  cached: false,
  chunks: [
    {
      ext: 'js',
      chunkUid: 'chunk-alpha-1',
      fileSize: 123,
      fileHash: 'hash-a',
      fileHashAlgo: 'sha1'
    }
  ],
  manifestEntry: {
    id: 'manifest-alpha'
  },
  fileInfo: {
    size: 123,
    hash: 'hash-a2',
    hashAlgo: 'sha256'
  },
  fileRelations: {
    imports: []
  },
  lexiconFilterStats: {
    kept: 8,
    dropped: 2
  }
};
await applyFileResult(alphaResult, stageState, { id: 'shard-2' });

assert.equal(appendedChunks.length, 1, 'expected chunks to be appended through retention callback');
assert.strictEqual(appendedChunks[0].sharedStateRef, sharedState, 'expected shared stage state to be forwarded');
assert.equal(alphaResult.manifestEntry.shard, 'shard-2', 'expected shard id to be stamped on manifest rows');
assert.strictEqual(
  incrementalState.manifest.files['src/alpha.js'],
  alphaResult.manifestEntry,
  'expected manifest state to receive result entry'
);
assert.equal(stageState.scannedFiles.length, 1, 'expected scanned files to record result abs path');
assert.equal(stageState.scannedFiles[0], alphaResult.abs, 'expected scanned file path to match result');
assert.equal(stageState.fileInfoByPath.get('src/alpha.js')?.size, 123, 'expected file-info map update');
assert.equal(stageState.fileDetailsByPath.get('src/alpha.js')?.hash, 'hash-a2', 'expected file-details map update');
assert.equal(stageState.chunkUidToFile.get('chunk-alpha-1'), 'src/alpha.js', 'expected chunk uid map update');
assert.equal(stageState.fileRelations.get('src/alpha.js')?.imports.length, 0, 'expected file relations merge');
assert.equal(
  stageState.lexiconRelationFilterByFile.get('src/alpha.js')?.file,
  'src/alpha.js',
  'expected lexicon stats to include file key'
);
assert.equal(stageState.scannedFilesTimes.length, 1, 'expected one scanned-file timing record');
assert.equal(lifecycleByRelKey.has('src/alpha.js'), false, 'expected rel-key lifecycle mapping cleanup');
assert.equal(lifecycleByOrderIndex.has(7), false, 'expected order-index lifecycle mapping cleanup');
assert.equal(
  typeof stageState.scannedFilesTimes[0]?.lifecycle?.writeStartAt,
  'string',
  'expected lifecycle write start timestamp in scanned-file timing payload'
);

console.log('process-files result-application helper test passed');
