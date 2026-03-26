import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createTempPath, replaceDir } from './atomic.js';
import { createJsonlBatchWriter, createJsonlCompressionPool } from './jsonl-batch.js';
import { createOffsetsWriter } from './offsets.js';
import { throwIfAborted } from './runtime.js';
import { removePathWithRetry } from '../io/remove-path-with-retry.js';
import { resolveJsonlExtension, resolveJsonlLine } from './jsonl-write.js';

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
    preallocatePartBytes = null
  } = input || {};
  const resolvedCompression = compression === 'none' ? null : compression;
  validateOffsetsConfig(offsets, resolvedCompression);
  const { maxBytes: resolvedMaxBytes, maxItems: resolvedMaxItems } = resolveShardLimits({ maxBytes, maxItems });
  const resolvedPartPreallocateBytes = resolveJsonlPartPreallocateBytes({
    compression: resolvedCompression,
    maxBytes: resolvedMaxBytes,
    preallocatePartBytes
  });
  const partsDir = path.join(dir, partsDirName);
  const tempPartsDir = createTempPath(partsDir);
  await removeTempDirOrThrow(tempPartsDir);
  await fsPromises.mkdir(tempPartsDir, { recursive: true });

  let compressionPool = null;
  const closeCompressionPool = async () => {
    if (!compressionPool) return;
    await compressionPool.close();
    compressionPool = null;
  };
  if (resolvedCompression) {
    compressionPool = createJsonlCompressionPool({
      compression: resolvedCompression,
      gzipOptions
    });
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
        throwIfAborted(signal);
        const line = resolveJsonlLine(item);
        const lineBuffer = Buffer.from(line, 'utf8');
        const lineBytes = lineBuffer.length + 1;
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
        if (resolvedMaxBytes && state.partLogicalBytes >= resolvedMaxBytes) {
          await state.closePart();
        }
      }
    } else {
      const iterator = items?.[Symbol.iterator] ? items[Symbol.iterator]() : null;
      if (!iterator) {
        throw new Error('writeJsonLinesSharded requires a synchronous iterable.');
      }
      let next = iterator.next();
      while (!next.done) {
        throwIfAborted(signal);
        const item = next.value;
        next = iterator.next();
        const hasMore = !next.done;
        const line = resolveJsonlLine(item);
        const lineBuffer = Buffer.from(line, 'utf8');
        const lineBytes = lineBuffer.length + 1;
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
        if (resolvedMaxBytes && state.partLogicalBytes >= resolvedMaxBytes && hasMore) {
          await state.closePart();
          state.openPart();
        }
      }
    }
    await state.closePart();
    await replaceDir(tempPartsDir, partsDir);
    return state.snapshot(resolvedMaxBytes, partsDir);
  } catch (err) {
    await state.destroy(err);
    try { await removeTempDirOrThrow(tempPartsDir); } catch {}
    throw err;
  } finally {
    await closeCompressionPool();
  }
};

export async function writeJsonLinesSharded(input) {
  return runShardedWrite(input, false);
}

export async function writeJsonLinesShardedAsync(input) {
  return runShardedWrite(input, true);
}
