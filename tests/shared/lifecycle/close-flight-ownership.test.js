import assert from 'node:assert/strict';
import { createLifecycleRegistry } from '../../../src/shared/lifecycle/registry.js';

// Actual registry boundaries with inert hooks; authored, not executed.
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const gate = deferred(), entered = deferred();
const registry = createLifecycleRegistry({ name: 'exact-close-flight' });
let closes = 0, drains = 0, closeReads = 0, drainReads = 0, replace = false, nested;
const resource = {
  get close() {
    closeReads++;
    if (replace) return () => assert.fail('cannot replace original close');
    return async function () {
      assert.equal(this, resource); closes++;
      nested = registry.close();
      entered.resolve();
      await gate.promise;
    };
  },
  get drain() {
    drainReads++;
    if (replace) return () => assert.fail('cannot replace original drain');
    return function () { assert.equal(this, resource); drains++; };
  }
};
registry.register(resource);
replace = true;
const first = registry.close(), second = registry.close();
let secondSettled = false;
second.then(() => { secondSettled = true; });
try {
  assert.equal(first, second, 'concurrent callers join the exact original close flight');
  assert.equal(registry.isClosed(), true, 'closed marks admission, not resource settlement');
  assert.throws(() => registry.registerCleanup(() => {}), /is closed/);
  await entered.promise;
  assert.equal(nested, first, 'a reentrant close callback cannot start another flight');
  assert.equal(secondSettled, false, 'another close cannot claim success before accepted cleanup settles');
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(closes, 1); assert.equal(drains, 1);
  assert.equal(closeReads, 1); assert.equal(drainReads, 1);
  assert.equal(registry.close(), first);
} finally { gate.resolve(); await first; }

for (const value of [undefined, null, false, 0, '']) {
  const failed = createLifecycleRegistry({ name: 'falsey-close-rejection' });
  let independent = 0, attempts = 0;
  failed.registerCleanup(() => { independent++; });
  failed.registerCleanup(() => { attempts++; throw value; });
  const closing = failed.close();
  const outcome = await closing.then(() => ({ rejected: false }), error => ({ rejected: true, error }));
  assert.equal(outcome.rejected, true);
  assert.equal(outcome.error, value);
  assert.equal(independent, 1, 'other original cleanup still runs');
  const repeated = failed.close();
  assert.equal(repeated, closing, 'a recorded failure cannot become success on a later close');
  assert.deepEqual(await repeated.then(() => ({ rejected: false }), error => ({ rejected: true, error })), outcome);
  assert.equal(attempts, 1, 'repeated close does not retry rejected resource destruction');

  const draining = createLifecycleRegistry({ name: 'falsey-drain-rejection' });
  draining.register(null, { drain() { throw value; } });
  const drained = await draining.drain().then(() => ({ rejected: false }), error => ({ rejected: true, error }));
  assert.equal(drained.rejected, true); assert.equal(drained.error, value);
  await draining.close().catch(() => {});
}
console.log('Lifecycle close-flight ownership and exact failure presence authored; execution deferred.');
