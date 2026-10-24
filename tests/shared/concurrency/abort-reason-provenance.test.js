import assert from 'node:assert/strict';
import { throwIfAborted, raceAbort } from '../../../src/shared/abort.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const pending = Object.freeze(Object.assign(new Error('original pending native owner'), {
  cacheOwnershipPending: true, cacheOwnershipReleased: () => false
}));
for (const reason of [undefined, null, false, 0, '', pending]) {
  const controller = new AbortController();
  controller.abort(reason);
  const verify = error => error.name === 'AbortError' && error.code === 'ABORT_ERR'
    && error.cause === controller.signal.reason;
  assert.throws(() => throwIfAborted(controller.signal), verify);
  await assert.rejects(raceAbort(controller.signal, Promise.resolve('not admitted')), verify);

  const active = new AbortController();
  const raced = raceAbort(active.signal, new Promise(() => {}));
  active.abort(reason);
  await assert.rejects(raced, error => error.name === 'AbortError' && error.code === 'ABORT_ERR'
    && error.cause === active.signal.reason);
}
const inspection = Object.freeze(new Error('original abort reason inspection'));
const signal = { aborted: true, get reason() { throw inspection; } };
assert.throws(() => throwIfAborted(signal), error => error.code === 'ABORT_ERR' && error.cause === inspection);
await assert.rejects(raceAbort(signal, Promise.resolve()), error => error.code === 'ABORT_ERR' && error.cause === inspection);
const live = new AbortController();
assert.equal(throwIfAborted(live.signal), undefined);
assert.equal(await raceAbort(live.signal, Promise.resolve('live')), 'live');
console.log('Abort helpers retain typed cancellation and exact original reason provenance.');
