import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate as tick } from 'node:timers/promises';
import { IndexerThreadPool } from '../../../src/index/build/workers/thread-pool.js';
import { createWorkerProcessCoordinator } from '../../../src/index/build/workers/pool/worker-coordination.js';
import { createWorkerPoolLifecycle } from '../../../src/index/build/workers/pool/lifecycle.js';

const deferred = () => { let resolve; const promise = new Promise(finish => { resolve = finish; }); return { promise, resolve }; };
for (const mode of ['active', 'idle', 'error', 'clean-unexpected-exit', 'failed-stop', 'shutdown']) {
  const raw = new EventEmitter(), worker = new EventEmitter(), result = deferred(), exit = deferred();
  let calls = 0, destroys = 0, allowStop = mode !== 'failed-stop';
  worker.threadId = 41;
  worker.terminate = async () => { await exit.promise; worker.emit('exit', 1); };
  raw.threads = [worker]; raw.options = { maxThreads: 1 }; raw.queueSize = 0;
  raw.run = () => { calls++; return result.promise; };
  raw.destroy = async () => {
    destroys++; raw.threads = [];
    if (!allowStop) throw new Error('Original termination not confirmed.');
    await worker.terminate();
  };
  const pool = new IndexerThreadPool(raw);
  const errors = []; pool.on('error', error => errors.push(error));
  pool.on('fatal', () => { throw new Error('Broken terminal logger.'); });
  let task = null, settlements = 0, failure;
  try {
    if (mode !== 'idle') {
      task = pool.run({}, { name: 'run' });
      task.then(() => { settlements++; }, () => { settlements++; });
    }
    if (mode === 'shutdown') {
      const destroying = pool.destroy();
      raw.emit('message', { type: 'worker-fatal', version: 1, threadId: 41, reason: 'uncaughtException' });
      exit.resolve(); result.resolve('already owned shutdown'); await destroying; await task;
      assert.equal(destroys, 1, 'fatal during an owned shutdown does not create a competing destructor');
      continue;
    }
    if (mode === 'clean-unexpected-exit') worker.emit('exit', 0);
    else if (mode === 'error') worker.emit('error', new Error('raw thread failure'));
    else raw.emit('message', { type: 'worker-fatal', version: 1, threadId: 41, reason: 'uncaughtException' });
    if (task) await assert.rejects(task, error => { failure = error; return error.code === 'ERR_WORKER_FATAL'; });
    else failure = pool.fatal;
    assert.equal(failure.workerOwnershipPending, mode !== 'clean-unexpected-exit');
    assert.equal(pool.threads.length, mode === 'clean-unexpected-exit' ? 0 : 1, 'removed vendor inventory is not release authority');
    await assert.rejects(pool.run({}, { name: 'run' }), error => error === failure);
    assert.equal(calls, task ? 1 : 0, 'poisoned generation never receives another dispatch');
    result.resolve('late clean result'); await tick();
    assert.equal(settlements, task ? 1 : 0, 'late result cannot settle a rejected request again');
    assert.equal(failure.workerOwnershipReleased(), mode === 'clean-unexpected-exit');
    if (mode === 'failed-stop') {
      assert.equal(errors.length > 0, true);
      assert.equal(pool.threads.length, 1);
      allowStop = true;
    }
    exit.resolve(); await pool.destroy(); await failure.workerSettlement;
    assert.equal(failure.workerOwnershipReleased(), true); assert.equal(pool.threads.length, 0);
    assert.equal(destroys, mode === 'failed-stop' ? 2 : 1);
  } finally { allowStop = true; exit.resolve(); await pool.destroy(); }
}

{
  const raw = new EventEmitter(), worker = new EventEmitter();
  worker.threadId = 53; raw.threads = [worker]; raw.options = {};
  raw.run = async () => 'healthy future work'; raw.destroy = async () => {};
  const pool = new IndexerThreadPool(raw);
  raw.emit('workerDestroy', { id: 53 }); raw.threads = [];
  worker.emit('exit', 1);
  assert.equal(pool.fatal, null, 'intentional idle/abort retirement is not an unexpected runtime death');
  assert.equal(await pool.run({}, { name: 'run' }), 'healthy future work');
  await pool.destroy();
}

// The existing lifecycle must start its one bounded destructor despite active
// counters; those counters themselves await the original exit settlement.
{
  const raw = new EventEmitter(), worker = new EventEmitter(), exit = deferred();
  let destroys = 0, active = 1, recovery;
  worker.threadId = 67; worker.terminate = async () => { await exit.promise; worker.emit('exit', 1); };
  raw.threads = [worker]; raw.options = {}; raw.run = () => new Promise(() => {});
  raw.destroy = async () => { destroys++; raw.threads = []; await worker.terminate(); };
  const adapter = new IndexerThreadPool(raw);
  const lifecycle = createWorkerPoolLifecycle({ createPool: () => adapter, getActiveTasks: () => active,
    cleanupTimeoutMs: 1000, restartBaseDelayMs: 10000 });
  lifecycle.initialize();
  adapter.on('fatal', () => { recovery = lifecycle.scheduleRestart('fatal fixture', { terminateActive: true, fatal: true }); });
  const task = adapter.run({}, { name: 'run' });
  adapter.poison('controlled lifecycle fatal');
  try {
    await assert.rejects(task, { code: 'ERR_WORKER_FATAL' }); await tick();
    assert.equal(lifecycle.isDisabled(), true); assert.equal(destroys, 1);
    assert.equal(active, 1, 'retained active dispatch does not deadlock fatal destruction');
    exit.resolve(); await recovery;
    assert.equal(lifecycle.getPool(), null);
  } finally { active = 0; exit.resolve(); await lifecycle.destroy(); }
}

{
  let created = 0;
  const lifecycle = createWorkerPoolLifecycle({ maxRestartAttempts: 1, restartBaseDelayMs: 0, restartMaxDelayMs: 0,
    createPool: () => { created++; return { destroy: async () => {}, threads: [] }; },
    log() { throw new Error('Broken lifecycle log'); }, incWorkerRetries() { throw new Error('Broken retry metric'); }
  });
  lifecycle.initialize();
  await lifecycle.scheduleRestart('first fatal', { terminateActive: true, fatal: true });
  assert.equal(await lifecycle.ensurePool(), true); assert.equal(created, 2);
  assert.equal(lifecycle.getRestartAttempts(), 0);
  assert.equal(lifecycle.getFatalRestartAttempts(), 1, 'constructing a replacement cannot erase a fatal storm');
  await lifecycle.scheduleRestart('second fatal', { terminateActive: true, fatal: true });
  assert.equal(await lifecycle.ensurePool(), false);
  assert.equal(lifecycle.isPermanentlyDisabled(), true); assert.equal(created, 2);
  await lifecycle.destroy();
}

// The coordinator accepts both actual ChildProcess PID and Worker thread ID.
for (const key of ['pid', 'threadId']) {
  const pool = new EventEmitter(), worker = new EventEmitter(); worker[key] = 83;
  pool.threads = [{ threadId: 83 }];
  const coordinator = createWorkerProcessCoordinator({ onRuntimeObservation() {} });
  coordinator.attachPoolListeners(pool); pool.emit('workerCreate', worker);
  pool.emit('message', { type: 'worker-runtime', threadId: 83, observation: { pid: 83 } });
  assert.equal(coordinator.runtimeObservationStats(pool).length, 1);
  worker.emit('exit', 0);
  assert.equal(coordinator.runtimeObservationStats(pool).length, 0, `${key} exit retires its exact identity`);
}
console.log('Fatal ownership survives late results, idle failure, logger failure, vendor removal and failed termination.');
