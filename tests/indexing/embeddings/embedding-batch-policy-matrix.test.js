#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { resolveAutoEmbeddingBatchSize } from '../../../src/shared/embedding-batch.js';
import {
  normalizeEmbeddingBatchMultipliers,
  resolveEmbeddingBatchSize
} from '../../../src/index/build/embedding-batch.js';
import { parseBuildArgs } from '../../../src/index/build/args.js';
import { createBuildRuntime } from '../../../src/index/build/runtime.js';
import { runBatched } from '../../../tools/build/embeddings/embed.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { rmDirRecursive } from '../../helpers/temp.js';

const oneGb = 1024 ** 3;

assert.equal(resolveAutoEmbeddingBatchSize(oneGb), 16);
assert.equal(resolveAutoEmbeddingBatchSize(2 * oneGb), 32);
assert.equal(resolveAutoEmbeddingBatchSize(16 * oneGb), 128);

{
  const multipliers = normalizeEmbeddingBatchMultipliers(
    { typescript: 4, python: 2 },
    { typescript: 3, rust: 1.5 }
  );
  assert.equal(resolveEmbeddingBatchSize(10, 'typescript', multipliers), 40);
  assert.equal(resolveEmbeddingBatchSize(10, 'python', multipliers), 20);
  assert.equal(resolveEmbeddingBatchSize(10, 'rust', multipliers), 15);
  assert.equal(resolveEmbeddingBatchSize(10, 'go', multipliers), 10);
}

{
  const texts = ['aaaa', 'bb', 'ccccc', 'd', 'eeee'];
  const calls = [];
  const batches = [];

  const vectors = await runBatched({
    texts,
    batchSize: 4,
    maxBatchTokens: 6,
    estimateTokens: (text) => text.length,
    embed: async (batch) => {
      calls.push(batch);
      return batch.map((value) => [value.length]);
    },
    onBatch: (entry) => {
      batches.push(entry);
    }
  });

  assert.equal(vectors.length, texts.length);
  assert.deepEqual(calls, [['aaaa', 'bb'], ['ccccc', 'd'], ['eeee']]);
  assert.equal(batches.length, 3);
  assert.equal(batches[0].batchTokens, 6);
  assert.equal(batches[1].batchTokens, 6);
  assert.equal(batches[2].batchTokens, 4);
  assert.equal(batches[0].batchTokenBudget, 6);
  assert.equal(batches[2].underfilledTokens, 2);
  assert.equal(batches[2].batchFillRatio, 4 / 6);
}

{
  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, 'embedding-batch-policy-matrix');
  const repoRoot = path.join(tempRoot, 'repo');

  await rmDirRecursive(tempRoot, { retries: 8, delayMs: 150 });
  await fsPromises.mkdir(repoRoot, { recursive: true });
  applyTestEnv({
    cacheRoot: tempRoot,
    embeddings: 'stub',
    testConfig: {
      quality: 'max',
      indexing: {
        embeddings: {
          enabled: true,
          mode: 'stub'
        }
      }
    }
  });

  const defaults = parseBuildArgs([]).argv;
  const argv = { ...defaults, 'stub-embeddings': true };
  const runtime = await createBuildRuntime({ root: repoRoot, argv, rawArgv: [] });
  assert.ok(runtime.embeddingBatchSize >= 8 && runtime.embeddingBatchSize <= 256);
  assert.ok(runtime.embeddingConcurrency >= 1);
}

console.log('embedding batch policy matrix test passed');
