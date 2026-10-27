import assert from 'node:assert/strict';
import { createBackendDisposer } from '../../../src/retrieval/cli/backend-disposal.js';
import { closeLmdbDatabase } from '../../../src/storage/lmdb/close.js';

let originalSettled = false, observer = () => originalSettled, observations = 0, sibling = 0;
const native = new Error('original close failure');
Object.defineProperties(native, {
  cacheOwnershipPending: { value: true },
  cacheOwnershipReleased: { get() { observations++; return observer; } }
});
const close = createBackendDisposer(new Set([
  () => { throw native; },
  () => { sibling++; observer = () => true; }
]));
const first = close();
assert.equal(close(), first);
let failure;
await assert.rejects(first, error => { failure = error; return true; });
assert.equal(sibling, 1, 'independent resources still receive cleanup');
assert.equal(failure.cacheOwnershipReleased(), false, 'a replacement report callback cannot acknowledge the original native failure');
originalSettled = true;
assert.equal(failure.cacheOwnershipReleased(), true);
const reads = observations;
await assert.rejects(close(), error => error === failure, 'failure remains exact on repeated disposal');
assert.equal(sibling, 1); assert.equal(observations, reads, 'repeated disposal does not recapture observers');

for (const kind of ['false', 'throw', 'frozen']) {
  const original = kind === 'frozen' ? Object.freeze(new Error('frozen close failed')) : new Error('close failed');
  let callback;
  await assert.rejects(closeLmdbDatabase({}, (_callback => {
    callback = _callback;
    if (kind === 'false') return false;
    throw original;
  })), error => {
    assert.equal(error.cacheOwnershipReleased(), false);
    callback();
    assert.equal(error.cacheOwnershipReleased(), false, 'a callback cannot erase a failed original close result');
    return kind === 'false' || error === original || error.cause === original;
  });
}
console.log('Backend disposal retains original failure observations, idempotent outcomes and independent cleanup.');
