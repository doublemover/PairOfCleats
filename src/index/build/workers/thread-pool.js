import { EventEmitter } from 'node:events';
import { MessagePort } from 'node:worker_threads';
import { currentSchedulerTaskLease } from '../../../shared/concurrency/scheduler-task-scope.js';
import { createWorkerFatalError, isWorkerFatalControl } from './fatal-policy.js';
import { readWorkerObservation, WORKER_OBSERVATION_VERSION } from './observation.js';

const observe = (target, event, value) => {
  // Logging/metric listeners cannot alter task outcomes or terminal retirement.
  for (const listener of target.rawListeners(event)) { try { listener.call(target, value); } catch { /* best effort */ } }
};

/** Preserve original worker handles through exit, including those removed by Piscina on error.
 * A fatal isolate poisons this pool generation; outstanding tasks reject once,
 * and their scheduler ownership stays attached to all original worker exits.
 */
export class IndexerThreadPool extends EventEmitter {
  constructor(pool) {
    super();
    this.pool = pool;
    this.owners = new Map();
    this.pending = new Set();
    this.closed = false;
    this.fatal = null;
    this.destroying = null;
    this.announced = new WeakSet();
    this.observeWorkers();
    pool.on('workerCreate', () => this.observeWorkers(true));
    pool.on('workerDestroy', record => {
      for (const owner of this.owners.values()) if (owner.id === record.id) owner.retiring = true;
    });
    queueMicrotask(() => this.observeWorkers(true));
    pool.on('message', message => {
      this.observeWorkers();
      if (message?.type === 'indexer-observation-port') {
        this.adoptObservationPort(message); return;
      }
      if (isWorkerFatalControl(message)) {
        if ([...this.owners.values()].some(owner => owner.id === message.threadId)) this.poison(message.reason);
        return;
      }
      const event = readWorkerObservation(message);
      if (event) {
        if (!this.fatal) observe(this, 'message', event);
      }
    });
    pool.on('error', error => { this.poison('thread runtime error'); observe(this, 'error', error); });
  }

  get options() { return this.pool.options; }
  get queueSize() { return this.pool.queueSize; }
  get threads() { return [...this.owners.keys()]; }
  get completed() { return this.pool.completed; }

  adoptObservationPort(message) {
    const port = message.port;
    if (!(port instanceof MessagePort)) return;
    const [worker, owner] = [...this.owners.entries()].find(([, value]) => value.id === message.threadId) || [];
    if (!owner || owner.observationPort || this.closed || this.fatal || message.version !== WORKER_OBSERVATION_VERSION) {
      port.close(); return;
    }
    owner.observationPort = port;
    port.on('message', frame => {
      const event = readWorkerObservation(frame);
      if (!event || event.threadId !== owner.id || this.owners.get(worker) !== owner) return;
      try { port.postMessage({ type: 'worker-observation-ack', version: WORKER_OBSERVATION_VERSION, sequence: event.sequence }); }
      catch { /* observations cannot change task settlement */ }
      if (!this.fatal && !this.closed) observe(this, 'message', event);
    });
    port.on('messageerror', () => port.close());
    port.unref();
  }
  get maxThreads() { return this.pool.maxThreads; }
  get minThreads() { return this.pool.minThreads; }

  observeWorkers(announce = false) {
    for (const worker of this.pool.threads) {
      if (announce && !this.announced.has(worker)) {
        this.announced.add(worker); observe(this, 'workerCreate', worker);
      }
      if (this.owners.has(worker)) continue;
      let finish;
      const owner = { id: worker.threadId, exited: new Promise(resolve => { finish = resolve; }) };
      this.owners.set(worker, owner);
      // Prepend before Piscina's handler can reject a task or remove the handle.
      worker.prependListener('error', () => { if (!owner.retiring) this.poison('uncaught thread error'); });
      worker.prependOnceListener('exit', code => {
        if (!owner.retiring && !this.closed) this.poison(`unexpected thread exit (${code})`);
        owner.observationPort?.close();
        this.owners.delete(worker); finish();
      });
      if (this.closed) void worker.terminate().catch(error => observe(this, 'error', error));
    }
  }

  poison(reason) {
    if (this.fatal || this.closed) return;
    this.closed = true;
    const error = createWorkerFatalError(reason);
    const originals = [...this.owners.values()];
    let released = false;
    const settlement = Promise.all(originals.map(owner => owner.exited)).then(() => { released = true; });
    Object.defineProperties(error, {
      workerOwnershipPending: { get: () => !released },
      workerOwnershipReleased: { value: () => released },
      workerSettlement: { value: settlement }
    });
    this.fatal = error;
    // Ineligibility and request settlement precede diagnostics/destruction.
    for (const task of this.pending) task.rejectFatal(error);
    // Start shutdown before a subscriber can run arbitrary lifecycle code.
    const destroying = this.destroy();
    observe(this, 'fatal', error);
    void destroying.catch(failure => observe(this, 'error', failure));
  }

  run(payload, options) {
    // Piscina permits explicit reuse after a confirmed ordinary destroy. Fatal
    // generations and uncertain destruction remain terminal/ineligible.
    if (this.closed && !this.fatal && this.destroyed) {
      this.closed = false; this.destroyed = false; this.destroying = null;
    }
    if (this.closed) return Promise.reject(this.fatal || createWorkerFatalError('pool closed'));
    this.observeWorkers();
    let rejectFatal;
    const fatal = new Promise((_, reject) => { rejectFatal = reject; });
    const task = { rejectFatal };
    this.pending.add(task);
    const lease = currentSchedulerTaskLease();
    let operation;
    try { operation = this.pool.run(payload, options); }
    catch (error) { operation = Promise.reject(error); }
    this.observeWorkers();
    return Promise.race([operation, fatal]).then(value => {
      if (this.fatal) throw this.fatal;
      return value;
    }).catch(error => {
      if (this.fatal) {
        lease?.trackWait?.(() => this.fatal.workerSettlement, { retainCpu: true }).catch(() => {});
        throw this.fatal;
      }
      throw error;
    }).finally(() => { this.pending.delete(task); });
  }

  destroy() {
    if (!this.destroying) {
      this.closed = true;
      const originalOwners = [...this.owners.values()];
      // Start destruction synchronously, before Piscina's later error handler
      // can replace a failed worker. Its public destructor owns queue teardown.
      let originalDestroy;
      try { originalDestroy = this.pool.destroy(); }
      catch (error) { originalDestroy = Promise.reject(error); }
      // The enclosing lifecycle owns the single bounded destroy/termination
      // fallback. Retained threads stay visible to that original owner.
      this.destroying = Promise.resolve(originalDestroy)
        .then(() => Promise.all(originalOwners.map(owner => owner.exited)))
        .then(() => { this.destroyed = true; })
        .catch(error => { this.destroying = null; throw error; });
    }
    return this.destroying;
  }
}
