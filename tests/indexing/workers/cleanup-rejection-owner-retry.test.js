import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createWorkerPoolLifecycle } from '../../../src/index/build/workers/pool/lifecycle.js';
import { IndexerProcessPool, createProcessMemoryAccount } from '../../../src/index/build/workers/process-pool.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const rejectedWith = async (promise, wanted) => {
  let rejected = false;
  await promise.then(() => {}, error => { rejected = true; assert.equal(error, wanted); });
  assert.equal(rejected, true, 'even a falsey original throw remains a rejected cleanup');
};
for (const failure of [Object.freeze(new Error('original non-timeout destroy rejection')), null, false, 0, '']) {
  for (const mode of ['destroy', 'forceDestroy', 'waiting-destroy']) {
    let creates = 0, destroys = 0, active = mode === 'waiting-destroy' ? 1 : 0;
    const finish = gate(), entered = gate(); let reject = true;
    const pool = { async destroy() { destroys++; entered.resolve(); await finish.promise; if (reject) throw failure; } };
    const owner = createWorkerPoolLifecycle({ createPool: () => { creates++; return pool; }, getActiveTasks: () => active,
      summarizeError: () => { throw new Error('hostile non-authoritative diagnostic'); } });
    owner.initialize();
    const first = mode === 'forceDestroy' ? owner.forceDestroy() : owner.destroy();
    const failed = rejectedWith(first, failure);
    let drained;
    if (active) { active = 0; drained = owner.handleTaskDrained(); drained.catch(() => {}); }
    await entered.promise;
    assert.equal(owner.getPool(), pool); assert.throws(() => owner.initialize(), /ownership/);
    const concurrent = mode === 'forceDestroy' ? owner.forceDestroy() : owner.destroy();
    const concurrentFailure = rejectedWith(concurrent, failure);
    await tick(); assert.equal(destroys, 1); assert.equal(creates, 1);
    finish.resolve(); await Promise.all([failed, concurrentFailure]);
    if (drained) await rejectedWith(drained, failure);
    assert.equal(owner.getPool(), pool, 'failed teardown retains the exact original cleanup handle');
    reject = false;
    await owner.forceDestroy(); await owner.destroy(); await owner.forceDestroy();
    assert.equal(destroys, 2); assert.equal(creates, 1); assert.equal(owner.getPool(), null);
  }
}

// Production process-pool destroy with controlled stop owners: partial success
// cannot lend the original aggregate capacity before the last close settles.
const account = createProcessMemoryAccount(process.memoryUsage().rss + 64 * 1024 ** 2);
const initial = account.stats().reservedBytes;
const release = account.reserve(32 * 1024 ** 2);
const closed = new Set(), finish = gate(), entered = gate();
const first = {}, second = {}; let failures = true, releases = 0, attempts = 0;
const pool = Object.create(IndexerProcessPool.prototype);
Object.assign(pool, { closed: false, pending: [], children: new Set([first, second]), metrics: {}, destroying: null,
  capacityReleased: false, releaseCapacity: () => { releases++; release(); }, initialization: Buffer.from('owned'), workerData: {} });
pool.stop = async slot => {
  attempts++;
  if (slot === second && failures) { entered.resolve(); await finish.promise; throw new Error('original process termination unconfirmed'); }
  closed.add(slot); pool.children.delete(slot);
};
const destroying = pool.destroy(), again = pool.destroy();
assert.equal(destroying, again);
const failed = assert.rejects(destroying, error => error instanceof AggregateError
  && error.errors[0].message === 'original process termination unconfirmed');
await entered.promise; await tick();
assert.equal(closed.has(first), true); assert.equal(closed.has(second), false);
assert.equal(account.stats().reservedBytes, initial + 32 * 1024 ** 2); assert.equal(releases, 0);
assert.throws(() => account.reserve(64 * 1024 ** 2), { code: 'ERR_PROCESS_TASK_BUDGET' });
finish.resolve(); await failed;
assert.equal(pool.destroying, null); assert.equal(pool.children.has(second), true);
failures = false; await pool.destroy(); await pool.destroy();
assert.equal(attempts, 3); assert.equal(releases, 1); assert.equal(account.stats().reservedBytes, initial);
assert.equal(pool.initialization, null); assert.equal(pool.workerData, null);
console.log('Original non-timeout/falsey teardown failures retain their handles, waiters and exact capacity until confirmed retry.');
