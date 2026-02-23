#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { applyTestEnv } from '../../../helpers/test-env.js';
import {
  createFileEntryProcessor,
  readFileTextWithFallback,
  resolveFileReadCandidates
} from '../../../../tools/build/embeddings/runner/file-entry-orchestration.js';

applyTestEnv();

const repoRoot = path.join(process.cwd(), 'tmp', 'embeddings-file-entry-repo');
const recordsRoot = path.join(process.cwd(), 'tmp', 'embeddings-file-entry-records');
const chunkItems = [{ index: 0, chunk: { start: 0, end: 5 } }];

const lookupCalls = [];
const markCalls = [];
const readCalls = [];
let prepareCalls = 0;
let computeCalls = 0;
const warnLines = [];
const cacheCounters = {
  attempts: 0,
  hits: 0,
  misses: 0,
  rejected: 0,
  fastRejects: 0
};

const processFileEntry = createFileEntryProcessor({
  mode: 'code',
  root: repoRoot,
  recordsDir: null,
  manifestFiles: {},
  cacheState: { cacheEligible: true, cacheIndex: {} },
  cacheRepoId: 'repo-id',
  cacheIdentityKey: 'identity-key',
  cacheKeyFlags: ['stub'],
  configuredDims: 3,
  cacheCounters,
  scheduleIo: async (worker) => worker(),
  assertDims: () => {},
  codeVectors: [],
  docVectors: [],
  mergedVectors: [],
  addHnswFromQuantized: null,
  markFileProcessed: async (input) => {
    markCalls.push(input);
  },
  computeFileEmbeddings: async () => {
    computeCalls += 1;
  },
  prepareFileEmbeddingWorkset: async () => {
    prepareCalls += 1;
    return {
      codeTexts: [],
      docTexts: [],
      codeMapping: [],
      docMapping: [],
      chunkHashes: [],
      chunkHashesFingerprint: null,
      reuse: null
    };
  },
  warn: (line) => {
    warnLines.push(line);
  },
  buildChunkSignatureImpl: (items) => `sig:${items.length}`,
  buildCacheKeyImpl: ({ file, hash, signature }) => `${file}|${hash ?? 'none'}|${signature}`,
  lookupCacheEntryWithStatsImpl: async (input) => {
    lookupCalls.push({ cacheKey: input.cacheKey, fileHash: input.fileHash });
    if (input.fileHash === 'hash-from-read') {
      return { cacheHit: true };
    }
    return null;
  },
  tryApplyCachedVectorsImpl: ({ cached }) => Boolean(cached?.cacheHit),
  readTextFileWithHashImpl: async (filePath) => {
    readCalls.push(filePath);
    return { text: 'alpha', hash: 'hash-from-read' };
  }
});

await processFileEntry(['src/alpha.js', chunkItems]);

assert.equal(lookupCalls.length, 2, 'expected cache lookup before and after content-hash read');
assert.equal(lookupCalls[0].fileHash, null, 'expected first lookup to use manifest hash (missing)');
assert.equal(lookupCalls[1].fileHash, 'hash-from-read', 'expected second lookup to use computed content hash');
assert.deepEqual(
  markCalls,
  [{ chunkCount: 1, source: 'cache' }],
  'expected second cache hit to short-circuit compute'
);
assert.equal(prepareCalls, 0, 'expected no workset prep when cache serves the file');
assert.equal(computeCalls, 0, 'expected compute to be skipped when cache serves the file');
assert.deepEqual(
  readCalls,
  [path.resolve(repoRoot, 'src', 'alpha.js')],
  'expected non-record mode to read from repo-root relative path'
);
assert.equal(warnLines.length, 0, 'expected no read warnings for successful fallback path');

const triageCandidates = resolveFileReadCandidates({
  mode: 'records',
  root: repoRoot,
  recordsDir: recordsRoot,
  normalizedRel: 'triage/records/session/entry.json'
});
assert.deepEqual(
  triageCandidates,
  [
    path.resolve(recordsRoot, 'session', 'entry.json'),
    path.resolve(repoRoot, 'triage', 'records', 'session', 'entry.json')
  ],
  'expected triage records to prefer recordsDir path first'
);

const plainRecordCandidates = resolveFileReadCandidates({
  mode: 'records',
  root: repoRoot,
  recordsDir: recordsRoot,
  normalizedRel: 'events/entry.json'
});
assert.deepEqual(
  plainRecordCandidates,
  [
    path.resolve(repoRoot, 'events', 'entry.json'),
    path.resolve(recordsRoot, 'events', 'entry.json')
  ],
  'expected non-triage records to prefer repo-root path first'
);

const fallbackAttempts = [];
const fallbackResult = await readFileTextWithFallback({
  mode: 'records',
  candidates: ['primary', 'secondary'],
  scheduleIo: async (worker) => worker(),
  readTextFileWithHashImpl: async (filePath) => {
    fallbackAttempts.push(filePath);
    if (filePath === 'primary') {
      const err = new Error('missing primary');
      err.code = 'ENOENT';
      throw err;
    }
    return { text: 'ok', hash: 'h2' };
  }
});
assert.equal(fallbackResult.text, 'ok');
assert.deepEqual(
  fallbackAttempts,
  ['primary', 'secondary'],
  'expected records ENOENT fallback to continue to second candidate'
);

await assert.rejects(
  async () => readFileTextWithFallback({
    mode: 'code',
    candidates: ['primary', 'secondary'],
    scheduleIo: async (worker) => worker(),
    readTextFileWithHashImpl: async () => {
      const err = new Error('missing');
      err.code = 'ENOENT';
      throw err;
    }
  }),
  /missing/i,
  'expected non-record mode to stop at first ENOENT'
);

console.log('file entry orchestration helper test passed');
