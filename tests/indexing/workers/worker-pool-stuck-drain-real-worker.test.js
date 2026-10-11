import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import Piscina from 'piscina';
import { createWorkerPoolLifecycle } from '../../../src/index/build/workers/pool/lifecycle.js';
import { destroyWorkerPoolLifecycleWithTimeout } from '../../../src/index/build/workers/pool.js';

let active = 0;
let pool;
const lifecycle = createWorkerPoolLifecycle({
  poolLabel: 'real-stuck-drain', cleanupTimeoutMs: 100,
  getActiveTasks: () => active,
  createPool: () => {
    pool = new Piscina({ filename: fileURLToPath(new URL('./stuck-drain-worker-fixture.js', import.meta.url)), minThreads: 1, maxThreads: 1 });
    return pool;
  }, log: () => {}
});
lifecycle.initialize();
const started = new SharedArrayBuffer(4);
active += 1;
const task = pool.run({ started }).finally(async () => {
  active -= 1;
  await lifecycle.handleTaskDrained();
});
const rejected = assert.rejects(task);
try {
  const deadline = Date.now() + 5000;
  while (Atomics.load(new Int32Array(started), 0) !== 1 && Date.now() < deadline) await sleep(5);
  assert.equal(Atomics.load(new Int32Array(started), 0), 1, 'fixture worker must actually be executing');
  const result = await destroyWorkerPoolLifecycleWithTimeout({ lifecycle, timeoutMs: 20, log: () => {} });
  await rejected;
  assert.equal(result.forced, true);
  assert.equal(result.pending, false);
  assert.equal(active, 0);
  assert.equal(pool.threads.length, 0, 'the real stuck worker must be terminated');
  assert.equal(lifecycle.getPool(), null);
  assert.equal(lifecycle.isPermanentlyDisabled(), true);
} finally {
  await lifecycle.forceDestroy();
}
console.log('real Piscina active-task hang: graceful deadline escalates and leaves zero pool threads');
