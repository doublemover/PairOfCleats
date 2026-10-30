import assert from 'node:assert/strict';
import { createBackendDisposer } from '../../../src/retrieval/cli/backend-disposal.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

for (const kind of ['return-pending', 'promise-pending', 'reject-pending', 'result-inspection']) {
  let released = false, sibling = 0, calls = 0;
  const original = Object.freeze(Object.assign(Error(`original-${kind}`), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => released
  }));
  const close = createBackendDisposer(new Set([() => {
    calls++;
    if (kind === 'return-pending') return original;
    if (kind === 'result-inspection') return Object.defineProperty({}, 'cacheOwnershipReleased', { get() { throw original; } });
    const invocation = kind === 'reject-pending' ? Promise.reject(false) : Promise.resolve();
    Object.defineProperties(invocation, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => released } });
    return invocation;
  }, () => { sibling++; }]));
  let failure;
  await assert.rejects(close(), error => { failure = error; return true; });
  assert.equal(sibling, 1); assert.equal(calls, 1);
  assert.equal(failure.cacheOwnershipReleased(), false);
  if (kind === 'reject-pending') assert.ok(errorGraphIncludes(failure, false));
  if (kind === 'return-pending' || kind === 'result-inspection') assert.ok(errorGraphIncludes(failure, original));
  released = true;
  assert.equal(failure.cacheOwnershipReleased(), kind !== 'result-inspection', 'an unreadable original observation cannot become closure proof');
  await assert.rejects(close(), error => error === failure);
  assert.equal(calls, 1); assert.equal(sibling, 1);
}
let calls = 0;
const settled = Object.freeze({ cacheOwnershipPending: true, cacheOwnershipReleased: () => true });
await createBackendDisposer(new Set([() => { calls++; return settled; }]))();
assert.equal(calls, 1);
console.log('Backend disposal preserves fulfilled and rejected original cleanup observations without replaying close');
