#!/usr/bin/env node
import { normalizePostingsConfig } from '../../../src/shared/postings-config.js';
import { createIndexerWorkerPool, normalizeWorkerPoolConfig } from '../../../src/index/build/worker-pool.js';

const postingsConfig = normalizePostingsConfig({
  enablePhraseNgrams: true,
  phraseMinN: 2,
  phraseMaxN: 3,
  enableChargrams: true,
  chargramMinN: 3,
  chargramMaxN: 3
});
const dictWords = new Set(['hello']);
const dictConfig = { segmentation: 'greedy' };
const workerConfig = normalizeWorkerPoolConfig({
  enabled: true,
  maxWorkers: 1,
  maxFileBytes: 4096,
  taskTimeoutMs: 5000
}, { cpuLimit: 1 });

const workerPool = await createIndexerWorkerPool({
  config: workerConfig,
  dictWords,
  dictConfig,
  postingsConfig
});
if (!workerPool) {
  console.log('worker pool restart test skipped (worker pool unavailable).');
  process.exit(0);
}

const pool = workerPool.pool;
if (!pool) {
  console.error('worker pool restart test failed: no pool available.');
  process.exit(1);
}

let destroyed = false;
const originalDestroy = typeof pool.destroy === 'function' ? pool.destroy.bind(pool) : null;
pool.destroy = async (...args) => {
  destroyed = true;
  if (originalDestroy) {
    return originalDestroy(...args);
  }
  return undefined;
};
pool.run = async () => {
  throw new Error('synthetic worker failure');
};

await workerPool.tokenizeChunk({ text: 'hello', mode: 'code', ext: '.js' });

const waitFor = async (predicate, label) => {
  const started = Date.now();
  while (Date.now() - started < 1500) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`worker pool restart test failed: ${label}`);
};

try {
  await waitFor(() => destroyed && !workerPool.pool, 'pool was not destroyed after failure');
  console.log('worker pool restart test passed');
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
} finally {
  await workerPool.destroy();
}
