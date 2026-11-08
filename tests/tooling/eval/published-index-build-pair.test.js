import assert from 'node:assert/strict';
import { settleIndexBuildPair } from '../../../tools/eval/revisions/index-build-pair.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
const first = Object.freeze(new Error('original first build failed'));
const second = Object.freeze(new Error('original second build failed'));
const left = Promise.withResolvers(), right = Promise.withResolvers();
let started = 0, settled = false;
const joined = settleIndexBuildPair(() => { started++; return left.promise; }, () => { started++; return right.promise; });
joined.then(() => { settled = true; }, () => { settled = true; });
await turn(); assert.equal(started, 2);
left.reject(first); await turn();
assert.equal(settled, false, 'a fast failure cannot release the other original build');
right.reject(second);
await assert.rejects(joined, error => error.cause === first && errorGraphIncludes(error, first) && errorGraphIncludes(error, second));

const pending = { cacheOwnershipPending: true, cacheOwnershipReleased: () => false };
const values = await settleIndexBuildPair(() => pending, async () => 'rebuild');
assert.equal(values[0], pending); assert.equal(values[1], 'rebuild');
assert.equal(values[0].cacheOwnershipReleased(), false, 'promise settlement grants no resource release authority');
for (const value of [null, false, 0, undefined]) {
  let actual = Symbol('unobserved');
  try { await settleIndexBuildPair(() => { throw value; }, async () => 'settled'); } catch (error) { actual = error; }
  assert.equal(actual, value, 'a sole falsey original failure is preserved');
  await assert.rejects(settleIndexBuildPair(() => { throw first; }, () => { throw value; }),
    error => errorGraphIncludes(error, first) && errorGraphIncludes(error, value));
}
let calls = 0;
await assert.rejects(settleIndexBuildPair(null, () => { calls++; }), TypeError);
assert.equal(calls, 0, 'invalid work is rejected before either operation starts');
console.log('Paired original index builds join before failure/retirement and preserve falsey failures and resource observations.');
