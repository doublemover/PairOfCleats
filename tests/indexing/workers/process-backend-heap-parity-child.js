import assert from 'node:assert/strict';
import { createIndexerWorkerPools } from '../../../src/index/build/workers/pool.js';
import { createTokenizationContext, tokenizeChunkText } from '../../../src/index/build/tokenization.js';
import { quantizeVec } from '../../../src/index/embedding.js';
import { normalizeWorkerPoolConfig } from '../../../src/index/build/workers/config.js';

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
  const [tokens, quantized] = await Promise.all([pools.tokenizePool.tokenizeChunk(payload),
    pools.quantizePool.runQuantize({ vectors: [[0, 0.5], [1, -1]] })]);
  for (const field of ['tokens', 'tokenIds', 'seq', 'ngrams', 'chargrams']) assert.deepEqual(tokens[field], expected[field]);
  assert.deepEqual(tokens.minhashSig, Array.from(expected.minhashSig || []));
  assert.deepEqual(quantized, [[0, 0.5], [1, -1]].map(vector => quantizeVec(vector)));
  const observations = pools.tokenizePool.stats().runtimeObservations;
  assert.equal(observations.length, 2);
  assert.equal(new Set(observations.map(item => item.pid)).size, 2);
  for (const observed of observations) {
    assert.equal(observed.resourceLimitAcknowledged, true);
    assert.equal(observed.parentAttemptId, 'bounded-parent-attempt');
    assert.equal(observed.buildId, 'bounded-build');
    assert.equal(observed.startupInputs.maxOldSpaceMb.value, 128);
  }
  console.log(JSON.stringify({ observations, process: pools.tokenizePool.stats().process }));
} finally { await pools.destroy(); }
