import assert from 'node:assert/strict';
import { createIndexerWorkerPools } from '../../../src/index/build/workers/pool.js';
import { createTokenizationContext, tokenizeChunkText } from '../../../src/index/build/tokenization.js';
import { quantizeVec } from '../../../src/index/embedding.js';
import { normalizeWorkerPoolConfig } from '../../../src/index/build/workers/config.js';
import { runWithTimeout } from '../../../src/shared/promise-timeout.js';
import { createOrderedTokenizeBatchWindow } from '../../../src/index/build/workers/tokenize-batch.js';

const config = normalizeWorkerPoolConfig({ enabled: true, processFallback: true, maxWorkers: 2,
  heapTargetMb: 128, heapMinMb: 128, heapMaxMb: 128, taskTimeoutMs: 5000 }, { cpuLimit: 2 });
const dictWords = new Set(['hello', 'world', 'foo', 'bar']), dictConfig = { segmentation: 'greedy' };
const pools = await createIndexerWorkerPools({ config, dictWords, dictConfig,
  runtimeAttemptId: 'bounded-parent-attempt', buildId: 'bounded-build',
  memoryPolicy: { maxGlobalRssMb: 1024, effectiveMemory: { totalBytes: 1024 * 1024 * 1024 } }, log() {} });
process.once('SIGTERM', () => { void pools.destroy().finally(() => process.exit(1)); });
assert.ok(pools.tokenizePool, 'explicit process fallback must create an isolated backend under the large parent heap');
assert.equal(pools.tokenizePool.stats().backend, 'process');
try {
  const payload = { text: 'helloWorld fooBar', mode: 'code', ext: '.js' };
  const expected = tokenizeChunkText({ ...payload, context: createTokenizationContext({ dictWords, dictConfig }) });
  const vectors = [[0, 0.5], [1, 0]];
  const [tokens, quantized] = await Promise.all([pools.tokenizePool.tokenizeChunk(payload),
    pools.quantizePool.runQuantize({ vectors })]);
  for (const field of ['tokens', 'tokenIds', 'seq', 'ngrams', 'chargrams']) assert.deepEqual(tokens[field], expected[field]);
  assert.deepEqual(tokens.minhashSig, Array.from(expected.minhashSig || []));
  assert.deepEqual(quantized, vectors.map(vector => quantizeVec(vector)));
  const window = createOrderedTokenizeBatchWindow({ count: 2, getInput: () => payload,
    runSingle: () => assert.fail('the process qualification must execute a real batch'),
    runBatch: request => pools.tokenizePool.tokenizeBatch(request) });
  for (let index = 0; index < 2; index++) {
    assert.deepEqual(await window.take(index, payload), tokens, 'encoded batch members survive real process transport');
  }
  const distinctPools = [...new Set([pools.tokenizePool, pools.quantizePool])];
  let checkReady;
  const ready = new Promise(resolve => {
    checkReady = () => {
      if (distinctPools.reduce((count, pool) => count + pool.stats().runtimeObservations.length, 0) === 2) resolve();
    };
    for (const pool of distinctPools) pool.pool.on('message', checkReady);
    checkReady();
  });
  try { await runWithTimeout(() => ready, { timeoutMs: 5000 }); }
  finally { for (const pool of distinctPools) pool.pool.off('message', checkReady); }
  const observations = distinctPools.flatMap(pool => pool.stats().runtimeObservations);
  assert.equal(observations.length, 2);
  assert.equal(new Set(observations.map(item => item.pid)).size, 2);
  for (const observed of observations) {
    assert.equal(observed.resourceLimitAcknowledged, true);
    assert.equal(observed.parentAttemptId, 'bounded-parent-attempt');
    assert.equal(observed.buildId, 'bounded-build');
    assert.equal(observed.startupInputs.maxOldSpaceMb.value, 128);
  }
  console.log(JSON.stringify({ observations, processes: distinctPools.map(pool => pool.stats().process) }));
} finally { await pools.destroy(); }
