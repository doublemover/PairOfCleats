import { resolveZstd } from './compress.js';
import { borrowJsonlCompressionPool } from './jsonl-compression-scope.js';
import { createJsonlCompressionPool } from './jsonl-compression-pool.js';
import { createJsonWriteStream, writeChunk } from './streams.js';
import { createAbortError } from './runtime.js';

const MIN_BLOCK_BYTES = 1024 * 1024;
const MAX_BLOCK_BYTES = 4 * 1024 * 1024;
const DEFAULT_GZIP_BLOCK_BYTES = MIN_BLOCK_BYTES;
const DEFAULT_ZSTD_BLOCK_BYTES = MAX_BLOCK_BYTES;
const NEWLINE = Buffer.from('\n');

const resolveBlockSize = (value, compression) => {
  const fallback = compression === 'zstd' ? DEFAULT_ZSTD_BLOCK_BYTES : DEFAULT_GZIP_BLOCK_BYTES;
  const raw = Number(value);
  const size = Number.isFinite(raw) ? Math.floor(raw) : fallback;
  if (!Number.isFinite(size) || size <= 0) return fallback;
  return Math.min(MAX_BLOCK_BYTES, Math.max(MIN_BLOCK_BYTES, size));
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
  };
  const release = () => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(); // transfer the already-counted slot
    else inFlight = Math.max(0, inFlight - 1);
  };
  const abort = (err) => {
    while (waiters.length) {
      waiters.shift().reject(err);
    }
  };
  return { acquire, release, abort };
};

export const createJsonlBatchWriter = (filePath, options = {}) => {
  const {
    compression = null,
    atomic = false,
    gzipOptions = null,
    highWaterMark = null,
    signal = null,
    preallocateBytes = null,
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
    gzipOptions,
    atomic,
    highWaterMark,
    signal,
    preallocateBytes
  });

  let ownedPool = false;
  let compressionPool = pool || (useWorkerCompression ? borrowJsonlCompressionPool(options) : null);
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
      1,
      workerMaxInFlight != null && Number.isFinite(Number(workerMaxInFlight))
        ? Math.max(1, Math.floor(Number(workerMaxInFlight)))
        : compressionPool.size * 2
    )
    : 0;
  const semaphore = useWorkerCompression ? createSemaphore(maxInFlight) : null;

  const pendingChunks = [];
  let pendingBytes = 0;
  let pendingLease = null;
  let nextBlockId = 0;
  let nextToWrite = 0;
  let pendingBlocks = 0;
  const ready = new Map();
  const drainWaiters = [];
  let flushInProgress = false;
  let flushQueued = false;
  let closed = false;
  let failed = null;
  let failPromise = null;

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
    if (failPromise) {
      await failPromise;
      return;
    }
    failPromise = (async () => {
      if (!failed) {
        failed = err || new Error('JSONL write failed');
      }
      closed = true;
      if (semaphore) semaphore.abort(failed);
      rejectDrain(failed);
      for (const block of ready.values()) block.lease?.release();
      ready.clear();
      pendingLease?.release(); pendingLease = null;
      pendingChunks.length = 0; pendingBytes = 0;
      pendingBlocks = 0;
      try { stream.destroy(failed); } catch {}
      try { await done; } catch {}
      if (ownedPool && compressionPool) {
        await compressionPool.close();
        compressionPool = null;
      }
    })();
    await failPromise;
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
          const { data, lease } = ready.get(nextToWrite);
          ready.delete(nextToWrite);
          try { await writeChunk(stream, data); } finally { lease?.release(); }
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

  const enqueueCompressedBlock = async (block, lease) => {
    if (!compressionPool) {
      throw new Error('Missing compression pool.');
    }
    await semaphore.acquire();
    if (failed) {
      if (semaphore) semaphore.release();
      lease?.release();
      throw failed;
    }
    const blockId = nextBlockId;
    nextBlockId += 1;
    pendingBlocks += 1;
    compressionPool
      .compress(block, { signal, lease })
      .then((compressed) => {
        if (failed) { lease?.release(); return; }
        ready.set(blockId, { data: compressed, lease });
        flushReady();
      })
      .catch(async (err) => {
        lease?.release();
        if (semaphore) semaphore.release();
        pendingBlocks = Math.max(0, pendingBlocks - 1);
        await fail(err);
      });
  };

  const flushBuffer = async () => {
    if (!pendingBytes) return;
    const block = Buffer.concat(pendingChunks, pendingBytes);
    const lease = pendingLease; pendingLease = null;
    pendingChunks.length = 0;
    pendingBytes = 0;
    if (!useWorkerCompression) {
      await writeChunk(stream, block);
      return;
    }
    try { await enqueueCompressedBlock(block, lease); } catch (error) { lease?.release(); throw error; }
  };

  const writeLine = async (line, lineBytes = null) => {
    if (failed) throw failed;
    if (closed) throw new Error('JSONL writer closed.');
    const buffer = Buffer.isBuffer(line) ? line : Buffer.from(line, 'utf8');
    // Encoded bytes own admission. Even one oversized line is sliced into
    // bounded codec blocks; concatenated frames preserve the exact JSONL bytes.
    for (const source of [buffer, NEWLINE]) {
      let offset = 0;
      while (offset < source.length) {
        if (useWorkerCompression && !pendingLease && compressionPool.acquireBlock) {
          pendingLease = await compressionPool.acquireBlock(resolvedBlockSize, signal);
        }
        if (failed) { pendingLease?.release(); pendingLease = null; throw failed; }
        const length = Math.min(source.length - offset, resolvedBlockSize - pendingBytes);
        pendingChunks.push(source.subarray(offset, offset + length)); pendingBytes += length; offset += length;
        if (pendingBytes >= resolvedBlockSize) await flushBuffer();
      }
    }
  };

  const attachAbortHandler = () => {
    if (!signal) return () => {};
    const handler = () => {
      fail(createAbortError());
    };
    signal.addEventListener('abort', handler, { once: true });
    if (signal.aborted) handler();
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
        if (ownedPool && compressionPool?.waitForIdle) {
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
