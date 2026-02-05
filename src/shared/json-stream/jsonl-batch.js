import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { normalizeGzipOptions, resolveZstd } from './compress.js';
import { createJsonWriteStream, writeChunk } from './streams.js';
import { createAbortError } from './runtime.js';

const MIN_BLOCK_BYTES = 1024 * 1024;
const MAX_BLOCK_BYTES = 4 * 1024 * 1024;
const DEFAULT_GZIP_BLOCK_BYTES = MIN_BLOCK_BYTES;
const DEFAULT_ZSTD_BLOCK_BYTES = MAX_BLOCK_BYTES;
const NEWLINE = Buffer.from('\n');
const WORKER_URL = new URL('./jsonl-compress-worker.js', import.meta.url);

const resolveBlockSize = (value, compression) => {
  const fallback = compression === 'zstd' ? DEFAULT_ZSTD_BLOCK_BYTES : DEFAULT_GZIP_BLOCK_BYTES;
  const raw = Number(value);
  const size = Number.isFinite(raw) ? Math.floor(raw) : fallback;
  if (!Number.isFinite(size) || size <= 0) return fallback;
  return Math.min(MAX_BLOCK_BYTES, Math.max(MIN_BLOCK_BYTES, size));
};

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

const createSemaphore = (limit) => {
  if (!Number.isFinite(limit) || limit <= 0) {
    return {
      acquire: async () => {},
      release: () => {},
      abort: () => {}
    };
  }
  let inFlight = 0;
  const waiters = [];
  const acquire = async () => {
    if (inFlight < limit) {
      inFlight += 1;
      return;
    }
    await new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    inFlight += 1;
  };
  const release = () => {
    inFlight = Math.max(0, inFlight - 1);
    const waiter = waiters.shift();
    if (waiter) {
      waiter.resolve();
    }
  };
  const abort = (err) => {
    while (waiters.length) {
      waiters.shift().reject(err);
    }
  };
  return { acquire, release, abort };
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
    await Promise.all(workers.map((worker) => worker.terminate().catch(() => {})));
  }
}

export const createJsonlCompressionPool = (options = {}) => new JsonlCompressionPool(options);

export const createJsonlBatchWriter = (filePath, options = {}) => {
  const {
    compression = null,
    atomic = false,
    gzipOptions = null,
    highWaterMark = null,
    signal = null,
    blockSize = null,
    pool = null,
    workerCount = null,
    workerMaxInFlight = null,
    level = null,
    zstdLevel = null
  } = options;
  const resolvedCompression = compression === 'none' ? null : compression;
  const useWorkerCompression = resolvedCompression === 'zstd';
  const resolvedBlockSize = resolveBlockSize(blockSize, resolvedCompression);
  const { stream, done, getBytesWritten } = createJsonWriteStream(filePath, {
    compression: useWorkerCompression ? null : resolvedCompression,
    atomic,
    highWaterMark,
    signal
  });

  let ownedPool = false;
  let compressionPool = pool;
  if (useWorkerCompression) {
    resolveZstd(options);
    if (!compressionPool) {
      compressionPool = createJsonlCompressionPool({
        compression: resolvedCompression,
        gzipOptions,
        workerCount,
        level,
        zstdLevel
      });
      ownedPool = true;
    }
  }

  const maxInFlight = useWorkerCompression
    ? Math.max(
      2,
      Number.isFinite(Number(workerMaxInFlight))
        ? Math.max(1, Math.floor(Number(workerMaxInFlight)))
        : compressionPool.size * 2
    )
    : 0;
  const semaphore = useWorkerCompression ? createSemaphore(maxInFlight) : null;

  const pendingChunks = [];
  let pendingBytes = 0;
  let nextBlockId = 0;
  let nextToWrite = 0;
  let pendingBlocks = 0;
  const ready = new Map();
  const drainWaiters = [];
  let flushInProgress = false;
  let flushQueued = false;
  let closed = false;
  let failed = null;

  const resolveDrain = () => {
    if (pendingBlocks !== 0) return;
    while (drainWaiters.length) {
      drainWaiters.shift().resolve();
    }
  };

  const rejectDrain = (err) => {
    while (drainWaiters.length) {
      drainWaiters.shift().reject(err);
    }
  };

  const waitForDrain = () => (
    pendingBlocks === 0
      ? Promise.resolve()
      : new Promise((resolve, reject) => drainWaiters.push({ resolve, reject }))
  );

  const fail = async (err) => {
    if (failed) return;
    failed = err || new Error('JSONL write failed');
    closed = true;
    if (semaphore) semaphore.abort(failed);
    rejectDrain(failed);
    ready.clear();
    pendingBlocks = 0;
    try { stream.destroy(failed); } catch {}
    try { await done; } catch {}
    if (ownedPool && compressionPool) {
      await compressionPool.close();
      compressionPool = null;
    }
  };

  const flushReady = async () => {
    if (failed) return;
    if (flushInProgress) {
      flushQueued = true;
      return;
    }
    flushInProgress = true;
    try {
      do {
        flushQueued = false;
        while (!failed && ready.has(nextToWrite)) {
          const data = ready.get(nextToWrite);
          ready.delete(nextToWrite);
          await writeChunk(stream, data);
          nextToWrite += 1;
          pendingBlocks = Math.max(0, pendingBlocks - 1);
          if (semaphore) semaphore.release();
          if (pendingBlocks === 0) resolveDrain();
        }
      } while (flushQueued && !failed);
    } catch (err) {
      await fail(err);
    } finally {
      flushInProgress = false;
    }
  };

  const enqueueCompressedBlock = async (block) => {
    if (!compressionPool) {
      throw new Error('Missing compression pool.');
    }
    await semaphore.acquire();
    if (failed) {
      if (semaphore) semaphore.release();
      throw failed;
    }
    const blockId = nextBlockId;
    nextBlockId += 1;
    pendingBlocks += 1;
    compressionPool
      .compress(block)
      .then((compressed) => {
        if (failed) return;
        ready.set(blockId, compressed);
        flushReady();
      })
      .catch(async (err) => {
        if (semaphore) semaphore.release();
        pendingBlocks = Math.max(0, pendingBlocks - 1);
        await fail(err);
      });
  };

  const flushBuffer = async () => {
    if (!pendingBytes) return;
    const block = Buffer.concat(pendingChunks, pendingBytes);
    pendingChunks.length = 0;
    pendingBytes = 0;
    if (!useWorkerCompression) {
      await writeChunk(stream, block);
      return;
    }
    await enqueueCompressedBlock(block);
  };

  const writeLine = async (line, lineBytes = null) => {
    if (failed) throw failed;
    if (closed) throw new Error('JSONL writer closed.');
    const buffer = Buffer.isBuffer(line) ? line : Buffer.from(line, 'utf8');
    const bytes = Number.isFinite(Number(lineBytes))
      ? Math.max(0, Math.floor(Number(lineBytes)))
      : buffer.length + 1;
    if (pendingBytes && pendingBytes + bytes > resolvedBlockSize) {
      await flushBuffer();
    }
    pendingChunks.push(buffer, NEWLINE);
    pendingBytes += bytes;
    if (pendingBytes >= resolvedBlockSize || bytes > resolvedBlockSize) {
      await flushBuffer();
    }
  };

  const attachAbortHandler = () => {
    if (!signal) return () => {};
    const handler = () => {
      fail(createAbortError());
    };
    signal.addEventListener('abort', handler, { once: true });
    return () => signal.removeEventListener('abort', handler);
  };

  const detachAbort = attachAbortHandler();

  const close = async () => {
    if (closed) {
      if (failed) throw failed;
      return;
    }
    closed = true;
    try {
      await flushBuffer();
      if (useWorkerCompression) {
        await waitForDrain();
        if (compressionPool?.waitForIdle) {
          await compressionPool.waitForIdle();
        }
      }
      stream.end();
      await done;
      if (ownedPool && compressionPool) {
        await compressionPool.close();
        compressionPool = null;
      }
      if (failed) throw failed;
    } catch (err) {
      await fail(err);
      throw err;
    } finally {
      detachAbort();
    }
  };

  const destroy = async (err) => {
    try {
      await fail(err || new Error('JSONL write aborted.'));
    } finally {
      detachAbort();
    }
  };

  return {
    writeLine,
    close,
    destroy,
    getBytesWritten
  };
};
