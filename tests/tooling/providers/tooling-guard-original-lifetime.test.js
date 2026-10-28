import assert from 'node:assert/strict';
import { createToolingGuard } from '../../../src/integrations/tooling/providers/shared.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: actual shared retry/breaker owner and inert request callbacks.
// No provider, server, compiler, child process or native runtime is started.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['pending', 'unmarked', 'unconfirmable', 'result', 'replacement', 'settled', 'cancelled',
  'ordinary-retry', 'exhausted', 'falsey', 'diagnostic-independent', 'log-independent', 'late-diagnostic', 'retry-boundary'].includes(selected));
let settled = ['settled', 'late-diagnostic', 'retry-boundary'].includes(selected), independentSettled = false, calls = 0, timer;
const independent = Object.freeze(Object.assign(new Error('independent original diagnostic work'), {
  cacheOwnershipReleased() { assert.equal(this, independent); return independentSettled; }
}));
const resource = Object.assign(new Error('original unsettled request work'), {
  ...(selected === 'pending' || selected === 'unconfirmable' ? { cacheOwnershipPending: true } : {}),
  ...(selected === 'unconfirmable' ? {} : { cacheOwnershipReleased() { assert.equal(this, resource); return settled; } })
});
const ordinary = new Error('original ordinary request failure');
if (selected === 'diagnostic-independent') Object.defineProperty(ordinary, 'message', { get() { throw independent; } });
const guard = createToolingGuard({ name: 'inert-guard', retries: ['ordinary-retry', 'settled', 'retry-boundary'].includes(selected) ? 1 : 0,
  breakerThreshold: selected === 'exhausted' ? 1 : 3, log() {
    if (selected === 'log-independent') throw independent;
    if (selected === 'late-diagnostic') { settled = false; resource.cacheOwnershipReleased = () => true; }
  } });
const attempt = () => guard.run(() => {
  calls++;
  if (selected === 'ordinary-retry') { if (calls === 1) throw ordinary; return 17; }
  if (selected === 'settled') { if (calls === 1) throw resource; return 17; }
  if (selected === 'cancelled') throw Object.assign(new Error('cancelled original request'), { name: 'AbortError', code: 'ABORT_ERR' });
  if (selected === 'falsey') throw null;
  if (selected === 'retry-boundary') { timer = setTimeout(() => { settled = false; }, 1); throw resource; }
  if (['diagnostic-independent', 'log-independent', 'exhausted'].includes(selected)) throw ordinary;
  if (selected === 'result') return resource;
  throw resource;
}, { label: 'hover' });
try {
  if (selected === 'ordinary-retry' || selected === 'settled') {
    assert.equal(await attempt(), 17); assert.equal(calls, 2); assert.equal(guard.getState().consecutiveFailures, 0);
  } else if (selected === 'cancelled') {
    await assert.rejects(attempt(), { name: 'AbortError' }); assert.equal(calls, 1);
    assert.equal(guard.getState().consecutiveFailures, 0); assert.equal(guard.getState().tripCount, 0);
  } else if (selected === 'falsey') {
    let failed = false;
    try { await attempt(); } catch (error) { failed = true; assert.equal(error, null); }
    assert.equal(failed, true); assert.equal(calls, 1); assert.equal(guard.getState().lastFailure.message, 'null');
  } else if (selected === 'exhausted') {
    await assert.rejects(attempt(), error => error === ordinary); assert.equal(calls, 1);
    assert.equal(guard.isOpen(), true); assert.equal(guard.getState().lastFailure.label, 'hover');
    await assert.rejects(guard.run(() => { calls++; }), { code: 'TOOLING_CIRCUIT_OPEN' }); assert.equal(calls, 1);
  } else {
    let failure;
    await assert.rejects(attempt(), error => { failure = error; return errorGraphIncludes(error,
      ['diagnostic-independent', 'log-independent'].includes(selected) ? ordinary : resource); });
    assert.equal(calls, 1, 'original unconfirmed work cannot be retried');
    if (['diagnostic-independent', 'log-independent'].includes(selected)) assert.equal(errorGraphIncludes(failure, independent), true);
    if (selected === 'replacement') resource.cacheOwnershipReleased = () => true;
    assert.throws(() => guard.isOpen(), 'ordinary breaker admission cannot hide original pending work');
    assert.throws(() => guard.assertSettled());
    await assert.rejects(guard.run(() => { calls++; return 23; }));
    assert.equal(calls, 1, 'later methods cannot overlap original unsettled resources');
    assert.ok(guard.getState().pendingObservationCount > 0);
    if (selected !== 'unconfirmable') {
      settled = true; independentSettled = true;
      assert.equal(await guard.run(() => { calls++; return 23; }), 23);
      assert.equal(calls, 2); assert.equal(guard.getState().pendingObservationCount, 0);
      assert.equal(failure.cacheOwnershipReleased(), true);
    }
  }
} finally { settled = true; independentSettled = true; clearTimeout(timer); }
console.log(`Tooling guard original lifetime: ${selected}`);
