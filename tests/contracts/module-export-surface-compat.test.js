#!/usr/bin/env node
import assert from 'node:assert/strict';

const runnerModule = await import('../../tools/build/embeddings/runner.js');
const processFilesModule = await import('../../src/index/build/indexer/steps/process-files.js');
const pipelineModule = await import('../../src/index/build/indexer/pipeline.js');
const cacheModule = await import('../../tools/build/embeddings/cache.js');

const assertFunctionExports = (moduleName, moduleRef, symbols) => {
  for (const symbol of symbols) {
    assert.equal(
      typeof moduleRef?.[symbol],
      'function',
      `expected ${moduleName} to export function ${symbol}`
    );
  }
};

assertFunctionExports('tools/build/embeddings/runner.js', runnerModule, [
  'resolveEmbeddingsFileParallelism',
  'buildChunkTextLookupKey',
  'buildChunkTextLookupMap',
  'hydrateMissingChunkTextsFromBundle',
  'parseChunkMetaTooLargeBytes',
  'resolveChunkMetaRetryMaxBytes',
  'resolveEmbeddingsChunkMetaRetryCeilingBytes',
  '__runWithAdaptiveConcurrencyForTests'
]);

assertFunctionExports('src/index/build/indexer/steps/process-files.js', processFilesModule, [
  'resolveEffectiveSlowFileDurationMs',
  'resolveExtractedProseExtrasCache',
  'resolveSharedScmMetaCache',
  'clampShardConcurrencyToRuntime',
  'sortShardBatchesByDeterministicMergeOrder'
]);

assertFunctionExports('src/index/build/indexer/pipeline.js', pipelineModule, [
  'resolveFileTextCacheForMode',
  'sanitizeRuntimeSnapshotForCheckpoint'
]);

assertFunctionExports('tools/build/embeddings/cache.js', cacheModule, [
  'resolveCacheIndexBinaryPath'
]);

console.log('module export surface compatibility test passed');
