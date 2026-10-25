import assert from 'node:assert/strict';
import { createWatchSourceObservations, watchObservationFailure } from '../../../src/index/build/watch/source-observations.js';
import { createObservationClock } from './observation-clock.js';

const clock = createObservationClock(), retries = [], receipts = [];
const owner = createWatchSourceObservations({ ...clock,
  onRetry: file => retries.push(file), onFailure: (_error, file, receipt) => receipts.push({ file, ...receipt }) });
const fail = code => async () => { throw Object.assign(new Error(code), { code }); };
for (let attempt = 1; attempt <= 12; attempt++) {
  assert.equal(await owner.observe('src/a.js', fail(attempt % 2 ? 'EACCES' : 'EMFILE')), null);
  const delay = Math.min(5000, 50 * 2 ** Math.min(attempt - 1, 10));
  assert.equal(receipts.at(-1).attempt, attempt);
  assert.equal(receipts.at(-1).retryAt, clock.now() + delay);
  assert.equal(clock.pending(), 1);
  clock.advance(delay - 1);
  assert.equal(retries.length, attempt - 1, 'retry must not spin before its due time');
  clock.advance(1);
  assert.equal(retries.length, attempt);
  assert.equal(owner.pendingCount(), 1, 'a timer firing is not a successful observation');
}
const included = { skip: false, relPosix: 'src/a.js' };
assert.equal(await owner.observe('src/a.js', async () => included), included);
assert.equal(owner.pendingCount(), 0);
assert.equal(clock.pending(), 0);

await owner.observe('src/unstable.js', async () => ({ state: 'unknown', code: 'ERR_WATCH_SOURCE_UNSTABLE' }));
assert.equal(owner.stabilityRetryCount(), 1);
await owner.observe('src/unstable.js', fail('EIO'));
assert.equal(owner.stabilityRetryCount(), 0, 'stability failures share one retry owner with later I/O failures');
owner.remove('src/unstable.js');

await owner.observe('src/a.js', fail('ENOENT'));
assert.equal(owner.pendingCount(), 1, 'one missing observation may be an atomic-save gap');
owner.invalidate('src/a.js');
await owner.observe('src/a.js', fail('ENOENT'));
assert.equal(owner.pendingCount(), 1, 'a new event resets consecutive absence evidence');
clock.advance(5000);
assert.deepEqual(await owner.observe('src/a.js', fail('ENOTDIR')),
  { skip: true, state: 'absent', reason: 'missing', code: 'ENOTDIR' });

let release;
const gated = owner.observe('src/gated.js', () => new Promise(resolve => { release = resolve; }));
owner.remove('src/gated.js');
release(included);
assert.equal(await gated, null, 'late observation cannot resurrect an unlinked path');
for (let i = 0; i < 20; i++) await owner.observe(`src/${i}.js`, fail('EIO'));
assert.equal(owner.snapshot().pending, 20);
assert.equal(owner.snapshot().failures.length, 16, 'diagnostics stay bounded independently of backlog');
owner.close();
assert.equal(clock.pending(), 0);
assert.equal(owner.pendingCount(), 20, 'shutdown cancels timers without retiring unresolved work');
const priorRetries = retries.length;
clock.advance(100000);
assert.equal(retries.length, priorRetries);
assert.equal(await owner.observe('src/new.js', async () => included), null);

const original = Object.freeze(Object.assign(new Error('native owner pending'), {
  cacheOwnershipPending: true, cacheOwnershipReleased: () => false
}));
assert.throws(() => watchObservationFailure(original), error => error.cacheOwnershipPending === true
  && error.cacheOwnershipReleased() === false, 'pending ownership cannot become a retryable I/O observation');
const inspection = new Error('code inspection failed');
assert.throws(() => watchObservationFailure(Object.defineProperty(new Error('original'), 'code', {
  get() { throw inspection; }
})), error => error.cacheOwnershipPending === true);
assert.throws(() => watchObservationFailure(Object.assign(new Error('cancelled'), { code: 'ABORT_ERR' })),
  { code: 'ABORT_ERR' });
console.log('watch source observation owner test passed');
