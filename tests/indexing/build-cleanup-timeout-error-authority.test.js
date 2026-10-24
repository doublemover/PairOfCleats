import assert from 'node:assert/strict';
import { runBuildCleanupWithTimeout, isOwnedBuildCleanupTimeout } from '../../src/index/build/cleanup-timeout.js';

// UNVALIDATED: actual bounded timer owner, no native/process cleanup surfaces.
for (const value of [undefined, null, false, 0, '', Object.freeze({ code: 'BUILD_CLEANUP_TIMEOUT' })]) {
  let caught = false;
  try {
    await runBuildCleanupWithTimeout({ timeoutMs: 1000, cleanup() { throw value; }, swallowTimeout: true });
  } catch (error) { caught = true; assert.equal(error, value); }
  assert.equal(caught, true, 'an ordinary primary cannot be swallowed through a timeout-looking code');
}
let reads = 0;
const diagnostic = Object.freeze(new Error('unrelated diagnostic work'));
const primary = Object.freeze(Object.defineProperty({}, 'code', { get() { reads++; throw diagnostic; } }));
let caught = false;
try {
  await runBuildCleanupWithTimeout({ timeoutMs: 1000, cleanup() { throw primary; }, swallowTimeout: false });
} catch (error) { caught = true; assert.equal(error, primary); }
assert.equal(caught, true); assert.equal(reads, 0, 'classifying cleanup failure must not inspect an external code getter');

const owner = Object.freeze({}), sibling = Object.freeze({});
let settle;
const work = new Promise(resolve => { settle = resolve; });
try {
  const result = await runBuildCleanupWithTimeout({ timeoutMs: 5, cleanup: () => work,
    deadlineOwner: owner, swallowTimeout: true });
  assert.equal(result.timedOut, true); assert.equal(result.pending, true);
  assert.equal(isOwnedBuildCleanupTimeout(result.error, owner), true);
  assert.equal(isOwnedBuildCleanupTimeout(result.error, sibling), false);
  assert.equal(isOwnedBuildCleanupTimeout({ code: 'BUILD_CLEANUP_TIMEOUT' }, owner), false);
  assert.equal(result.error.cacheOwnershipReleased, undefined, 'generic timer cannot invent native settlement');
  let caughtSibling = false;
  try {
    await runBuildCleanupWithTimeout({ timeoutMs: 1000, deadlineOwner: owner,
      cleanup() { throw result.error; }, swallowTimeout: true });
  } catch (error) { caughtSibling = true; assert.equal(error, result.error); }
  assert.equal(caughtSibling, true, 'a genuine earlier timer error cannot impersonate this invocation deadline');
} finally { settle(); await work; }

const result = await runBuildCleanupWithTimeout({ timeoutMs: 1000, cleanup: async () => undefined, swallowTimeout: false });
assert.equal(result.timedOut, false); assert.equal(result.pending, false);
console.log('Actual cleanup timeout error identity and original primary controls authored; execution deferred.');
