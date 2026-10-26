import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { createCountAwareAnnWork, planCountAwareAnn, resolveCountAwareAnnPolicy } from '../../../src/retrieval/pipeline/count-aware-ann.js';
import { createProviderRuntime, getGenerationProviderRuntime } from '../../../src/retrieval/pipeline/provider-runtime.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { buildAnnPipelineFixture } from './helpers/ann-scenarios.js';

const settings = { enabled: true, exactRows: 0, coordinateWork: 32, maxAttempts: 3,
  requestedHitWork: 64, maxTopN: 32, maxMs: 1000 };
const policy = resolveCountAwareAnnPolicy(settings);
const plan = planCountAwareAnn({ policy, documentCount: 2, requestedTopN: 2 });
let clock = 0;
const timer = new AbortController(), timerRequests = [];
const work = createCountAwareAnnWork({ policy, plan }, { now: () => clock,
  createDeadlineSignal: ms => { timerRequests.push(ms); return timer.signal; } });
const preparation = work.beginPreflight('controlled');
assert.equal(preparation.signal, timer.signal);
clock = 250; preparation.finish('returned'); preparation.finish('failed');
const attempt = work.reserve('controlled', 2);
assert.equal(attempt.signal, preparation.signal, 'query and preflight share one deadline rather than renewing it');
assert.deepEqual(timerRequests, [settings.maxMs]);
assert.equal(work.receipt.requestedHitWork, 2, 'preflight does not masquerade as requested-hit effort');
assert.deepEqual(work.receipt.preflightChecks, [{ provider: 'controlled', status: 'returned', elapsedMs: 250,
  nativeWork: null, cache: 'unknown' }]);
clock = settings.maxMs;
assert.equal(work.beginPreflight('late'), null); assert.equal(work.reserve('late', 1), null);
assert.equal(work.receipt.reasonEnded, 'deadline'); assert.equal(work.isBudgetEnded(), true);
assert.equal(work.finish().complete, false);
const exhausted = createCountAwareAnnWork({ policy: { ...policy, maxAttempts: 1 }, plan }, {
  now: () => 0, createDeadlineSignal: () => new AbortController().signal });
assert.ok(exhausted.reserve('one', 1));
assert.equal(exhausted.beginPreflight('three'), null, 'terminal attempt exhaustion fences later preflight');
assert.equal(exhausted.reserve('two', 1), null);
assert.equal(exhausted.receipt.reasonEnded, 'attempt-limit');

const timeoutMethod = AbortSignal.timeout;
const clockDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
const configure = (providers, onCreate = () => {}) => {
  const fixture = buildAnnPipelineFixture({ createAnnProviders: () => {
    onCreate(); return new Map(providers.map(provider => [provider.id, provider]));
  } });
  fixture.context.annBackend = 'auto'; fixture.context.countAwareAnnPolicy = settings;
  fixture.context.scoreBlend = { enabled: true, sparseWeight: 0, annWeight: 1 };
  return fixture;
};
try {
  Object.defineProperty(performance, 'now', { configurable: true, value: () => clock });
  for (const phase of ['before-dispatch', 'preflight', 'query', 'availability', 'late-preflight-return', 'late-query-return']) {
    clock = 0;
    let deadline, timers = 0, queries = 0, preflights = 0, availabilityCalls = 0, laterCalls = 0, settled = false;
    AbortSignal.timeout = milliseconds => {
      assert.equal(milliseconds, settings.maxMs); timers++;
      deadline = new AbortController(); return deadline.signal;
    };
    const expire = () => { clock = settings.maxMs; deadline.abort(new Error('controlled request budget')); };
    const cooperative = signal => new Promise((resolve, reject) => {
      assert.notEqual(signal, fixture.context.signal);
      signal.addEventListener('abort', () => { settled = true; reject(signal.reason); }, { once: true });
      queueMicrotask(expire);
    });
    const first = { id: ANN_PROVIDER_IDS.HNSW, isAvailable: () => {
      availabilityCalls++;
      if (phase === 'availability') clock = settings.maxMs;
      return true;
    }, preflight: async ({ signal }) => {
      preflights++;
      if (phase === 'preflight') return cooperative(signal);
      if (phase === 'late-preflight-return') clock = settings.maxMs;
      return true;
    }, query: async ({ signal }) => {
      queries++;
      if (phase === 'query') return cooperative(signal);
      if (phase === 'late-query-return') clock = settings.maxMs;
      return [{ idx: 0, sim: 1 }];
    } };
    const second = { id: ANN_PROVIDER_IDS.DENSE, isAvailable: () => { laterCalls++; return true; },
      preflight: async () => { laterCalls++; return true; }, query: async () => { laterCalls++; return []; } };
    const fixture = configure([first, second], () => { if (phase === 'before-dispatch') clock = settings.maxMs; });
    const caller = new AbortController(); fixture.context.signal = caller.signal;
    await createSearchPipeline(fixture.context)(fixture.idx, 'code', [1, 0]);
    const receipt = fixture.stageTracker.stages.find(stage => stage.stage === 'ann').countAware;
    assert.equal(receipt.reasonEnded, 'deadline', phase); assert.equal(receipt.complete, false);
    assert.equal(receipt.returned, 0); assert.equal(receipt.recallCertified, false);
    assert.equal(receipt.deadlineScope, 'preflight-and-query');
    assert.equal(caller.signal.aborted, false); assert.equal(timers, 1);
    assert.equal(laterCalls, 0, `${phase}: no later provider availability, preflight or query dispatch`);
    assert.equal(queries, ['query', 'late-query-return'].includes(phase) ? 1 : 0);
    assert.equal(availabilityCalls, phase === 'before-dispatch' ? 0 : 1);
    assert.equal(preflights, ['availability', 'before-dispatch'].includes(phase) ? 0 : 1);
    if (phase === 'preflight' || phase === 'query') assert.equal(settled, true, 'original cooperative work settled before return');
    assert.equal(getGenerationProviderRuntime(fixture.idx).getProviderModeState(first, 'code').failures, 0);
    if (preflights) assert.equal(receipt.preflightChecks[0].status, queries ? 'returned' : 'deadline');
  }

  // Ordinary success, cache admission and absence of a hook retain fast paths.
  clock = 0; AbortSignal.timeout = () => new AbortController().signal;
  let preflightCalls = 0, queryCalls = 0;
  const successful = { id: ANN_PROVIDER_IDS.DENSE, isAvailable: () => true,
    preflight: async ({ signal }) => { preflightCalls++; assert.equal(signal.aborted, false); return true; },
    query: async () => { queryCalls++; return [{ idx: 0, sim: 1 }, { idx: 1, sim: 0.5 }]; } };
  const ready = configure([successful]), pipeline = createSearchPipeline(ready.context);
  await pipeline(ready.idx, 'code', [1, 0]); await pipeline(ready.idx, 'code', [1, 0]);
  assert.equal(preflightCalls, 1); assert.equal(queryCalls, 2);
  const runtime = createProviderRuntime();
  assert.equal(await runtime.ensureProviderPreflight({ id: 'no-hook' }, {}), true);
  assert.equal(await runtime.ensureProviderPreflight(successful, { mode: 'code', signal: new AbortController().signal }), true);
  await assert.rejects(runtime.ensureProviderPreflight(successful, { mode: 'code', deadline: AbortSignal.abort() }),
    { name: 'AbortError' }, 'expired requests cannot reuse a cached preflight as renewed admission');

  let laterDispatches = 0;
  const exhaustedFixture = configure([
    { id: ANN_PROVIDER_IDS.HNSW, isAvailable: () => true, query: async () => [] },
    { id: ANN_PROVIDER_IDS.DENSE, isAvailable: () => { laterDispatches++; return true; },
      preflight: async () => { laterDispatches++; return true; }, query: async () => { laterDispatches++; return []; } }
  ]);
  exhaustedFixture.context.countAwareAnnPolicy = { ...settings, maxAttempts: 1 };
  await createSearchPipeline(exhaustedFixture.context)(exhaustedFixture.idx, 'code', [1, 0]);
  assert.equal(laterDispatches, 0);
  assert.equal(exhaustedFixture.stageTracker.stages.find(stage => stage.stage === 'ann').countAware.reasonEnded, 'attempt-limit');

  for (const origin of ['caller', 'ordinary', 'pending']) {
    let deadline, settled = false, invoked = 0;
    AbortSignal.timeout = () => { deadline = new AbortController(); return deadline.signal; };
    const caller = new AbortController();
    const original = Object.assign(new Error('original preflight failure'), {
      ...(origin === 'pending' ? { cacheOwnershipPending: true, cacheOwnershipReleased: () => settled } : {})
    });
    const provider = { id: ANN_PROVIDER_IDS.DENSE, isAvailable: () => true,
      preflight: async ({ signal }) => {
        invoked++;
        if (origin === 'caller') { caller.abort(new Error('caller reason')); throwIfAborted(signal); }
        if (origin === 'pending') deadline.abort(new Error('internal deadline cannot discard live original work'));
        throw original;
      }, query: async () => assert.fail('failed preflight cannot launch a query') };
    const fixture = configure([provider]); fixture.context.signal = caller.signal;
    const warnings = [], warn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      const result = createSearchPipeline(fixture.context)(fixture.idx, 'code', [1, 0]);
      if (origin === 'caller') await assert.rejects(result, { name: 'AbortError', cause: caller.signal.reason });
      else if (origin === 'pending') await assert.rejects(result, error => {
        assert.equal(error.cacheOwnershipPending, true); assert.equal(error.cacheOwnershipReleased(), false);
        settled = true; assert.equal(error.cacheOwnershipReleased(), true); return true;
      });
      else {
        await result;
        assert.equal(getGenerationProviderRuntime(fixture.idx).getProviderModeState(provider, 'code').failures, 1);
      }
    } finally { console.warn = warn; }
    assert.equal(warnings.length, origin === 'ordinary' ? 1 : 0);
    if (warnings.length) assert.match(warnings[0], /Vector ANN unavailable for code.*Falling back to sparse ranking/u);
    assert.equal(invoked, 1);
  }
} finally {
  AbortSignal.timeout = timeoutMethod;
  if (clockDescriptor) Object.defineProperty(performance, 'now', clockDescriptor);
  else delete performance.now;
}
console.log('Count-aware preflight and query share deadline admission, settled resource ownership and distinct health/cancellation outcomes.');
