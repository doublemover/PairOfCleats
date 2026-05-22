import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { normalizeGzipOptions, resolveZstd } from './compress.js';
import { createTimeoutError, runWithTimeout } from '../promise-timeout.js';

const JSONL_COMPRESS_WORKER_TERMINATE_TIMEOUT_MS = 5000;
const WORKER_URL = new URL('./jsonl-compress-worker.js', import.meta.url);

const resolveWorkerCount = (value) => {
  const raw = Number(value);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.min(8, Math.max(1, Math.floor(raw)));
  }
  const cpuCount = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : (Array.isArray(os.cpus()) ? os.cpus().length : 1);
  if (!Number.isFinite(cpuCount) || cpuCount <= 1) return 1;
  return Math.min(4, Math.max(1, cpuCount - 1));
};

const toBuffer = (payload) => {
  if (!payload) return Buffer.alloc(0);
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof Uint8Array) {
    return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  }
  if (payload instanceof ArrayBuffer) return Buffer.from(payload);
  return Buffer.from(payload);
};

class JsonlCompressionPool {
  constructor(options = {}) {
    const compression = options.compression;
    this.compression = compression;
    this.gzipOptions = compression === 'gzip'
      ? normalizeGzipOptions(options.gzipOptions)
      : null;
    if (compression === 'zstd') {
      resolveZstd(options);
    }
    const rawLevel = options.zstdLevel ?? options.level;
    this.zstdLevel = Number.isFinite(Number(rawLevel)) ? Math.floor(Number(rawLevel)) : 3;
    this.size = resolveWorkerCount(options.workerCount);
    this.queue = [];
    this.pending = new Map();
    this.workers = [];
    this.closed = false;
    this.error = null;
    this.nextId = 0;
    this.idleWaiters = [];
    for (let i = 0; i < this.size; i += 1) {
      this.workers.push(this._createWorker());
    }
  }

  _createWorker() {
    const worker = new Worker(WORKER_URL, { type: 'module' });
    worker.busy = false;
    worker.on('message', (msg) => this._handleMessage(worker, msg));
    worker.on('error', (err) => this._handleWorkerError(err));
    worker.on('exit', (code) => {
      if (!this.closed && code && !this.error) {
        this._handleWorkerError(new Error(`JSONL compression worker exited with code ${code}`));
      }
    });
    worker.postMessage({
      type: 'init',
      compression: this.compression,
      gzipOptions: this.gzipOptions,
      zstdLevel: this.zstdLevel
    });
    return worker;
  }

  _handleMessage(worker, msg) {
    const id = msg?.id;
    const task = this.pending.get(id);
    if (!task) return;
    this.pending.delete(id);
    worker.busy = false;
    if (this.closed || this.error) {
      this._dispatch();
      return;
    }
    if (!msg?.ok) {
      const err = new Error(msg?.error?.message || 'Compression failed');
      if (msg?.error?.code) err.code = msg.error.code;
      if (msg?.error?.name) err.name = msg.error.name;
      task.reject(err);
      this._dispatch();
      return;
    }
    task.resolve(toBuffer(msg.payload));
    this._dispatch();
  }

  _handleWorkerError(err) {
    if (this.error) return;
    this._fail(err);
  }

  _fail(err) {
    if (this.error) return;
    this.error = err;
    for (const task of this.queue) {
      task.reject(err);
    }
    this.queue.length = 0;
    for (const task of this.pending.values()) {
      task.reject(err);
    }
    this.pending.clear();
    while (this.idleWaiters.length) {
      this.idleWaiters.shift().reject(err);
    }
    this.close();
  }

  _dispatch() {
    if (this.closed || this.error) return;
    for (const worker of this.workers) {
      if (worker.busy) continue;
      const task = this.queue.shift();
      if (!task) break;
      worker.busy = true;
      this.pending.set(task.id, task);
      const payload = task.payload;
      worker.postMessage({ id: task.id, payload }, [payload.buffer]);
    }
    if (this._isIdle()) {
      while (this.idleWaiters.length) {
        this.idleWaiters.shift().resolve();
      }
    }
  }

  compress(buffer) {
    if (this.closed) {
      return Promise.reject(new Error('Compression pool closed.'));
    }
    if (this.error) {
      return Promise.reject(this.error);
    }
    const payload = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const id = this.nextId + 1;
    this.nextId = id;
    return new Promise((resolve, reject) => {
      this.queue.push({ id, payload, resolve, reject });
      this._dispatch();
    });
  }

  _isIdle() {
    if (this.queue.length) return false;
    if (this.pending.size) return false;
    return this.workers.every((worker) => !worker.busy);
  }

  waitForIdle() {
    if (this.error) {
      return Promise.reject(this.error);
    }
    if (this._isIdle()) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.idleWaiters.push({ resolve, reject });
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.queue.length || this.pending.size) {
      this._fail(new Error('Compression pool closed before all tasks completed.'));
    }
    const workers = this.workers.splice(0);
    await Promise.allSettled(workers.map((worker) => runWithTimeout(
      () => Promise.resolve(worker.terminate()),
      {
        timeoutMs: JSONL_COMPRESS_WORKER_TERMINATE_TIMEOUT_MS,
        errorFactory: () => createTimeoutError({
          message: `JSONL compression worker terminate timed out after ${JSONL_COMPRESS_WORKER_TERMINATE_TIMEOUT_MS}ms.`,
          code: 'JSONL_COMPRESS_WORKER_TERMINATE_TIMEOUT',
          retryable: false
        })
      }
    )));
  }
}

export const createJsonlCompressionPool = (options = {}) => new JsonlCompressionPool(options);
