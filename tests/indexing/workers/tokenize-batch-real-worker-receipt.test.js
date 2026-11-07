import assert from 'node:assert/strict';
import { createOrderedTokenizeBatchWindow, TOKENIZE_BATCH_RESULT_VERSION } from '../../../src/index/build/workers/tokenize-batch.js';
import { createWorkerPoolTestResources, WORKER_POOL_SAMPLE } from './worker-pool-fixture.js';

const { workerPool, syncTokens } = await createWorkerPoolTestResources();
assert.ok(workerPool, 'qualification requires the real worker backend');
const rows = Array.from({ length: 3 }, () => ({ text: WORKER_POOL_SAMPLE, mode: 'code', ext: '.js', languageId: 'javascript' }));
const metrics = {};
let batches = 0;
try {
  const window = createOrderedTokenizeBatchWindow({ count: rows.length, getInput: index => rows[index], metrics,
    runSingle: payload => workerPool.tokenizeChunk(payload), runBatch: async payload => {
      batches++;
      const result = await workerPool.tokenizeBatch(payload);
      assert.equal(result.version, TOKENIZE_BATCH_RESULT_VERSION);
      assert.match(result.inputIdentity, /^[a-f0-9]{64}$/u);
      assert.equal(result.results.reduce((bytes, row) => bytes + row.byteLength, 0), result.outputBytes,
        'the receipt accounts for the actual bytes transported by the real worker');
      return result;
    } });
  for (let index = 0; index < rows.length; index++) {
    const value = await window.take(index, rows[index]);
    for (const key of ['tokens', 'seq', 'ngrams', 'chargrams', 'minhashSig']) {
      assert.deepEqual(value[key], syncTokens[key], `actual worker ${key} projection`);
    }
  }
  assert.equal(batches, 1);
  assert.equal(metrics.retainedChunks, 0);
  assert.equal(workerPool.stats().backend, 'worker');
  assert.ok(workerPool.pool.completed > 0, 'a real worker executed the versioned batch');
} finally { await workerPool.destroy(); }
console.log('the real worker emits source-bound batch receipts consumed by the bounded ordered window');
