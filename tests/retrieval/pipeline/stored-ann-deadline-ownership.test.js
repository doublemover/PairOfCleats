import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { buildAnnPipelineFixture } from './helpers/ann-scenarios.js';
import { getGenerationProviderRuntime } from '../../../src/retrieval/pipeline/provider-runtime.js';
import { observeAnnAttemptFailure } from '../../../src/retrieval/pipeline/provider-failure.js';
import { performance } from 'node:perf_hooks';

const settings = { enabled: true, exactRows: 256, coordinateWork: 512, maxAttempts: 3,
  requestedHitWork: 512, maxTopN: 256, maxMs: 1000 };
const timeoutMethod = AbortSignal.timeout, immediate = globalThis.setImmediate;
const clockDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
try {
  Object.defineProperty(performance, 'now', { value: () => 0, configurable: true });
  for (const route of ['stored', 'provider']) {
    for (const origin of ['deadline', 'caller', 'both', 'none']) {
      const caller = new AbortController();
      let deadline = null, yielded = false, providerCalls = 0;
      AbortSignal.timeout = () => { deadline = new AbortController(); return deadline.signal; };
      globalThis.setImmediate = (callback, ...args) => immediate(() => {
        if (!yielded && deadline) {
          yielded = true;
          if (origin === 'deadline' || origin === 'both') deadline.abort(new Error('controlled planner deadline'));
          if (origin === 'caller' || origin === 'both') caller.abort(new Error('controlled caller cancellation'));
        }
        callback(...args);
      });
      const provider = { id: ANN_PROVIDER_IDS.DENSE, isAvailable: () => true, query: async ({ signal }) => {
        providerCalls += 1;
        await new Promise(resolve => setImmediate(resolve));
        throwIfAborted(signal);
        return [{ idx: 0, sim: 1 }, { idx: 1, sim: 0.5 }];
      } };
      const fixture = buildAnnPipelineFixture({ createAnnProviders: () => new Map([[ANN_PROVIDER_IDS.DENSE, provider]]) });
      fixture.context.signal = caller.signal;
      fixture.context.countAwareAnnPolicy = { ...settings, exactRows: route === 'stored' ? 256 : 0 };
      fixture.context.scoreBlend = { enabled: true, sparseWeight: 0, annWeight: 1 };
      fixture.idx.chunkMeta = Array.from({ length: 129 }, (_, id) => ({ id, file: `src/${id}.js`, tokens: ['alpha'] }));
      fixture.idx.tokenIndex = { vocab: ['alpha'], postings: [[]], docLengths: Array(129).fill(1), totalDocs: 129, avgDocLen: 1 };
      fixture.idx.denseVec = { dims: 2, minVal: -1, maxVal: 1, levels: 256, scale: 2 / 255,
        vectors: Array.from({ length: 129 }, () => [255, 0]) };
      const result = createSearchPipeline(fixture.context)(fixture.idx, 'code', [1, 0]);
      if (origin === 'caller' || origin === 'both') await assert.rejects(result, { name: 'AbortError' });
      else {
        await result;
        const receipt = fixture.stageTracker.stages.find(stage => stage.stage === 'ann').countAware;
        if (origin === 'deadline') {
          assert.equal(receipt.reasonEnded, 'deadline'); assert.equal(receipt.complete, false);
          assert.equal(receipt.attempts.length, 1, 'deadline stops further attempt admission');
          assert.equal(receipt.attempts[0].status, 'deadline');
          assert.equal(receipt.recallCertified, false);
          assert.match(receipt.exactness, /unknown/);
          if (route === 'stored') {
            assert.equal(receipt.vectorsScored, 128, 'actual scorer records admitted work before its controlled scalar-block yield');
            assert.equal(receipt.coordinatesScored, 256);
          }
        } else if (route === 'stored') assert.equal(receipt.complete, true);
      }
      assert.equal(yielded, true, 'controlled cancellation runs at an actual asynchronous work boundary');
      assert.equal(providerCalls, route === 'stored' ? 0 : 1);
      assert.equal(getGenerationProviderRuntime(fixture.idx).getProviderModeState(provider, 'code').failures, 0);
    }
  }
  const ordinary = new Error('settled scan failure');
  assert.equal(observeAnnAttemptFailure(ordinary).deadline, false);
  const independentAbort = Object.assign(new Error('provider abort'), { name: 'AbortError' });
  assert.throws(() => observeAnnAttemptFailure(independentAbort), error => error === independentAbort);
  const pending = Object.assign(new Error('pending original resource'), { cacheOwnershipReleased: () => false });
  assert.throws(() => observeAnnAttemptFailure(pending, { timeout: AbortSignal.abort() }),
    error => error.cacheOwnershipPending === true, 'deadline cannot hide unsettled original work');
} finally {
  AbortSignal.timeout = timeoutMethod; globalThis.setImmediate = immediate;
  if (clockDescriptor) Object.defineProperty(performance, 'now', clockDescriptor);
  else delete performance.now;
}
console.log('Stored/provider ANN deadlines share cancellation ownership, exactness, work accounting and health semantics.');
