import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createTempPath, replaceDir } from './atomic.js';
import { createJsonlBatchWriter } from './jsonl-batch.js';
import { borrowJsonlCompressionPool } from './jsonl-compression-scope.js';
import { createJsonlCompressionPool } from './jsonl-compression-pool.js';
import { createOffsetsWriter } from './offsets.js';
import { throwIfAborted } from './runtime.js';
import { removePathWithRetry } from '../io/remove-path-with-retry.js';
import { resolveJsonlExtension, resolveJsonlLine } from './jsonl-write.js';
import { removeMergeDiskDirectory } from '../merge-disk.js';

const normalizeShardLimit = (value) => (
  Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0
);

const resolveShardLimits = ({ maxBytes, maxItems }) => ({
  maxBytes: normalizeShardLimit(maxBytes),
  maxItems: normalizeShardLimit(maxItems)
});

const JSONL_PREALLOCATE_THRESHOLD_BYTES = 16 * 1024 * 1024;

const resolveJsonlPartPreallocateBytes = ({ compression, maxBytes, preallocatePartBytes }) => {
  if (compression) return 0;
  const explicit = normalizeShardLimit(preallocatePartBytes);
  if (explicit > 0) return explicit;
  const shardCap = normalizeShardLimit(maxBytes);
  if (shardCap >= JSONL_PREALLOCATE_THRESHOLD_BYTES) return shardCap;
  return 0;
};

const removeTempDirOrThrow = async (targetPath) => {
  const removed = await removePathWithRetry(targetPath, { recursive: true, force: true });
  if (!removed.ok) {
    throw removed.error || new Error(`Failed to remove temporary directory: ${targetPath}`);
  }
};

const validateOffsetsConfig = (offsets, compression) => {
  if (offsets && compression) {
    throw new Error('JSONL offsets require uncompressed output (compressed shards must be scanned).');
  }
};

const createShardedWriterState = ({
  tempPartsDir,
  partsDirName,
  partPrefix,
  compression,
  gzipOptions,
  highWaterMark,
  signal,
  offsets,
  pool,
  preallocateBytes
}) => {
  const extension = resolveJsonlExtension(compression);
  const parts = [];
  const counts = [];
  const bytes = [];
  const offsetsParts = [];
  let total = 0;
  let totalBytes = 0;
  let partIndex = -1;
  let partCount = 0;
  let partLogicalBytes = 0;
  let current = null;
  let offsetsWriter = null;

  const closePart = async () => {
    if (!current) return;
    await current.close();
    if (offsetsWriter) {
      await offsetsWriter.close();
      offsetsWriter = null;
    }
    const partBytes = Number(current.getBytesWritten?.() || 0);
    bytes[bytes.length - 1] = partBytes;
    totalBytes += partBytes;
    current = null;
  };

  const openPart = () => {
    partIndex += 1;
    partCount = 0;
    partLogicalBytes = 0;
    const partName = `${partPrefix}${String(partIndex).padStart(5, '0')}.${extension}`;
    const absPath = path.join(tempPartsDir, partName);
    const relPath = path.posix.join(partsDirName, partName);
    parts.push(relPath);
    counts.push(0);
    bytes.push(0);
    current = createJsonlBatchWriter(absPath, {
      compression,
      atomic: false,
      gzipOptions,
      highWaterMark,
      signal,
      pool,
      preallocateBytes
    });
    if (offsets) {
      const suffix = typeof offsets.suffix === 'string' ? offsets.suffix : 'offsets.bin';
      const offsetsName = `${partName}.${suffix}`;
      const offsetsAbs = path.join(tempPartsDir, offsetsName);
      const offsetsRel = path.posix.join(partsDirName, offsetsName);
      offsetsParts.push(offsetsRel);
      offsetsWriter = createOffsetsWriter(offsetsAbs, {
        atomic: false,
        highWaterMark
      });
    }
  };

  return {
    get current() { return current; },
    get offsetsWriter() { return offsetsWriter; },
    get partCount() { return partCount; },
    get partLogicalBytes() { return partLogicalBytes; },
    get hasOffsets() { return Boolean(offsets); },
    get parts() { return parts; },
    get counts() { return counts; },
    get bytes() { return bytes; },
    get offsetsParts() { return offsetsParts; },
    get total() { return total; },
    get totalBytes() { return totalBytes; },
    async closePart() { await closePart(); },
    openPart,
    async writeItem(lineBuffer, lineBytes) {
      if (offsetsWriter) {
        await offsetsWriter.writeOffset(partLogicalBytes);
      }
      await current.writeLine(lineBuffer, lineBytes);
      partCount += 1;
      partLogicalBytes += lineBytes;
      total += 1;
      counts[counts.length - 1] = partCount;
    },
    async destroy(err) {
      if (current) {
        try { await current.destroy(err); } catch {}
      }
      if (offsetsWriter) {
        await offsetsWriter.destroy(err);
        offsetsWriter = null;
      }
    },
    snapshot(resolvedMaxBytes, partsDir) {
      return {
        parts,
        counts,
        bytes,
        total,
        totalBytes,
        partsDir,
        maxPartRecords: counts.length ? Math.max(...counts) : 0,
        maxPartBytes: bytes.length ? Math.max(...bytes) : 0,
        targetMaxBytes: resolvedMaxBytes > 0 ? resolvedMaxBytes : null,
        ...(offsetsParts.length ? { offsets: offsetsParts } : {})
      };
    }
  };
};

const writeItemToShard = async ({
  state,
  item,
  signal,
  resolvedMaxItems,
  resolvedMaxBytes,
  partsDirName,
  diskAccount = null
}) => {
  throwIfAborted(signal);
  const line = resolveJsonlLine(item);
  const lineBuffer = Buffer.from(line, 'utf8');
  const lineBytes = lineBuffer.length + 1;
  diskAccount?.reserve(lineBytes + (state.hasOffsets ? 8 : 0));
  const needsNewPart = state.current
    && ((resolvedMaxItems && state.partCount >= resolvedMaxItems)
      || (resolvedMaxBytes && (state.partLogicalBytes + lineBytes) > resolvedMaxBytes));
  if (!state.current || needsNewPart) {
    await state.closePart();
    state.openPart();
  }
  await state.writeItem(lineBuffer, lineBytes);
  if (resolvedMaxBytes && lineBytes > resolvedMaxBytes && state.partCount === 1) {
    const err = new Error(`JSONL entry exceeds maxBytes (${lineBytes} > ${resolvedMaxBytes}) in ${partsDirName}`);
    err.code = 'ERR_JSON_TOO_LARGE';
    throw err;
  }
};

const runShardedWrite = async (input, useAsyncIterable) => {
  const {
    dir,
    partsDirName,
    partPrefix,
    items,
    maxBytes,
    maxItems = 0,
    compression = null,
    gzipOptions = null,
    highWaterMark = null,
    signal = null,
    offsets = null,
    preallocatePartBytes = null,
    diskAccount = null
  } = input || {};
  const resolvedCompression = compression === 'none' ? null : compression;
  if (diskAccount && (typeof diskAccount.reserve !== 'function' || typeof diskAccount.release !== 'function' || resolvedCompression)) {
    throw new TypeError('Shared sharded disk admission requires an uncompressed writer and reserve/release owner.');
  }
  throwIfAborted(signal);
  validateOffsetsConfig(offsets, resolvedCompression);
  const { maxBytes: resolvedMaxBytes, maxItems: resolvedMaxItems } = resolveShardLimits({ maxBytes, maxItems });
  const resolvedPartPreallocateBytes = diskAccount ? 0 : resolveJsonlPartPreallocateBytes({
    compression: resolvedCompression,
    maxBytes: resolvedMaxBytes,
    preallocatePartBytes
  });
  const partsDir = path.join(dir, partsDirName);
  const tempPartsDir = createTempPath(partsDir);
  await removeTempDirOrThrow(tempPartsDir);
  await fsPromises.mkdir(tempPartsDir, { recursive: true });

  let compressionPool = input?.pool || null;
  let ownedCompressionPool = false;
  const closeCompressionPool = async () => {
    if (!compressionPool || !ownedCompressionPool) return;
    await compressionPool.close();
    compressionPool = null;
  };
  if (resolvedCompression === 'zstd' && !compressionPool) {
    const codecOptions = { compression: resolvedCompression, gzipOptions };
    compressionPool = borrowJsonlCompressionPool(codecOptions);
    if (!compressionPool) { compressionPool = createJsonlCompressionPool(codecOptions); ownedCompressionPool = true; }
  }

  const state = createShardedWriterState({
    tempPartsDir,
    partsDirName,
    partPrefix,
    compression: resolvedCompression,
    gzipOptions,
    highWaterMark,
    signal,
    offsets,
    pool: compressionPool,
    preallocateBytes: resolvedPartPreallocateBytes
  });

  try {
    if (useAsyncIterable) {
      for await (const item of items) {
        await writeItemToShard({
          state,
          item,
          signal,
          resolvedMaxItems,
          resolvedMaxBytes,
          partsDirName,
          diskAccount
        });
        if (resolvedMaxBytes && state.partLogicalBytes >= resolvedMaxBytes) {
          await state.closePart();
        }
        throwIfAborted(signal);
      }
    } else {
      const iterator = items?.[Symbol.iterator] ? items[Symbol.iterator]() : null;
      if (!iterator) {
        throw new Error('writeJsonLinesSharded requires a synchronous iterable.');
      }
      let primary = null, completed = false;
      try {
        throwIfAborted(signal);
        let next = iterator.next();
        while (!next.done) {
          // Consume this yield before advancing a producer that may reuse its
          // outer row, nested values, or clear its storage when returning done.
          await writeItemToShard({
            state,
            item: next.value,
            signal,
            resolvedMaxItems,
            resolvedMaxBytes,
            partsDirName,
            diskAccount
          });
          if (resolvedMaxBytes && state.partLogicalBytes >= resolvedMaxBytes) {
            await state.closePart();
          }
          throwIfAborted(signal);
          next = iterator.next();
        }
        completed = true;
      } catch (error) { primary = error; throw error; }
      finally {
        try { if (!completed) await iterator.return?.(); }
        catch (error) {
          if (!primary) throw error;
          if (typeof primary === 'object' && Object.isExtensible(primary)) primary.cleanupError ||= error;
        }
      }
    }
    await state.closePart();
    const promoted = await replaceDir(tempPartsDir, partsDir, {
      keepBackup: Boolean(diskAccount), allowCopyFallback: !diskAccount
    });
    if (promoted?.backupPath) await removeMergeDiskDirectory(promoted.backupPath, diskAccount);
    return state.snapshot(resolvedMaxBytes, partsDir);
  } catch (err) {
    try { await state.destroy(err); }
    catch (error) { if (err && typeof err === 'object' && Object.isExtensible(err)) err.cleanupError ||= error; }
    try { await removeTempDirOrThrow(tempPartsDir); }
    catch (error) { if (err && typeof err === 'object' && Object.isExtensible(err)) err.cleanupError ||= error; }
    throw err;
  } finally {
    await closeCompressionPool();
  }
};

/** The current yield is encoded and admitted before requesting another row.
 * Producers may reuse their row/storage when next() is called again; the writer
 * retains only its owned encoded bytes in bounded output/codec buffers.
 */
export async function writeJsonLinesSharded(input) {
  return runShardedWrite(input, false);
}

export async function writeJsonLinesShardedAsync(input) {
  return runShardedWrite(input, true);
}
