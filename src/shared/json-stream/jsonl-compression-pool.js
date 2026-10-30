import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { normalizeGzipOptions, resolveZstd } from './compress.js';
import { toTransferableBuffer } from './buffer-transfer.js';
import { runWithTimeout, createTimeoutError } from '../promise-timeout.js';
import { createAbortError, throwIfAborted } from '../abort.js';
let compressionQuarantineError = null;
const quarantinedWorkers = new Set();
const TERMINATE_TIMEOUT_MS = 5000;
const WORKER_URL = new URL('./jsonl-compress-worker.js', import.meta.url);
const MAX_BLOCK_BYTES = 4 * 1024 * 1024;
const BLOCK_OVERHEAD = 64 * 1024;
const resolveWorkerCount = value => {
  if (Number.isFinite(Number(value)) && Number(value) > 0) return Math.min(8, Math.max(1, Math.floor(Number(value))));
  const cpus = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.min(4, Math.max(1, cpus - 1));
};
const toBuffer = value => Buffer.isBuffer(value) ? value : Buffer.from(value?.buffer || value || new ArrayBuffer(0), value?.byteOffset || 0, value?.byteLength);

/** One owner for workers and retained input/output reservations. A reservation is
 * released by the ordered writer only after its output is consumed. */
export class JsonlCompressionPool {
  constructor(options = {}) {
    if (compressionQuarantineError) throw compressionQuarantineError;
    this.compression = options.compression;
    this.gzipOptions = this.compression === 'gzip' ? normalizeGzipOptions(options.gzipOptions) : null;
    if (this.compression === 'zstd') resolveZstd(options);
    this.zstdLevel = Number.isFinite(Number(options.zstdLevel ?? options.level)) ? Math.floor(Number(options.zstdLevel ?? options.level)) : 3;
    this.size = resolveWorkerCount(options.workerCount);
    this.maxReservedBytes = Math.max(MAX_BLOCK_BYTES * 3 + BLOCK_OVERHEAD,
      Math.floor(Number(options.maxReservedBytes) || this.size * (MAX_BLOCK_BYTES * 3 + BLOCK_OVERHEAD)));
    this.schedule = options.schedule || (job => job());
    this.queue = []; this.pending = new Map(); this.workers = []; this.waiters = [];
    this.reservedBytes = 0; this.highWaterBytes = 0; this.closed = false; this.error = null;
    this.nextId = 0; this.workersStarted = 0; this.idleWaiters = []; this.closePromise = null;
  }
  async acquireBlock(bytes, signal = null) {
    throwIfAborted(signal);
    if (bytes > MAX_BLOCK_BYTES || bytes < 0 || !Number.isSafeInteger(bytes)) throw new RangeError('Compression block exceeds its bounded contract.');
    const amount = bytes * 3 + BLOCK_OVERHEAD;
    const lease = await new Promise((resolve, reject) => {
      const waiter = { amount, resolve, reject, signal, onAbort: null };
      waiter.onAbort = () => { const index = this.waiters.indexOf(waiter); if (index >= 0) this.waiters.splice(index, 1); reject(createAbortError()); this._admit(); };
      signal?.addEventListener('abort', waiter.onAbort, { once: true });
      this.waiters.push(waiter); this._admit();
    });
    return lease;
  }
  _admit() {
    while (this.waiters.length) {
      const waiter = this.waiters[0];
      if (!this.closed && !this.error && this.reservedBytes + waiter.amount > this.maxReservedBytes) return;
      this.waiters.shift(); waiter.signal?.removeEventListener('abort', waiter.onAbort);
      if (this.error || this.closed) { waiter.reject(this.error || new Error('Compression pool closed.')); continue; }
      this.reservedBytes += waiter.amount; this.highWaterBytes = Math.max(this.highWaterBytes, this.reservedBytes);
      let released = false;
      waiter.resolve({ bytes: waiter.amount, release: () => {
        if (released) return; released = true; this.reservedBytes -= waiter.amount; this._admit();
      } });
    }
  }
  _createWorker() {
    const worker = new Worker(WORKER_URL, { type: 'module' }); this.workersStarted++; worker.busy = false;
    worker.on('message', message => this._handleMessage(worker, message));
    worker.on('error', error => { void this._fail(error); });
    worker.on('exit', code => { if (!this.closed && !this.error) void this._fail(new Error(`JSONL compression worker exited with code ${code}`)); });
    try { worker.postMessage({ type: 'init', compression: this.compression, gzipOptions: this.gzipOptions, zstdLevel: this.zstdLevel }); }
    catch (error) { this.workers.push(worker); throw error; }
    return worker;
  }
  _handleMessage(worker, message) {
    const task = this.pending.get(message?.id);
    if (!task || task.worker !== worker || this.closed || this.error) return;
    this.pending.delete(task.id); worker.busy = false;
    if (message?.ok !== true) {
      const error = Object.assign(new Error(message?.error?.message || 'Compression failed'), message?.error || {});
      task.reject(error); this._dispatch(); return;
    }
    const output = toBuffer(message.payload);
    if (output.length > task.inputBytes + BLOCK_OVERHEAD) {
      task.reject(new RangeError('Compressed output exceeds its reserved bound.')); this._dispatch(); return;
    }
    task.resolve(output); this._dispatch();
  }
  _dispatch() {
    if (this.closed || this.error) return;
    const demand = Math.min(this.size, this.queue.length + this.pending.size);
    try { while (this.workers.length < demand) this.workers.push(this._createWorker()); }
    catch (error) { void this._fail(error); return; }
    for (const worker of this.workers) {
      if (worker.busy) continue;
      const task = this.queue.shift(); if (!task) break;
      worker.busy = true; task.worker = worker; this.pending.set(task.id, task);
      try { const payload = task.payload; task.payload = null; worker.postMessage({ id: task.id, payload, zstdLevel: task.zstdLevel }, [payload.buffer]); }
      catch (error) { void this._fail(error); return; }
    }
    if (!this.queue.length && !this.pending.size) while (this.idleWaiters.length) this.idleWaiters.shift().resolve();
  }
  async compress(buffer, { signal = null, lease = null, zstdLevel = this.zstdLevel } = {}) {
    throwIfAborted(signal);
    if (this.error || this.closed) throw this.error || new Error('Compression pool closed.');
    const ownedLease = lease ? null : await this.acquireBlock(buffer.length, signal);
    try { return await this.schedule(() => new Promise((resolve, reject) => {
      if (this.error || this.closed) { reject(this.error || new Error('Compression pool closed.')); return; }
      const payload = toTransferableBuffer(buffer);
      this.queue.push({ id: ++this.nextId, payload, inputBytes: buffer.length, zstdLevel, resolve, reject }); this._dispatch();
    }), { signal, bytes: buffer.length * 3 + BLOCK_OVERHEAD });
    } finally { ownedLease?.release(); }
  }
  async _fail(error) {
    if (!this.error) this.error = error;
    await this.close().catch(() => {});
  }
  waitForIdle() {
    if (this.error) return Promise.reject(this.error);
    if (!this.queue.length && !this.pending.size) return Promise.resolve();
    return new Promise((resolve, reject) => this.idleWaiters.push({ resolve, reject }));
  }
  stats() { return { workersStarted: this.workersStarted, liveWorkers: this.workers.length,
    busyJobs: this.pending.size, queuedJobs: this.queue.length, reservedBytes: this.reservedBytes,
    highWaterBytes: this.highWaterBytes, maxReservedBytes: this.maxReservedBytes }; }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    if ((this.queue.length || this.pending.size) && !this.error) this.error = new Error('Compression pool closed before all tasks completed.');
    this._admit();
    const workers = this.workers.splice(0);
    this.closePromise = (async () => {
      // Retain pending task ownership until actual worker termination. A failed
      // teardown is an error and cannot permit an overlapping retry.
      const results = await Promise.allSettled(workers.map(worker => {
        const termination = Promise.resolve().then(() => worker.terminate());
        quarantinedWorkers.add(worker);
        termination.then(() => quarantinedWorkers.delete(worker), () => {});
        return runWithTimeout(() => termination, { timeoutMs: TERMINATE_TIMEOUT_MS,
          errorFactory: () => createTimeoutError({ message: 'JSONL compression worker termination deadline exceeded.',
            code: 'JSONL_COMPRESS_WORKER_TERMINATE_TIMEOUT', retryable: false }) });
      }));
      const teardown = results.find(result => result.status === 'rejected');
      if (teardown) compressionQuarantineError = teardown.reason;
      const error = teardown?.reason || this.error;
      for (const task of [...this.queue, ...this.pending.values()]) task.reject(error || new Error('Compression pool closed.'));
      this.queue.length = 0; this.pending.clear();
      while (this.idleWaiters.length) { const waiter = this.idleWaiters.shift(); if (error) waiter.reject(error); else waiter.resolve(); }
      if (teardown) throw teardown.reason;
    })();
    // Worker event handlers may initiate closure without a caller yet waiting.
    this.closePromise.catch(() => {});
    return this.closePromise;
  }
}
export const createJsonlCompressionPool = options => new JsonlCompressionPool(options);
