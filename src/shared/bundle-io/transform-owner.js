import { AsyncLocalStorage } from 'node:async_hooks';
import { currentSchedulerTaskLease, withSchedulerCpuSuspended } from '../concurrency/scheduler-task-scope.js';
import { Worker } from 'node:worker_threads';
import { runWithTimeout, createTimeoutError } from '../promise-timeout.js';
import { createAbortError, throwIfAborted, isAbortError } from '../abort.js';
import { estimatePayloadBytes } from '../bundle-io-checksum.js';
import { resolveWorkerHeapLaunchContract } from '../workers/heap-contract.js';
import { BUNDLE_WORKER_MAX_PAYLOAD_BYTES } from '../bundle-contract.js';
import { BUNDLE_WORKER_TIMEOUT_MS, BUNDLE_WORKER_TERMINATE_TIMEOUT_MS } from '../bundle-io-constants.js';
const context = new AsyncLocalStorage();
const workerUrl = new URL('../workers/bundle-transform-worker.js', import.meta.url);
const limits = { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 };
let quarantine = null;
const retainedWorkers = new Set();
export const bundleTransformHeapContract = () => resolveWorkerHeapLaunchContract(limits);

/** One active transform, no queued cloned graphs. Waiting callers retain borrowed
 * immutable source products under the existing file/window owner until admission. */
export class BundleTransformOwner {
  constructor({ scheduler = null, signal = null } = {}) {
    if (quarantine) throw quarantine;
    this.scheduler = scheduler; this.signal = signal; this.worker = null; this.closed = false;
    this.waiters = []; this.waitingEstimatedBytes = 0; this.busy = false; this.nextId = 0; this.active = null;
    this.closePromise = null; this.heapUnavailable = false;
    this.metrics = { workersStarted: 0, requests: 0, estimatedInputBytes: 0, estimatedResultBytes: 0, activeEstimatedBytes: 0, peakActiveEstimatedBytes: 0 };
    scheduler?.registerQueue?.('stage1.bundle-transform', { priority: 40, weight: 1,
      maxPending: 1, maxPendingBytes: BUNDLE_WORKER_MAX_PAYLOAD_BYTES * 2 });
  }
  async _acquire(signal, bytes) {
    throwIfAborted(signal); if (quarantine) throw quarantine;
    if (this.closed) throw new Error('Bundle transform owner closed.');
    if (!this.busy) { this.busy = true; return true; }
    if (this.waiters.length >= 4 || this.waitingEstimatedBytes + bytes > BUNDLE_WORKER_MAX_PAYLOAD_BYTES) return false;
    await new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, bytes, abort: null };
      waiter.abort = () => { signal?.removeEventListener('abort', waiter.abort); const index = this.waiters.indexOf(waiter); if (index >= 0) { this.waiters.splice(index, 1); this.waitingEstimatedBytes -= bytes; } reject(createAbortError()); };
      signal?.addEventListener('abort', waiter.abort, { once: true }); this.waiters.push(waiter); this.waitingEstimatedBytes += bytes;
      if (signal?.aborted) waiter.abort();
    });
    return true;
  }
  _release() {
    const waiter = this.waiters.shift();
    if (!waiter) { this.busy = false; return; }
    this.waitingEstimatedBytes -= waiter.bytes;
    waiter.signal?.removeEventListener('abort', waiter.abort); waiter.resolve();
  }
  async _retire() {
    const worker = this.worker; this.worker = null; if (!worker) return;
    retainedWorkers.add(worker);
    const termination = Promise.resolve().then(() => worker.terminate());
    termination.then(() => retainedWorkers.delete(worker), () => {});
    try {
      await runWithTimeout(() => termination, { timeoutMs: BUNDLE_WORKER_TERMINATE_TIMEOUT_MS,
        errorFactory: () => createTimeoutError({ message: 'Bundle transform worker termination deadline exceeded.',
          code: 'BUNDLE_WORKER_TERMINATE_TIMEOUT', retryable: false }) });
    } catch (error) { quarantine = error; throw error; }
  }
  async run({ operation, payload, timeoutMs = BUNDLE_WORKER_TIMEOUT_MS, signal = currentSchedulerTaskLease()?.signal || this.signal }) {
    throwIfAborted(signal);
    if (quarantine) throw quarantine;
    if (this.closed) throw new Error('Bundle transform owner closed.');
    const bytes = estimatePayloadBytes(payload);
    if (!bytes || bytes > BUNDLE_WORKER_MAX_PAYLOAD_BYTES) return { ok: false, reason: 'payload-budget' };
    if (this.heapUnavailable || !bundleTransformHeapContract().supported) return { ok: false, reason: 'heap-bound-unavailable' };
    const admitted = async () => {
      if (!await this._acquire(signal, bytes)) return { ok: false, reason: 'queued-input-budget' };
      try {
        throwIfAborted(signal);
        if (this.closed) throw new Error('Bundle transform owner closed.');
        const job = () => this._execute({ operation, payload, timeoutMs, signal, bytes });
        const running = this.scheduler
          ? this.scheduler.scheduleIfAvailable?.('stage1.bundle-transform', { cpu: 1, mem: 1, bytes: bytes * 2, signal }, job) : job();
        if (!running) return { ok: false, reason: 'scheduler-admission-busy' };
        this.active = running; return await running;
      } finally { this.active = null; this._release(); }
    };
    // Serialized borrowers and the actual child compute own their CPU permit.
    // The file's original bytes/window remain charged while it waits.
    return this.scheduler ? withSchedulerCpuSuspended(admitted) : admitted();
  }
  async _execute({ operation, payload, timeoutMs, signal, bytes }) {
    throwIfAborted(signal); if (quarantine) throw quarantine;
    if (!this.worker) {
      const worker = new Worker(workerUrl, { type: 'module', resourceLimits: limits });
      this.worker = worker; this.metrics.workersStarted++;
      worker.on('error', () => {}); worker.unref();
    }
    const worker = this.worker, id = ++this.nextId;
    worker.ref(); this.metrics.requests++; this.metrics.estimatedInputBytes += bytes;
    this.metrics.activeEstimatedBytes = bytes * 2; this.metrics.peakActiveEstimatedBytes = Math.max(this.metrics.peakActiveEstimatedBytes, bytes * 2);
    let detach = () => {};
    const reply = new Promise((resolve, reject) => {
      const onMessage = message => { if (message?.id === id) resolve(message); };
      const onError = error => reject(error);
      const onExit = code => reject(new Error(`Bundle transform worker exited before result: ${code}`));
      worker.on('message', onMessage); worker.once('error', onError); worker.once('exit', onExit);
      detach = () => { worker.off('message', onMessage); worker.off('error', onError); worker.off('exit', onExit); };
      try { worker.postMessage({ id, operation, payload }); } catch (error) { reject(error); }
    });
    try {
      const message = await runWithTimeout(() => reply, { timeoutMs: Math.max(500, Number(timeoutMs) || BUNDLE_WORKER_TIMEOUT_MS), signal,
        errorFactory: () => createTimeoutError({ message: 'Bundle transform request timed out.', code: 'BUNDLE_WORKER_TIMEOUT', retryable: false }) });
      const resultBytes = message?.resultBytes;
      if (message?.ok !== true) {
        if (message?.code === 'BUNDLE_WORKER_HEAP_UNACKNOWLEDGED') {
          this.heapUnavailable = true; await this._retire();
          return { ok: false, reason: 'heap-bound-unavailable' };
        }
        return { ok: false, reason: message?.error || 'worker-error' };
      }
      if (!Number.isSafeInteger(resultBytes) || resultBytes < 0 || resultBytes > BUNDLE_WORKER_MAX_PAYLOAD_BYTES) {
        await this._retire(); return { ok: false, reason: 'result-budget' };
      }
      this.metrics.estimatedResultBytes += resultBytes;
      return { ok: true, result: message.result };
    } catch (error) {
      if (quarantine) throw quarantine;
      // A timeout/abort cannot authorize inline work while this request still runs.
      await this._retire();
      if (isAbortError(error)) throw error;
      throwIfAborted(signal);
      return { ok: false, reason: error.code || error.message };
    } finally { detach(); worker.unref(); this.metrics.activeEstimatedBytes = 0; }
  }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) { waiter.signal?.removeEventListener('abort', waiter.abort); waiter.reject(new Error('Bundle transform owner closed.')); }
    this.waitingEstimatedBytes = 0;
    this.closePromise = (async () => {
      if (this.active) await this.active.catch(() => {});
      await this._retire();
    })();
    return this.closePromise;
  }
  stats() { return { ...this.metrics, waitingBorrowers: this.waiters.length, queuedEstimatedInputBytes: this.waitingEstimatedBytes }; }
}
export const withBundleTransformScope = async (options, operation) => {
  if (context.getStore()) return operation();
  const owner = new BundleTransformOwner(options); let primary = null;
  try { return await context.run(owner, operation); }
  catch (error) { primary = error; throw error; }
  finally { try { await owner.close(); } catch (error) { if (primary) primary.bundleTransformTeardownError = error; else throw error; } }
};
export const runOwnedBundleTransform = async options => {
  if (quarantine) throw quarantine;
  const borrowed = context.getStore(); if (borrowed) return borrowed.run(options);
  return withBundleTransformScope({}, () => context.getStore().run(options));
};
