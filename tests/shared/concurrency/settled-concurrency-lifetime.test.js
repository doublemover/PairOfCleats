import assert from 'node:assert/strict';
import { runWithSettledConcurrency } from '../../../src/shared/concurrency/run-with-queue.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const release = gate(), bothStarted = gate(), controller = new AbortController();
const cancellation = Object.assign(new Error('controlled original cancellation'), { name: 'AbortError', code: 'ABORT_ERR' });
let started = 0, settled = false;
const running = runWithSettledConcurrency([0, 1, 2], 2, async (_value, { signal }) => {
  if (++started === 2) bothStarted.resolve();
  await release.promise;
  signal.throwIfAborted();
}, { signal: controller.signal });
running.then(() => { settled = true; }, () => { settled = true; });
try {
  await bothStarted.promise; controller.abort(cancellation);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'abort cannot outlive the two retained original operations');
  release.resolve();
  await assert.rejects(running, error => error.name === 'AbortError' && error.code === 'ABORT_ERR'
    && errorGraphIncludes(error, cancellation), 'the cancellation observed before settlement retains its exact original reason');
  assert.equal(started, 2, 'the third original operation is never admitted');
} finally { release.resolve(); await running.catch(() => {}); }
for (const failure of [null, undefined, false, 0, '']) {
  let calls = 0;
  await assert.rejects(runWithSettledConcurrency([1, 2], 1, async () => { calls++; throw failure; }), error => error === failure);
  assert.equal(calls, 1, 'falsey failures stop admission and preserve their exact value without retries');
}
console.log('Bounded concurrency drains actual work on cancellation and preserves every original failure.');

for (const secondary of [null, false, 0, '', Object.freeze(new Error('late original close failure'))]) {
  const controller = new AbortController(), release = gate(), entered = gate();
  const cancellation = Object.freeze(Object.assign(new Error('cancelled before original close settlement'), { name: 'AbortError' }));
  const running = runWithSettledConcurrency([0, 1], 1, async () => {
    entered.resolve(); await release.promise; throw secondary;
  }, { signal: controller.signal });
  await entered.promise; controller.abort(cancellation); release.resolve();
  await assert.rejects(running, error => error.name === 'AbortError' && error.code === 'ABORT_ERR'
    && errorGraphIncludes(error, cancellation) && errorGraphIncludes(error, secondary));
}

const first = Object.freeze(Object.defineProperty(new Error('original first failure'), 'code', {
  get() { assert.equal(this, first, 'diagnostic getters retain their original receiver'); return 'EIO'; }
}));
const second = Object.freeze(new Error('original second failure'));
const failuresReady = gate(); let arrivals = 0;
await assert.rejects(runWithSettledConcurrency([first, second], 2, async failure => {
  if (++arrivals === 2) failuresReady.resolve();
  await failuresReady.promise; throw failure;
}), error => error instanceof AggregateError && error.cause === first && error.code === 'EIO'
  && error.errors[0] === first && error.errors[1] === second);
