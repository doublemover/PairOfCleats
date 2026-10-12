import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createWorkerPoolLifecycle } from '../../../src/index/build/workers/pool/lifecycle.js';
import { destroyWorkerPoolLifecycleWithTimeout } from '../../../src/index/build/workers/pool.js';

let destroyed = 0;
let terminated = 0;
let created = 0;
const lifecycle = createWorkerPoolLifecycle({
  poolLabel: 'stuck-drain', cleanupTimeoutMs: 20, getActiveTasks: () => 1,
  createPool: () => {
    created += 1;
    return {
      threads: [{ terminate: async () => { terminated += 1; } }],
      destroy: async () => { destroyed += 1; await new Promise(() => {}); }
    };
  }, log: () => {}
});
lifecycle.initialize();
const graceful = lifecycle.destroy();
const result = await destroyWorkerPoolLifecycleWithTimeout({ lifecycle, timeoutMs: 20, log: () => {} });
await graceful;
assert.equal(result.timedOut, true);
assert.equal(result.forced, true);
assert.equal(result.pending, false);
assert.equal(destroyed, 1, 'grace timeout must reach the existing Piscina cleanup owner');
assert.equal(terminated, 1, 'stuck pool destroy must reach existing hard thread termination');
assert.equal(lifecycle.getPool(), null);
await Promise.all([lifecycle.destroy(), lifecycle.forceDestroy(), lifecycle.handleTaskDrained()]);
assert.equal(destroyed, 1, 'escalation and ordinary drain remain idempotent');
assert.equal(terminated, 1);
assert.equal(created, 1, 'cleanup cannot resurrect a pool');
assert.equal(lifecycle.isPermanentlyDisabled(), true);

// A concurrent graceful drain and force request must both await the SAME
// detached pool shutdown, rather than seeing pool=null as completed cleanup.
let active = 1;
let releaseDestroy;
let finishDestroy;
const racing = createWorkerPoolLifecycle({ getActiveTasks: () => active,
  createPool: () => ({ destroy: () => new Promise(resolve => { releaseDestroy = resolve; }) }), log: () => {} });
racing.initialize();
const normal = racing.destroy();
active = 0;
const drained = racing.handleTaskDrained();
await sleep(1);
const forced = racing.forceDestroy().then(() => { finishDestroy = true; });
await sleep(1);
assert.equal(finishDestroy, undefined, 'detached pool shutdown must remain awaited');
releaseDestroy();
await Promise.all([normal, drained, forced]);
assert.equal(finishDestroy, true);
console.log('stuck active-worker drain reaches existing hard-stop cleanup; no duplicate destroy or restart');

const failing = createWorkerPoolLifecycle({ cleanupTimeoutMs: 10, getActiveTasks: () => 1,
  createPool: () => ({ destroy: () => new Promise(() => {}),
    threads: [{ terminate: async () => { throw new Error('cannot terminate'); } }] }) });
failing.initialize();
const failedGrace = assert.rejects(failing.destroy(), { code: 'PISCINA_FORCE_TERMINATE_INCOMPLETE' });
await assert.rejects(destroyWorkerPoolLifecycleWithTimeout({ lifecycle: failing, timeoutMs: 10, log: () => {} }),
  { code: 'PISCINA_FORCE_TERMINATE_INCOMPLETE' });
await failedGrace;
assert.equal(failing.isPermanentlyDisabled(), true);
