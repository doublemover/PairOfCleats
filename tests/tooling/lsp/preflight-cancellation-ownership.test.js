import assert from 'node:assert/strict';
import {
  awaitToolingProviderPreflight,
  getToolingProviderPreflightSchedulerMetrics,
  teardownToolingProviderPreflights
} from '../../../src/index/tooling/preflight-manager.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const context = () => ({ repoRoot: process.cwd(), toolingConfig: { preflight: { maxConcurrency: 1 } } });

for (const policy of ['required', 'optional']) {
  const ctx = context(), started = deferred(), aborted = deferred(), drained = deferred();
  const controller = new AbortController();
  let calls = 0, nextCalls = 0;
  const provider = {
    id: `fixture-cancel-${policy}`, preflightPolicy: policy,
    async preflight(_ctx, { abortSignal }) {
      calls += 1;
      abortSignal.addEventListener('abort', () => aborted.resolve(), { once: true });
      started.resolve();
      await drained.promise;
      return { state: 'ready' };
    }
  };
  const active = awaitToolingProviderPreflight(ctx, { provider, inputs: { abortSignal: controller.signal }, waveToken: 'cancel-wave' });
  const observed = assert.rejects(active, { name: 'AbortError' });
  await started.promise;
  const queued = awaitToolingProviderPreflight(ctx, { provider: {
    id: `fixture-next-${policy}`, preflight: async () => { nextCalls += 1; return { state: 'ready' }; }
  } });
  controller.abort(new Error('fixture cancellation'));
  await observed;
  await aborted.promise;
  assert.equal(nextCalls, 0, 'outward cancellation must not release the draining provider slot');
  assert.equal(getToolingProviderPreflightSchedulerMetrics(ctx).running, 1);
  await assert.rejects(awaitToolingProviderPreflight(ctx, {
    provider, inputs: { abortSignal: controller.signal }, waveToken: 'cancel-wave'
  }), { name: 'AbortError' }, 'cancelled callers cannot reuse completed optional preflight');
  assert.equal(calls, 1, 'pending single-flight operation stays owned');
  drained.resolve();
  await queued;
  await tick();
  assert.equal(nextCalls, 1);
  assert.equal((await teardownToolingProviderPreflights(ctx)).status, 'ok');
}

{
  const ctx = context(), started = deferred(), drained = deferred();
  let nextCalls = 0;
  const active = awaitToolingProviderPreflight(ctx, { provider: {
    id: 'fixture-timeout-drain', preflightPolicy: 'optional', preflightTimeoutMs: 250,
    async preflight() { started.resolve(); await drained.promise; return { state: 'ready' }; }
  } });
  await started.promise;
  const queued = awaitToolingProviderPreflight(ctx, { provider: {
    id: 'fixture-after-timeout', preflight: async () => { nextCalls += 1; return { state: 'ready' }; }
  } });
  const timedOut = await active;
  assert.equal(timedOut.state, 'degraded');
  assert.equal(timedOut.blockProvider, true, 'optional timeout must prevent server launch during unresolved preflight teardown');
  assert.equal(nextCalls, 0);
  assert.equal(getToolingProviderPreflightSchedulerMetrics(ctx).running, 1);
  drained.resolve();
  await queued;
  await tick();
  assert.equal(nextCalls, 1);
}

{
  const ctx = context(), controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(awaitToolingProviderPreflight(ctx, { provider: {
    id: 'fixture-never-start', preflight: async () => { calls += 1; }
  }, inputs: { abortSignal: controller.signal } }), { name: 'AbortError' });
  await tick();
  assert.equal(calls, 0, 'already cancelled tasks must never enter the provider');
  assert.equal(getToolingProviderPreflightSchedulerMetrics(ctx).running, 0);
}

{
  const ctx = context(), started = deferred(), drained = deferred(), controller = new AbortController();
  const inputController = new AbortController();
  ctx.abortSignal = controller.signal;
  const active = awaitToolingProviderPreflight(ctx, { provider: {
    id: 'fixture-compose-signals', preflightPolicy: 'optional',
    async preflight() { started.resolve(); await drained.promise; }
  }, inputs: { abortSignal: inputController.signal } });
  const observed = assert.rejects(active, { name: 'AbortError' });
  await started.promise;
  controller.abort();
  await observed;
  drained.resolve();
  await tick();
}

console.log('preflight cancellation preserves terminal outcome and owned execution capacity');
