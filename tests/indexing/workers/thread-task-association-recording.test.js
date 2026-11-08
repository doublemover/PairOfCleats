import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate as tick } from 'node:timers/promises';
import { createIndexerThreadPool } from '../../../src/index/build/workers/thread-pool.js';
import { createThreadTaskAssociation, PISCINA_TASK_ASSOCIATION_DEPENDENCY } from '../../../src/index/build/workers/thread-task-association.js';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const abortError = () => Object.assign(new Error('original recorded abort'), { name: 'AbortError', code: 'ABORT_ERR' });
class RecordingPiscina extends EventEmitter {
  static version = PISCINA_TASK_ASSOCIATION_DEPENDENCY;
  static queueOptionsSymbol = Symbol('documented queue metadata');
  constructor(options) {
    super(); this.options = options; this.queueSize = 0; this.completed = 0;
    this.original = new EventEmitter(); this.original.threadId = 41;
    this.sibling = new EventEmitter(); this.sibling.threadId = 42;
    this.threads = [this.original, this.sibling]; this.tasks = []; this.originalExit = deferred();
    this.original.terminate = async () => { await this.originalExit.promise; this.original.emit('exit', 1); };
    this.sibling.terminate = async () => { this.sibling.emit('exit', 0); };
  }
  run(payload, options = {}) {
    if (options.signal?.aborted) return Promise.reject(abortError());
    const task = { payload, signal: options.signal, owner: null, complete: null };
    const promise = new Promise((resolve, reject) => {
      task.complete = value => { task.settled = true; this.completed++; resolve(value); };
      const worker = this.options.loadBalancer({ isAbortable: Boolean(options.signal),
        [RecordingPiscina.queueOptionsSymbol]: payload[RecordingPiscina.queueOptionsSymbol] },
      this.threads.map(owner => ({ id: owner.threadId, currentUsage: this.tasks.some(row => !row.settled && row.owner === owner) ? 1 : 0 })));
      if (worker) task.owner = this.threads.find(owner => owner.threadId === worker.id);
      else this.queueSize++;
      options.signal?.addEventListener('abort', () => {
        task.settled = true; task.failure = abortError(); reject(task.failure);
        if (!task.owner) { this.queueSize--; return; }
        this.threads = this.threads.filter(owner => owner !== task.owner);
        this.emit('workerDestroy', { id: task.owner.threadId });
        void task.owner.terminate();
      }, { once: true });
    });
    this.tasks.push(task); return promise;
  }
  async destroy() {
    this.originalExit.resolve();
    await Promise.all(this.threads.map(owner => owner.terminate()));
    this.threads = [];
  }
}

assert.throws(() => createThreadTaskAssociation({ version: 'future-unqualified', queueOptionsSymbol: Symbol() }), { code: 'ERR_WORKER_TASK_ASSOCIATION_UNSUPPORTED' });
assert.throws(() => createThreadTaskAssociation({ version: RecordingPiscina.version, queueOptionsSymbol: 'not-symbol' }), { code: 'ERR_WORKER_TASK_ASSOCIATION_UNSUPPORTED' });
assert.throws(() => createIndexerThreadPool(RecordingPiscina, { concurrentTasksPerWorker: 2 }), /single-task/);
{
  const symbol = RecordingPiscina.queueOptionsSymbol;
  const association = createThreadTaskAssociation({ version: RecordingPiscina.version, queueOptionsSymbol: symbol });
  const assigned = [], prepared = association.prepare({ value: 'exact payload' }, id => assigned.push(id));
  const task = { isAbortable: true, [symbol]: prepared.payload[symbol] };
  const busy = { id: 1, currentUsage: 1 }, idle = { id: 2, currentUsage: 0 };
  assert.equal(association.loadBalancer(task, [busy]), null); assert.deepEqual(assigned, []);
  assert.equal(association.loadBalancer(task, [busy, idle]), idle, 'return the actual public Worker interface, preserving Piscina dispatch authority');
  assert.deepEqual(assigned, [2]);
  assert.throws(() => association.loadBalancer({ [symbol]: { version: 1 } }, [idle]), { code: 'ERR_WORKER_TASK_ASSOCIATION_REQUIRED' });
  prepared.release();
  assert.throws(() => association.loadBalancer(task, [idle]), { code: 'ERR_WORKER_TASK_ASSOCIATION_REQUIRED' });
}
const pool = createIndexerThreadPool(RecordingPiscina, { minThreads: 0, maxThreads: 2 });
const raw = pool.pool;
const scheduler = createBuildScheduler({ cpuTokens: 1, memoryTokens: 1, maxInFlightBytes: 100 });
const controller = new AbortController();
let failure, publicSettled = false, peerStarted = false;
try {
  const first = scheduler.schedule('original', { cpu: 1, mem: 1, bytes: 100 }, async () => {
    const operation = pool.run({ tag: 'original' }, { signal: controller.signal });
    return operation.catch(error => { failure = error; throw error; });
  }).finally(() => { publicSettled = true; });
  const failed = assert.rejects(first, error => error === failure && error.name === 'AbortError');
  await tick();
  assert.equal(raw.tasks[0].owner, raw.original, 'public balancer associates exactly the first idle Worker');
  controller.abort(); await tick();
  assert.equal(failure, raw.tasks[0].failure, 'extensible original AbortError identity survives');
  assert.equal(failure.workerOwnershipReleased(), false); assert.equal(failure.workerOwnershipPending, true);
  assert.equal(publicSettled, false);
  assert.equal(pool.fatal, null, 'ordinary cancellation never poisons a healthy generation');
  const peer = scheduler.schedule('peer', { cpu: 1, mem: 1, bytes: 100 }, () => { peerStarted = true; });
  await tick(); assert.equal(peerStarted, false);
  assert.equal(scheduler.stats().tokens.cpu.used, 1);
  assert.equal(scheduler.stats().tokens.mem.used, 1);
  assert.equal(scheduler.stats().activity.inFlightBytes, 100);
  // An unrelated healthy original Worker never needs to exit for this abort.
  assert.equal(raw.sibling.listenerCount('exit') > 0, true);
  raw.originalExit.resolve(); await failure.workerSettlement; await failed; await peer;
  raw.original.emit('exit', 1); raw.emit('workerDestroy', { id: 41 });
  assert.equal(scheduler.stats().tokens.cpu.used, 0, 'duplicate late lifecycle observations cannot release a reservation twice');
  assert.equal(failure.workerOwnershipReleased(), true); assert.equal(pool.threads.includes(raw.sibling), true);
  const healthy = pool.run({ tag: 'healthy sibling' }); raw.tasks.at(-1).complete('healthy'); assert.equal(await healthy, 'healthy');
  const before = raw.tasks.length, pre = new AbortController(); pre.abort();
  await assert.rejects(pool.run({ tag: 'pre-aborted' }, { signal: pre.signal }), error => error.name === 'AbortError' && !Object.hasOwn(error, 'workerSettlement'));
  assert.equal(raw.tasks.length, before, 'pre-abort never invokes the balancer or assigns physical ownership');
  // Occupy the only remaining healthy worker, then abort a queued task.
  const held = pool.run({ tag: 'held sibling' });
  const queuedController = new AbortController();
  const queued = pool.run({ tag: 'queued' }, { signal: queuedController.signal });
  assert.equal(raw.tasks.at(-1).owner, null);
  queuedController.abort();
  await assert.rejects(queued, error => error.name === 'AbortError' && !Object.hasOwn(error, 'workerSettlement'));
  raw.tasks.at(-2).complete('finished'); await held;
  assert.equal(pool.fatal, null); assert.equal(scheduler.stats().activity.inFlightBytes, 0);
} finally { raw.originalExit.resolve(); await pool.destroy(); await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 }); }
console.log('Public task metadata associates only the canceled original Worker and retains scheduler resources through its exit.');
