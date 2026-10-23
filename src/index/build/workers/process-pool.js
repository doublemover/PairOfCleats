import { EventEmitter } from 'node:events';
import { fork } from 'node:child_process';
import { serialize, deserialize } from 'node:v8';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createAbortError } from '../../../shared/abort.js';
import { killChildProcessTree } from '../../../shared/kill-tree.js';
import { estimateRetainedBytes, readEffectiveMemory } from '../../../shared/effective-memory.js';
import { FILE_ANALYSIS_MAX_OUTPUT_BYTES } from './file-analysis-contract.js';

const MB = 1024 * 1024;
const accounts = new WeakMap();
const budgetError = message => Object.assign(new Error(message), { code: 'ERR_PROCESS_TASK_BUDGET' });

export const createProcessMemoryAccount = (limitBytes) => {
  let reservedBytes = 0, peakReservedBytes = 0;
  const limit = Math.max(1, Math.floor(limitBytes));
  return {
    reserve(bytes) {
      const amount = Math.max(0, Math.ceil(bytes));
      if (reservedBytes + amount + process.memoryUsage().rss > limit) throw budgetError('Aggregate process/IPC memory budget exceeded.');
      reservedBytes += amount; peakReservedBytes = Math.max(peakReservedBytes, reservedBytes);
      let released = false;
      return () => { if (!released) { released = true; reservedBytes -= amount; } };
    },
    stats: () => ({ limitBytes: limit, reservedBytes, peakReservedBytes, parentRssBytes: process.memoryUsage().rss })
  };
};

export const getProcessMemoryAccount = (policy) => {
  if (policy && accounts.has(policy)) return accounts.get(policy);
  const account = createProcessMemoryAccount(policy?.maxGlobalRssMb
    ? policy.maxGlobalRssMb * MB : (policy?.effectiveMemory || readEffectiveMemory()).totalBytes * 0.9);
  if (policy) accounts.set(policy, account);
  return account;
};

/** Piscina-shaped transport; scheduler, task wrappers and restart/drain owners remain shared. */
export class IndexerProcessPool extends EventEmitter {
  constructor({ maxThreads = 1, oldSpaceMb = 128, workerData = {}, taskTimeout = 30000,
    budgetAccount = getProcessMemoryAccount(null), maxMessageBytes = 32 * MB,
    filename = fileURLToPath(new URL('./indexer-process-child.js', import.meta.url)),
    maxRestartAttempts = 3 } = {}) {
    super();
    this.options = { maxThreads, backend: 'process', oldSpaceMb };
    this.backend = 'process';
    this.maxThreads = Math.max(1, Math.floor(maxThreads));
    this.oldSpaceMb = Math.max(1, Math.floor(oldSpaceMb));
    this.generation = randomUUID();
    this.workerData = workerData;
    this.filename = filename;
    this.timeoutMs = Math.max(1, Math.floor(taskTimeout));
    this.maxMessageBytes = Math.max(4096, Math.floor(maxMessageBytes));
    this.maxRestartAttempts = maxRestartAttempts;
    this.account = budgetAccount;
    this.pending = [];
    this.children = new Set();
    this.nextTask = 0;
    this.closed = false;
    this.destroying = null;
    this.metrics = { started: 0, completed: 0, failed: 0, restarts: 0, peakChildren: 0,
      ipcReservedBytes: 0, peakIpcReservedBytes: 0, dictionaryCopyBytes: estimateRetainedBytes(workerData),
      sampledChildRssBytes: 0, peakSampledChildRssBytes: 0, staleResults: 0, peakRunningTasks: 0 };
    // Reserve the maximum owned process capacity before copying initialization state.
    this.releaseCapacity = this.account.reserve(this.maxThreads * ((this.oldSpaceMb + 88) * MB
      + this.metrics.dictionaryCopyBytes * 3));
    try {
      // Reserve before materializing process copies of Worker shared dictionaries.
      const initializationData = workerData.dictShared ? { ...workerData, dictShared: {
        ...workerData.dictShared,
        bytes: Uint8Array.from(new Uint8Array(workerData.dictShared.bytes)).buffer,
        offsets: Uint32Array.from(new Uint32Array(workerData.dictShared.offsets)).buffer
      } } : workerData;
      this.workerData = initializationData;
      this.initialization = serialize(initializationData);
      if (this.initialization.length > this.maxMessageBytes) throw budgetError('Process initialization exceeds the IPC allowance.');
    } catch (error) { this.releaseCapacity(); throw error; }
  }

  get queueSize() { return this.pending.length; }
  get threads() { return [...this.children].map(slot => ({ threadId: slot.child.pid, terminate: () => this.stop(slot) })); }
  stats() { return { ...this.metrics, initializationRetainedBytes: this.initialization?.length || 0,
    estimatedCopiedDictionaryBytes: this.children.size * this.metrics.dictionaryCopyBytes, ownedChildren: this.children.size, queuedTasks: this.queueSize,
    runningTasks: [...this.children].filter(slot => slot.task).length,
    terminatingTasks: [...this.children].filter(slot => slot.task && slot.stopping).length, aggregate: this.account.stats(),
    rssMethod: 'child-reported-samples-plus-prospective-heap-native-IPC-reservations' }; }

  run(payload, { name, signal = null } = {}) {
    if (this.closed) return Promise.reject(createAbortError('Process pool is closed.'));
    if (signal?.aborted) return Promise.reject(createAbortError());
    let release, buffer, outputLimit, reservationBytes;
    try {
      const retained = estimateRetainedBytes(payload);
      outputLimit = Math.min(this.maxMessageBytes, name === 'analyzeFile'
        ? FILE_ANALYSIS_MAX_OUTPUT_BYTES + 4096 : Math.max(4096, retained * 16));
      reservationBytes = retained * 3 + outputLimit * 2;
      release = this.account.reserve(reservationBytes);
      buffer = serialize(payload);
      if (buffer.length > this.maxMessageBytes || buffer.length > retained * 2 + 1024) throw budgetError('Process input exceeds its reserved IPC allowance.');
    } catch (error) { release?.(); return Promise.reject(error); }
    this.metrics.ipcReservedBytes += reservationBytes;
    this.metrics.peakIpcReservedBytes = Math.max(this.metrics.peakIpcReservedBytes, this.metrics.ipcReservedBytes);
    return new Promise((resolve, reject) => {
      const task = { id: `${this.generation}:${++this.nextTask}`, name, buffer, outputLimit,
        reservationBytes, release, resolve, reject, signal, settled: false, slot: null, timer: null };
      task.abort = () => {
        const slot = task.slot;
        if (slot) { slot.stopping = true; slot.ready = false; }
        this.settle(task, createAbortError());
        if (slot) void this.stop(slot).catch(error => this.reportError(error));
      };
      signal?.addEventListener('abort', task.abort, { once: true });
      if (signal?.aborted) { task.abort(); return; }
      this.pending.push(task);
      try { this.pump(); } catch (error) { this.settle(task, error); }
    });
  }

  settle(task, error = null, value = null) {
    if (task.settled) return;
    task.settled = true;
    clearTimeout(task.timer);
    task.signal?.removeEventListener('abort', task.abort);
    const index = this.pending.indexOf(task);
    if (index >= 0) this.pending.splice(index, 1);
    // Reject the caller promptly, but a terminating child still owns its input
    // and IPC allowance until close confirms that storage has been released.
    if (!task.slot?.stopping) this.releaseTask(task);
    if (error) { this.metrics.failed++; task.reject(error); }
    else { this.metrics.completed++; task.resolve(value); }
  }

  releaseTask(task) {
    if (task.released) return;
    task.released = true;
    if (task.slot?.task === task) task.slot.task = null;
    task.slot = null;
    task.buffer = null;
    task.release();
    this.metrics.ipcReservedBytes -= task.reservationBytes;
  }

  reportError(error) { if (this.listenerCount('error')) this.emit('error', error); }

  start() {
    const child = fork(this.filename, [], { execPath: process.execPath,
      execArgv: [`--max-old-space-size=${this.oldSpaceMb}`, '--max-semi-space-size=8'],
      env: { ...process.env, NODE_OPTIONS: '' }, detached: process.platform !== 'win32',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced' });
    let resolveExit;
    const slot = { child, ready: false, stopping: false, task: null, rss: 0,
      exited: new Promise(resolve => { resolveExit = resolve; }) };
    this.children.add(slot);
    this.metrics.peakChildren = Math.max(this.metrics.peakChildren, this.children.size);
    this.emit('workerCreate', child);
    slot.initializing = setTimeout(() => {
      slot.stopping = true;
      this.reportError(new Error('Process task initialization timed out.'));
      void this.stop(slot).catch(error => this.reportError(error));
    }, Math.min(this.timeoutMs, 10000));
    child.on('message', message => this.receive(slot, message));
    child.on('error', error => {
      slot.stopping = true;
      if (slot.task) this.settle(slot.task, error);
      this.reportError(error);
      void this.stop(slot).catch(failure => this.reportError(failure));
    });
    child.once('close', (code, signal) => {
      clearTimeout(slot.initializing);
      this.children.delete(slot);
      if (slot.task) {
        const task = slot.task;
        this.settle(task, Object.assign(new Error(`Task process exited (${code ?? signal}).`), { code: 'ERR_PROCESS_TASK_EXIT' }));
        this.releaseTask(task);
      }
      resolveExit();
      if (!this.closed && this.pending.length) {
        if (this.metrics.restarts++ >= this.maxRestartAttempts) {
          for (const task of [...this.pending]) this.settle(task, new Error('Process restart allowance exhausted.'));
        } else this.pump();
      }
    });
    child.send({ type: 'initialize', generation: this.generation, oldSpaceMb: this.oldSpaceMb,
      maxMessageBytes: this.maxMessageBytes, payload: this.initialization }, error => {
      if (error) { slot.stopping = true; void this.stop(slot).catch(failure => this.reportError(failure)); }
    });
    return slot;
  }

  receive(slot, message) {
    if (!message || message.generation !== this.generation || slot.stopping) {
      this.metrics.staleResults++; return;
    }
    if (message.type === 'initialization-failed') {
      slot.stopping = true;
      const error = Object.assign(new Error(message.message || 'Task process initialization failed.'), { code: 'ERR_PROCESS_TASK_INITIALIZATION' });
      for (const task of [...this.pending]) this.settle(task, error);
      void this.stop(slot).catch(failure => this.reportError(failure));
      return;
    }
    if (message.type === 'ready') {
      clearTimeout(slot.initializing);
      const observation = message.observation;
      if (observation?.resourceLimitAcknowledged !== true || observation.requestedOldSpaceMb !== this.oldSpaceMb) {
        slot.stopping = true; void this.stop(slot).catch(error => this.reportError(error)); return;
      }
      slot.ready = true;
      this.emit('message', { type: 'worker-runtime', threadId: slot.child.pid, observation });
      this.pump(); return;
    }
    if (message.type === 'worker-task' || message.type === 'worker-task-start' || message.type === 'worker-crash') {
      this.emit('message', { ...message, threadId: slot.child.pid }); return;
    }
    if (message.type !== 'result' || !slot.task || message.taskId !== slot.task.id) {
      this.metrics.staleResults++; return;
    }
    const task = slot.task;
    slot.rss = Number(message.rssBytes) || 0;
    this.metrics.sampledChildRssBytes = [...this.children].reduce((sum, entry) => sum + entry.rss, 0);
    this.metrics.peakSampledChildRssBytes = Math.max(this.metrics.peakSampledChildRssBytes, this.metrics.sampledChildRssBytes);
    try {
      if (this.metrics.sampledChildRssBytes + process.memoryUsage().rss > this.account.stats().limitBytes) throw budgetError('Observed process-tree RSS exceeds the aggregate budget.');
      if (message.error) throw Object.assign(new Error(message.error.message), { code: message.error.code });
      if (!Buffer.isBuffer(message.payload) || message.payload.length > task.outputLimit) throw budgetError('Task output exceeds its reserved IPC allowance.');
      this.settle(task, null, deserialize(message.payload));
    } catch (error) { this.settle(task, error); }
    this.pump();
  }

  pump() {
    if (this.closed) return;
    // Initializing children already satisfy pending demand; busy/stopping
    // children do not. Independently ready children remain eligible below.
    let available = [...this.children].filter(slot => !slot.stopping && !slot.task).length;
    while (available < this.pending.length && this.children.size < this.maxThreads) {
      this.start();
      available += 1;
    }
    for (const slot of this.children) {
      if (!slot.ready || slot.stopping || slot.task || !this.pending.length) continue;
      const task = this.pending.shift();
      task.slot = slot; slot.task = task; this.metrics.started++;
      this.metrics.peakRunningTasks = Math.max(this.metrics.peakRunningTasks, [...this.children].filter(entry => entry.task).length);
      task.timer = setTimeout(() => {
        slot.stopping = true; slot.ready = false;
        this.settle(task, Object.assign(new Error('Process task timed out.'), { code: 'ERR_PROCESS_TASK_TIMEOUT' }));
        void this.stop(slot).catch(error => this.reportError(error));
      }, this.timeoutMs);
      slot.child.send({ type: 'task', generation: this.generation, taskId: task.id,
        name: task.name, outputLimit: task.outputLimit, payload: task.buffer }, error => {
        if (error) { slot.stopping = true; this.settle(task, error); void this.stop(slot).catch(failure => this.reportError(failure)); }
      });
    }
  }

  async stop(slot) {
    if (slot.stoppingPromise) return slot.stoppingPromise;
    slot.stopping = true; slot.ready = false;
    slot.stoppingPromise = (async () => {
      await killChildProcessTree(slot.child, { detached: process.platform !== 'win32', graceMs: 100, killTree: true });
      let timer;
      try {
        await Promise.race([slot.exited, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Task process termination was not confirmed.')), 5000);
        })]);
      } finally { clearTimeout(timer); }
    })();
    try { return await slot.stoppingPromise; }
    catch (error) { slot.stoppingPromise = null; throw error; }
  }

  destroy() {
    if (!this.destroying) {
      this.closed = true;
      for (const task of [...this.pending]) this.settle(task, createAbortError('Process pool destroyed.'));
      for (const slot of this.children) {
        slot.stopping = true; slot.ready = false;
        if (slot.task) this.settle(slot.task, createAbortError('Process pool destroyed.'));
      }
      this.destroying = Promise.allSettled([...this.children].map(slot => this.stop(slot))).then(results => {
        const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (failures.length) throw new AggregateError(failures, 'Process pool termination remains unconfirmed; cleanup can be retried.');
        this.initialization = null; this.workerData = null;
        this.metrics.sampledChildRssBytes = 0;
        if (!this.capacityReleased) { this.capacityReleased = true; this.releaseCapacity(); }
      }).catch(error => {
        this.destroying = null;
        throw error;
      });
    }
    return this.destroying;
  }
}
