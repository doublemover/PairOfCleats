import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createProcessChunksFixtureContext, processFixtureChunks } from './process-chunks-fixture.js';
import { createTokenizationEvidence, observedTokenizationExecution } from '../../../src/index/build/file-processor/tokenization-evidence.js';
import { attachEmbeddings } from '../../../src/index/build/file-processor/embeddings.js';
import { createWorkerPoolQueue } from '../../../src/index/build/workers/pool/queue.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
ensureTestingEnv(process.env);
const evidence = createTokenizationEvidence();
assert.equal(observedTokenizationExecution(evidence), 'not-yet-observed');
const controller = new AbortController(); let attempts = 0;
const { context } = createProcessChunksFixtureContext({ overrides: {
  signal: controller.signal, workerState: { tokenWorkerDisabled: false },
  tokenizationStats: { routeObservations: evidence },
  workerPool: { shouldUseForFile: () => true, tokenizeChunk: async () => {
    attempts += 1; controller.abort(); throw Object.assign(new Error('canceled'), { name: 'AbortError' });
  } }
} });
await assert.rejects(processFixtureChunks(context), { name: 'AbortError' });
assert.equal(attempts, 1);
assert.equal(context.workerState.tokenWorkerDisabled, false, 'cancellation is not a worker failure');
assert.equal(evidence.processedChunks, 0, 'aborted work is not recorded as successful inline execution');
await assert.rejects(attachEmbeddings({ chunks: [], embeddingEnabled: false, abortSignal: controller.signal }), { name: 'AbortError' });
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
for (const disposition of ['late-fulfillment', 'wrapped-cancellation', 'ordinary-failure']) {
  const controller = new AbortController(), entered = gate(), finish = gate(); let capturedSignal, terminal = false;
  const original = new Error('original worker terminal failure');
  const { context } = createProcessChunksFixtureContext({ overrides: { signal: controller.signal,
    workerState: { tokenWorkerDisabled: false }, workerPool: { shouldUseForFile: () => true,
      tokenizeChunk: async (_payload, options) => {
        capturedSignal = options.signal; entered.resolve(); await finish.promise;
        if (disposition !== 'late-fulfillment') throw original;
        return { tokens: ['worker'], seq: ['worker'], ngrams: [], chargrams: [] };
      } } } });
  const work = processFixtureChunks(context); work.then(() => { terminal = true; }, () => { terminal = true; });
  await entered.promise; assert.equal(capturedSignal, controller.signal);
  if (disposition !== 'ordinary-failure') {
    controller.abort(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(terminal, false, 'request retains its admitted worker until the original result settles');
  }
  finish.resolve();
  if (disposition === 'ordinary-failure') {
    const result = await work; assert.equal(result.chunks.length, 1);
    assert.equal(context.workerState.workerTokenizeFailed, true, 'genuine recoverable worker errors keep the existing inline policy');
  } else {
    await assert.rejects(work, error => error.name === 'AbortError' && (disposition === 'late-fulfillment' || errorGraphIncludes(error, original)));
    assert.equal(context.workerState.tokenWorkerDisabled, false); assert.equal(context.tokenizationStats.chunks, 0);
  }
}
const queue = createWorkerPoolQueue({ maxGlobalRssBytes: 10000,
  readMemoryUsage: () => ({ heapUsed: 999, heapTotal: 1000, rss: 1000 }),
  languageThrottleConfig: { heavyLanguages: ['typescript'], blockHeavyOnHardPressure: true } });
const pressuredController = new AbortController(); let pressuredSignal;
try {
  const { context } = createProcessChunksFixtureContext({ languageId: 'typescript', ext: '.ts', overrides: {
    signal: pressuredController.signal, workerState: { tokenWorkerDisabled: false },
    workerPool: { shouldUseForFile: () => true, tokenizeChunk: async (payload, { signal }) => {
      pressuredSignal = signal;
      const slot = await queue.acquireLanguageThrottleSlot({ ...payload, languageId: 'typescript' }, { signal });
      try { throw new Error('hard-pressure cancellation cannot reach dispatch'); }
      finally { queue.releaseLanguageThrottleSlot(slot); }
    } } } });
  const work = processFixtureChunks(context), rejected = assert.rejects(work, { name: 'AbortError' });
  for (let attempt = 0; attempt < 100 && queue.snapshot().languageThrottle.waiting !== 1; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(queue.snapshot().languageThrottle.waiting, 1); assert.equal(pressuredSignal, pressuredController.signal);
  pressuredController.abort(); await rejected;
  assert.equal(queue.snapshot().languageThrottle.waiting, 0); assert.equal(queue.snapshot().languageThrottle.refreshTimerCount, 0);
  assert.equal(context.tokenizationStats.chunks, 0); assert.equal(context.workerState.tokenWorkerDisabled, false);
} finally { pressuredController.abort(); await queue.close(); }
console.log('token worker abort and observed execution evidence passed');
