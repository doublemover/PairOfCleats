import assert from 'node:assert/strict';
import PQueue from 'p-queue';
import { getEventListeners } from 'node:events';
import { runWithQueue } from '../../../src/shared/concurrency/run-with-queue.js';
import { runWithTimeout } from '../../../src/shared/promise-timeout.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const pending = Object.freeze(Object.assign(new Error('original pending abort owner'), {
  cacheOwnershipPending: true, cacheOwnershipReleased: () => false
}));
const reasons = [undefined, null, false, 0, '', Object.freeze(new Error('exact original reason')), pending];
const verify = signal => error => error.name === 'AbortError' && error.code === 'ABORT_ERR'
  && Object.hasOwn(error, 'cause') && error.cause === signal.reason;
for (const reason of reasons) {
  for (const timeoutMs of [0, 5000]) {
    const controller = new AbortController(); controller.abort(reason);
    let calls = 0;
    await assert.rejects(runWithTimeout(() => { calls++; }, { timeoutMs, signal: controller.signal }), verify(controller.signal));
    assert.equal(calls, 0); assert.deepEqual(getEventListeners(controller.signal, 'abort'), []);
  }
  const controller = new AbortController(), entered = deferred(), finish = deferred();
  let original, childSignal, originalSettled = false;
  const work = runWithTimeout(signal => {
    childSignal = signal; entered.resolve();
    original = finish.promise.then(() => { originalSettled = true; return 'original-result'; });
    return original;
  }, { timeoutMs: 5000, signal: controller.signal });
  try {
    await entered.promise; controller.abort(reason);
    await assert.rejects(work, verify(controller.signal));
    assert.equal(childSignal.reason, controller.signal.reason);
    assert.equal(originalSettled, false, 'abort refusal cannot claim the accepted operation settled');
    assert.deepEqual(getEventListeners(controller.signal, 'abort'), []);
  } finally { finish.resolve(); await original; }
  assert.equal(originalSettled, true);

  for (const phase of ['before', 'drain', 'capacity']) for (const override of [null, Object.freeze(new Error('explicit abort override'))]) {
    const signalOwner = new AbortController(), started = deferred(), release = deferred();
    const queue = new PQueue({ concurrency: 1 });
    if (phase === 'capacity') queue.maxPending = 1;
    let calls = 0, completed = 0;
    if (phase === 'before') signalOwner.abort(reason);
    const operation = runWithQueue(queue, phase === 'capacity' ? [1, 2] : [1], async () => {
      calls++; started.resolve(); await release.promise; completed++;
    }, { signal: signalOwner.signal, ...(override ? { abortError: override } : {}) });
    try {
      if (phase !== 'before') { await started.promise; signalOwner.abort(reason); }
      await assert.rejects(operation, override ? error => error === override : verify(signalOwner.signal));
      assert.equal(calls, phase === 'before' ? 0 : 1); assert.equal(completed, 0);
    } finally { release.resolve(); await queue.onIdle(); }
    assert.equal(completed, phase === 'before' ? 0 : 1);
    assert.deepEqual(getEventListeners(signalOwner.signal, 'abort'), []);
  }
}
const inspection = Object.freeze(new Error('original fallible reason inspection'));
const fallibleSignal = { aborted: true, get reason() { throw inspection; }, addEventListener() {}, removeEventListener() {} };
for (const execute of [() => runWithTimeout(() => assert.fail('not admitted'), { timeoutMs: 50, signal: fallibleSignal }),
  () => runWithQueue(new PQueue({ concurrency: 1 }), [1], () => assert.fail('not admitted'), { signal: fallibleSignal })]) {
  await assert.rejects(execute(), error => error.code === 'ABORT_ERR' && error.cause === inspection);
}
assert.equal(await runWithTimeout(() => 'normal', { timeoutMs: 5000 }), 'normal');
assert.deepEqual(await runWithQueue(new PQueue({ concurrency: 1 }), [1], async value => value), [1]);
console.log('Actual timeout/queue admission and live abort branches retain exact original reasons, override identity and accepted work.');
