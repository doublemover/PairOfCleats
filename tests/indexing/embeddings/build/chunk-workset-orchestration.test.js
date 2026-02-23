#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../../helpers/test-env.js';
import {
  loadModeChunkWorkset,
  sortChunkListsByIndexWhenNeeded
} from '../../../../tools/build/embeddings/runner/chunk-workset.js';

applyTestEnv();

{
  const ordered = [
    { index: 1, chunk: { id: 'ordered-1' } },
    { index: 2, chunk: { id: 'ordered-2' } }
  ];
  ordered.sort = () => {
    throw new Error('ordered list should not be sorted when indexes are already monotonic');
  };
  const unordered = [
    { index: 4, chunk: { id: 'unordered-4' } },
    { index: 2, chunk: { id: 'unordered-2' } },
    { index: 3, chunk: { id: 'unordered-3' } }
  ];
  const chunksByFile = new Map([
    ['ordered.js', ordered],
    ['unordered.js', unordered]
  ]);
  const sortedCount = sortChunkListsByIndexWhenNeeded(chunksByFile);
  assert.equal(sortedCount, 1, 'expected only unordered file list to be sorted');
  assert.deepEqual(
    unordered.map((entry) => entry.index),
    [2, 3, 4],
    'expected unordered list to be re-ordered by chunk index'
  );
}

{
  const logs = [];
  const warns = [];
  let sampleSelectorCalls = 0;
  let evictedOne = false;
  const workset = await loadModeChunkWorkset({
    mode: 'code',
    indexDir: '/fake/index',
    incremental: { manifest: { files: {} } },
    chunkMetaMaxBytes: 1024,
    embeddingSampling: { maxFiles: 1, seed: 'seed-stream' },
    scheduleIo: async (worker) => worker(),
    log: (line) => logs.push(line),
    warn: (line) => warns.push(line),
    isChunkMetaTooLargeError: () => false,
    isMissingArtifactError: () => false,
    loadChunkMetaRowsImpl: async function *() {
      yield { file: 'alpha.js', start: 0, end: 10 };
      yield { file: 'beta.js', start: 0, end: 6 };
      yield { file: 'beta.js', start: 6, end: 12 };
    },
    loadFileMetaRowsImpl: async function *() {},
    toPosixImpl: (value) => value,
    compactChunkForEmbeddingsImpl: (chunk, filePath) => ({
      file: filePath,
      start: Number(chunk.start) || 0,
      end: Number(chunk.end) || 0
    }),
    createDeterministicFileStreamSamplerImpl: () => {
      const seen = new Set();
      return {
        considerFile: (file) => {
          seen.add(file);
          if (file === 'alpha.js') {
            return { selected: true, evicted: null };
          }
          if (file === 'beta.js' && !evictedOne) {
            evictedOne = true;
            return { selected: true, evicted: 'alpha.js' };
          }
          return { selected: true, evicted: null };
        },
        getSeenCount: () => seen.size,
        getSelectedCount: () => 1
      };
    },
    selectDeterministicFileSampleImpl: () => {
      sampleSelectorCalls += 1;
      return [];
    },
    buildChunksFromBundlesImpl: async () => {
      throw new Error('bundle fallback should not run when chunk_meta succeeds');
    }
  });
  assert.equal(workset.skipped, false);
  assert.equal(workset.totalChunks, 3, 'expected total chunk count to reflect scanned rows');
  assert.equal(workset.totalFileCount, 2, 'expected stream summary seen file count to be preserved');
  assert.equal(workset.sampledFileEntries.length, 1, 'expected one sampled file after eviction');
  assert.equal(workset.sampledChunkCount, 2, 'expected sampled chunks to track surviving file chunks');
  assert.strictEqual(
    workset.sampledChunksByFile,
    workset.chunksByFile,
    'expected sampled map to be reused when stream sampling already materialized the subset'
  );
  assert.equal(sampleSelectorCalls, 0, 'expected deterministic post-sampler selection to be skipped');
  assert.equal(warns.length, 0, 'expected no warnings for healthy stream path');
  assert.ok(
    logs.some((line) => line.includes('sampling 1/2 files (2/3 chunks, seed=seed-stream)')),
    'expected stream sampling summary log'
  );
}

{
  const logs = [];
  const warns = [];
  let fallbackCalls = 0;
  let sampleSelectorCalls = 0;
  const missingChunkMetaErr = new Error('missing chunk_meta');
  missingChunkMetaErr.code = 'ERR_MANIFEST_ENTRY_MISSING';
  const workset = await loadModeChunkWorkset({
    mode: 'code',
    indexDir: '/fake/index',
    incremental: {
      bundleDir: '/fake/bundles',
      manifest: {
        files: {
          'a.js': { bundle: 'a.bundle' },
          'b.js': { bundle: 'b.bundle' }
        }
      }
    },
    chunkMetaMaxBytes: 1024,
    embeddingSampling: { maxFiles: 1, seed: 'seed-fallback' },
    scheduleIo: async (worker) => worker(),
    log: (line) => logs.push(line),
    warn: (line) => warns.push(line),
    isChunkMetaTooLargeError: () => false,
    isMissingArtifactError: (err, baseName) => baseName === 'chunk_meta' && err === missingChunkMetaErr,
    loadChunkMetaRowsImpl: async function *() {
      throw missingChunkMetaErr;
    },
    loadFileMetaRowsImpl: async function *() {},
    createDeterministicFileStreamSamplerImpl: () => ({
      considerFile: () => ({ selected: true, evicted: null }),
      getSeenCount: () => 0,
      getSelectedCount: () => 0
    }),
    selectDeterministicFileSampleImpl: ({ fileEntries }) => {
      sampleSelectorCalls += 1;
      return [fileEntries[0]];
    },
    buildChunksFromBundlesImpl: async () => {
      fallbackCalls += 1;
      return {
        chunksByFile: new Map([
          ['b.js', [{ index: 3, chunk: { id: 3 } }]],
          ['a.js', [{ index: 2, chunk: { id: 2 } }, { index: 1, chunk: { id: 1 } }]]
        ]),
        totalChunks: 4
      };
    }
  });
  assert.equal(workset.skipped, false);
  assert.equal(fallbackCalls, 1, 'expected incremental bundle fallback to run once');
  assert.equal(sampleSelectorCalls, 1, 'expected deterministic sampler selection on fallback path');
  assert.deepEqual(
    workset.chunksByFile.get('a.js').map((entry) => entry.index),
    [1, 2],
    'expected deterministic ordering fix-up for fallback chunk lists'
  );
  assert.equal(workset.sampledFileEntries.length, 1);
  assert.equal(workset.sampledChunkCount, 2);
  assert.notStrictEqual(
    workset.sampledChunksByFile,
    workset.chunksByFile,
    'expected a new sampled map allocation when deterministic fallback sampling changes the file set'
  );
  assert.equal(warns.length, 0, 'expected suppressed missing-artifact warning for chunk_meta fallback');
  assert.ok(
    logs.some((line) => line.includes('using incremental bundles')),
    'expected fallback source log line'
  );
}

console.log('chunk workset orchestration helper test passed');
