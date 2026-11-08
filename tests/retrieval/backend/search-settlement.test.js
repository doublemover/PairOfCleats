import assert from 'node:assert/strict';
import { createSearchSettlement } from '../../../src/retrieval/cli/search-settlement.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

for (const primary of [false, null, undefined, 0, Object.freeze(Error('frozen work'))]) {
  const cleanup = Object.freeze(Error('original cleanup'));
  let closes = 0, siblings = 0;
  const owner = createSearchSettlement({ dispose: () => { closes++; throw cleanup; }, after: [() => { siblings++; }] });
  owner.captureFailure(primary);
  let failure;
  await assert.rejects(owner.settle(), error => { failure = error; return true; });
  assert.ok(errorGraphIncludes(failure, primary)); assert.ok(errorGraphIncludes(failure, cleanup));
  await assert.rejects(owner.settle()); assert.equal(closes, 1); assert.equal(siblings, 1);
}
let originalReleased = false, observer = () => originalReleased, calls = 0;
const original = Object.defineProperty(Error('original pending'), 'cacheOwnershipReleased', { get: () => observer });
const owner = createSearchSettlement({ dispose: () => { calls++; throw original; },
  after: [() => { observer = () => true; }, () => { throw false; }] });
let failure;
await assert.rejects(owner.beforePublish(), error => { failure = error; return true; });
assert.equal(failure.cacheOwnershipReleased(), false);
owner.captureFailure(failure);
await assert.rejects(owner.settle(), error => error === failure);
assert.equal(calls, 1);
originalReleased = true; assert.equal(failure.cacheOwnershipReleased(), true);
const events = [];
const healthy = createSearchSettlement({ dispose: async () => { events.push('close'); },
  after: [() => { events.push('report'); }, () => { events.push('cache'); }] });
assert.equal(healthy.beforePublish(), healthy.beforePublish());
await healthy.beforePublish(); await healthy.settle();
assert.deepEqual(events, ['close', 'report', 'cache']);
console.log('Search settlement retains primary and cleanup failures, captured observers, sibling work and one completion');
