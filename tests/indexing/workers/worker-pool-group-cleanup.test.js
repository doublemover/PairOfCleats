import assert from 'node:assert/strict';
import { createIndexerWorkerPools, normalizeWorkerPoolConfig } from '../../../src/index/build/worker-pool.js';

const pools = await createIndexerWorkerPools({ config: normalizeWorkerPoolConfig({
  enabled: true, maxWorkers: 2, splitByTask: true, taskTimeoutMs: 5000
}, { cpuLimit: 2 }), dictWords: new Set(), dictConfig: {}, postingsConfig: {} });
assert.ok(pools.tokenizePool && pools.quantizePool, 'real split pools must initialize');
assert.notEqual(pools.tokenizePool, pools.quantizePool);
const closeTokenize = pools.tokenizePool.destroy.bind(pools.tokenizePool);
const closeQuantize = pools.quantizePool.destroy.bind(pools.quantizePool);
let tokenizeCalls = 0;
let quantizeCalls = 0;
const failure = new Error('quantize cleanup test failure');
pools.tokenizePool.destroy = async () => { tokenizeCalls += 1; await closeTokenize(); };
pools.quantizePool.destroy = async () => { quantizeCalls += 1; await closeQuantize(); throw failure; };
try {
  const first = pools.destroy();
  const second = pools.destroy();
  assert.equal(first, second, 'concurrent callers await the same complete cleanup');
  await assert.rejects(first, error => error === failure);
  assert.equal(tokenizeCalls, 1, 'a failing sibling must not bypass this pool cleanup');
  assert.equal(quantizeCalls, 1);
  await assert.rejects(pools.destroy(), error => error === failure);
  assert.equal(tokenizeCalls, 1, 'repeated destroy is idempotent');
} finally {
  await Promise.all([closeTokenize(), closeQuantize()]);
}
console.log('split worker pool cleanup attempts every unique owner once and propagates failures');
