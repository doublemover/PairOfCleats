#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizePostingsConfig } from '../src/shared/postings-config.js';
import { createTokenizationContext, tokenizeChunkText } from '../src/index/build/tokenization.js';
import { createIndexerWorkerPool, normalizeWorkerPoolConfig } from '../src/index/build/worker-pool.js';

if (process.platform !== 'win32') {
  console.log('worker pool windows test skipped (non-windows).');
  process.exit(0);
}

const root = path.resolve('tests', '.cache', 'worker-pool-windows');
const deepDir = path.join(root, 'space dir', 'unicode-é', 'deep', 'path', 'more');
await fs.mkdir(deepDir, { recursive: true });

const originalCwd = process.cwd();
try {
  process.chdir(deepDir);
  const postingsConfig = normalizePostingsConfig({
    enablePhraseNgrams: true,
    phraseMinN: 2,
    phraseMaxN: 3,
    enableChargrams: true,
    chargramMinN: 3,
    chargramMaxN: 3
  });
  const dictWords = new Set(['hello', 'world', 'foo', 'bar']);
  const dictConfig = { segmentation: 'greedy' };
  const workerConfig = normalizeWorkerPoolConfig({
    enabled: true,
    maxWorkers: 1,
    maxFileBytes: 4096,
    quantizeBatchSize: 2,
    taskTimeoutMs: 5000
  }, { cpuLimit: 1 });

  const workerPool = await createIndexerWorkerPool({
    config: workerConfig,
    dictWords,
    dictConfig,
    postingsConfig
  });
  if (!workerPool) {
    console.log('worker pool windows test skipped (worker pool unavailable).');
    process.exit(0);
  }

  const context = createTokenizationContext({ dictWords, dictConfig, postingsConfig });
  const sample = 'helloWorld fooBar';
  const syncTokens = tokenizeChunkText({ text: sample, mode: 'code', ext: '.js', context });

  const runs = [];
  for (let i = 0; i < 50; i += 1) {
    runs.push(workerPool.runTokenize({
      text: sample,
      mode: 'code',
      ext: '.js',
      file: `task-${i}`,
      size: sample.length
    }));
  }
  const results = await Promise.all(runs);
  for (const result of results) {
    if (!result) {
      console.error('worker pool windows test failed: missing token result.');
      process.exit(1);
    }
    if (JSON.stringify(syncTokens.tokens) !== JSON.stringify(result.tokens)) {
      console.error('worker pool windows test failed: tokens mismatch.');
      process.exit(1);
    }
  }

  if (workerPool.pool?.destroy) {
    await workerPool.pool.destroy();
    await workerPool.runTokenize({
      text: sample,
      mode: 'code',
      ext: '.js',
      file: 'restart',
      size: sample.length
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const restarted = await workerPool.runTokenize({
      text: sample,
      mode: 'code',
      ext: '.js',
      file: 'restart-2',
      size: sample.length
    });
    if (!restarted) {
      console.error('worker pool windows test failed: restart did not recover.');
      process.exit(1);
    }
  }

  await workerPool.destroy();
  console.log('worker pool windows test passed');
} finally {
  process.chdir(originalCwd);
}
