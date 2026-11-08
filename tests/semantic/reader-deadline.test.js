import assert from 'node:assert/strict';
import { semanticReadDeadlineFailure } from '../../src/semantic/reader-lifetime.js';
import { createAbortError, throwIfAborted } from '../../src/shared/abort.js';

// Exact attribution and original-observation controls; no timers, native work,
// provider execution or larger deadlines are needed for this pure projection.
const deadline = new AbortController(), reason = new Error('actual read deadline'); deadline.abort(reason);
let limits = 0;
const project = (error, signal = null) => semanticReadDeadlineFailure(error, { signal, deadline: deadline.signal,
  createLimitError: () => { limits++; return Object.assign(new Error('read work bound'), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' }); } });
let cancelled;
try { throwIfAborted(deadline.signal); } catch (error) { cancelled = error; }
assert.equal(project(cancelled).code, 'ERR_SEMANTIC_OUTPUT_LIMIT'); assert.equal(project(reason).code, 'ERR_SEMANTIC_OUTPUT_LIMIT');
assert.equal(limits, 2);
const unrelated = createAbortError('independent library cancellation'); assert.equal(project(unrelated), unrelated);
for (const value of [0, false, null, undefined]) assert.equal(project(value), value);
const caller = new AbortController(); caller.abort(0); assert.equal(project(cancelled, caller.signal), cancelled); assert.equal(limits, 2);
let ready = false, names = 0;
const original = Object.defineProperties(new Error('native work remains pending'), {
  cacheOwnershipReleased: { value: function () { assert.equal(this, original); return ready; } },
  name: { get() { names++; return 'AbortError'; } }, cause: { value: reason }
});
const held = project(original); assert.equal(held.cacheOwnershipReleased(), false); assert.equal(names, 0, 'pending native work is observed before diagnostic getters');
assert.equal(limits, 2); ready = true; assert.equal(held.cacheOwnershipReleased(), true);
assert.equal(project(original).code, 'ERR_SEMANTIC_OUTPUT_LIMIT'); assert.equal(names, 1);
let inspectionReady = false;
const inspection = Object.freeze({ cacheOwnershipReleased() { return inspectionReady; }, cause: 0 });
const badMetadata = Object.defineProperty(new Error('metadata inspection failed'), 'cause', { get() { throw inspection; } });
const retained = project(badMetadata); assert.equal(retained.cacheOwnershipReleased(), false);
inspectionReady = true; assert.equal(retained.cacheOwnershipReleased(), true);
assert.equal(limits, 3, 'an inspection failure is never attributed to the coincident deadline');
console.log('Read deadlines require their actual reason and preserve original native and inspection ownership.');
