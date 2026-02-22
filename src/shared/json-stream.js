import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createTempPath, replaceDir, replaceFile } from './json-stream/atomic.js';
import { writeJsonValue, stringifyJsonValue, writeArrayItems } from './json-stream/encode.js';
import { createJsonWriteStream, writeChunk } from './json-stream/streams.js';
import { createJsonlBatchWriter, createJsonlCompressionPool } from './json-stream/jsonl-batch.js';
import { throwIfAborted } from './json-stream/runtime.js';
import { createOffsetsWriter } from './json-stream/offsets.js';

export { createTempPath, replaceFile };

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

/**
 * Prefer a cached JSONL payload when producers have already serialized a row.
 * This keeps fanout writers from paying `JSON.stringify` repeatedly for
 * identical row objects.
 *
 * @param {any} item
 * @returns {string}
 */
const resolveJsonlLine = (item) => {
  if (item && typeof item === 'object' && typeof item.__jsonl === 'string') {
    return item.__jsonl;
  }
  return stringifyJsonValue(item);
};

export const resolveJsonlExtension = (value) => {
  if (value === 'gzip') return 'jsonl.gz';
  if (value === 'zstd') return 'jsonl.zst';
  return 'jsonl';
};

/**
 * Stream JSON lines to disk (one JSON object per line).
 * @param {string} filePath
 * @param {Iterable<any>} items
 * @param {{trailingNewline?:boolean,compression?:string|null,atomic?:boolean,gzipOptions?:object,highWaterMark?:number,signal?:AbortSignal,offsets?:{path:string,atomic?:boolean},maxBytes?:number,preallocateBytes?:number}} [options]
 * @returns {Promise<void>}
 */
export async function writeJsonLinesFile(filePath, items, options = {}) {
  const {
    compression = null,
    atomic = false,
    gzipOptions = null,
    highWaterMark = null,
    signal = null,
    offsets = null,
    maxBytes = null,
    preallocateBytes = null
  } = options;
  const resolvedMaxBytes = Number.isFinite(Number(maxBytes)) ? Math.max(0, Math.floor(Number(maxBytes))) : 0;
  if (offsets?.path && compression) {
    throw new Error('JSONL offsets require uncompressed output (compressed shards must be scanned).');
  }
  const writer = createJsonlBatchWriter(filePath, {
    compression,
    atomic,
    gzipOptions,
    highWaterMark,
    signal,
    preallocateBytes
  });
  const offsetsWriter = offsets?.path
    ? createOffsetsWriter(offsets.path, { atomic: offsets.atomic ?? atomic, highWaterMark })
    : null;
  let bytesWritten = 0;
  try {
    for (const item of items) {
      throwIfAborted(signal);
      const line = resolveJsonlLine(item);
      const lineBuffer = Buffer.from(line, 'utf8');
      const lineBytes = lineBuffer.length + 1;
      if (resolvedMaxBytes && lineBytes > resolvedMaxBytes) {
        const err = new Error(`JSONL entry exceeds maxBytes (${lineBytes} > ${resolvedMaxBytes}).`);
        err.code = 'ERR_JSON_TOO_LARGE';
        throw err;
      }
      if (offsetsWriter) {
        await offsetsWriter.writeOffset(bytesWritten);
      }
      await writer.writeLine(lineBuffer, lineBytes);
      bytesWritten += lineBytes;
    }
    await writer.close();
    if (offsetsWriter) {
      await offsetsWriter.close();
    }
  } catch (err) {
    try { await writer.destroy(err); } catch {}
    if (offsetsWriter) {
      await offsetsWriter.destroy(err);
    }
    throw err;
  }
}

/**
 * Stream JSON lines to disk from an async iterable.
 * @param {string} filePath
 * @param {AsyncIterable<any>|Iterable<any>} items
 * @param {{trailingNewline?:boolean,compression?:string|null,atomic?:boolean,gzipOptions?:object,highWaterMark?:number,signal?:AbortSignal,offsets?:{path:string,atomic?:boolean},maxBytes?:number,preallocateBytes?:number}} [options]
 * @returns {Promise<void>}
 */
export async function writeJsonLinesFileAsync(filePath, items, options = {}) {
  const {
    compression = null,
    atomic = false,
    gzipOptions = null,
    highWaterMark = null,
    signal = null,
    offsets = null,
    maxBytes = null,
    preallocateBytes = null
  } = options;
  const resolvedMaxBytes = Number.isFinite(Number(maxBytes)) ? Math.max(0, Math.floor(Number(maxBytes))) : 0;
  if (offsets?.path && compression) {
    throw new Error('JSONL offsets require uncompressed output (compressed shards must be scanned).');
  }
  const writer = createJsonlBatchWriter(filePath, {
    compression,
    atomic,
    gzipOptions,
    highWaterMark,
    signal,
    preallocateBytes
  });
  const offsetsWriter = offsets?.path
    ? createOffsetsWriter(offsets.path, { atomic: offsets.atomic ?? atomic, highWaterMark })
    : null;
  let bytesWritten = 0;
  try {
    for await (const item of items) {
      throwIfAborted(signal);
      const line = resolveJsonlLine(item);
      const lineBuffer = Buffer.from(line, 'utf8');
      const lineBytes = lineBuffer.length + 1;
      if (resolvedMaxBytes && lineBytes > resolvedMaxBytes) {
        const err = new Error(`JSONL entry exceeds maxBytes (${lineBytes} > ${resolvedMaxBytes}).`);
        err.code = 'ERR_JSON_TOO_LARGE';
        throw err;
      }
      if (offsetsWriter) {
        await offsetsWriter.writeOffset(bytesWritten);
      }
      await writer.writeLine(lineBuffer, lineBytes);
      bytesWritten += lineBytes;
    }
    await writer.close();
    if (offsetsWriter) {
      await offsetsWriter.close();
    }
  } catch (err) {
    try { await writer.destroy(err); } catch {}
    if (offsetsWriter) {
      await offsetsWriter.destroy(err);
    }
    throw err;
  }
}

/**
 * Stream JSON lines into sharded JSONL files.
 * @param {{dir:string,partsDirName:string,partPrefix:string,items:Iterable<any>,maxBytes:number,maxItems?:number,atomic?:boolean,compression?:string|null,gzipOptions?:object,highWaterMark?:number,signal?:AbortSignal,offsets?:{suffix?:string,atomic?:boolean},preallocatePartBytes?:number}} input
 * @returns {Promise<{parts:string[],counts:number[],bytes:number[],total:number,totalBytes:number,partsDir:string,maxPartRecords:number,maxPartBytes:number,targetMaxBytes:number|null,offsets?:string[]}>}
 */
export async function writeJsonLinesSharded(input) {
  const {
    dir,
    partsDirName,
    partPrefix,
    items,
    maxBytes,
    maxItems = 0,
    atomic = false,
    compression = null,
    gzipOptions = null,
    highWaterMark = null,
    signal = null,
    offsets = null,
    preallocatePartBytes = null
  } = input || {};
  const resolvedCompression = compression === 'none' ? null : compression;
  if (offsets && resolvedCompression) {
    throw new Error('JSONL offsets require uncompressed output (compressed shards must be scanned).');
  }
  const { maxBytes: resolvedMaxBytes, maxItems: resolvedMaxItems } = resolveShardLimits({ maxBytes, maxItems });
  const resolvedPartPreallocateBytes = resolveJsonlPartPreallocateBytes({
    compression: resolvedCompression,
    maxBytes: resolvedMaxBytes,
    preallocatePartBytes
  });
  const partsDir = path.join(dir, partsDirName);
  const tempPartsDir = createTempPath(partsDir);
  await fsPromises.rm(tempPartsDir, { recursive: true, force: true });
  await fsPromises.mkdir(tempPartsDir, { recursive: true });

  const extension = resolveJsonlExtension(resolvedCompression);

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
      compression: resolvedCompression,
      // Parts are written into a staging directory that is atomically swapped.
      // Avoid per-part atomic temp+rename overhead inside that staging directory.
      atomic: false,
      gzipOptions,
      highWaterMark,
      signal,
      pool: compressionPool,
      preallocateBytes: resolvedPartPreallocateBytes
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

  const iterator = items?.[Symbol.iterator] ? items[Symbol.iterator]() : null;
  if (!iterator) {
    throw new Error('writeJsonLinesSharded requires a synchronous iterable.');
  }
  let next = iterator.next();
  try {
    while (!next.done) {
      throwIfAborted(signal);
      const item = next.value;
      next = iterator.next();
      const hasMore = !next.done;
      const line = resolveJsonlLine(item);
      const lineBuffer = Buffer.from(line, 'utf8');
      const lineBytes = lineBuffer.length + 1;
      const needsNewPart = current
        && ((resolvedMaxItems && partCount >= resolvedMaxItems)
          || (resolvedMaxBytes && (partLogicalBytes + lineBytes) > resolvedMaxBytes));
      if (!current || needsNewPart) {
        await closePart();
        openPart();
      }
      if (offsetsWriter) {
        await offsetsWriter.writeOffset(partLogicalBytes);
      }
      await current.writeLine(lineBuffer, lineBytes);
      partCount += 1;
      partLogicalBytes += lineBytes;
      total += 1;
      counts[counts.length - 1] = partCount;
      if (resolvedMaxBytes && lineBytes > resolvedMaxBytes && partCount === 1) {
        const err = new Error(
          `JSONL entry exceeds maxBytes (${lineBytes} > ${resolvedMaxBytes}) in ${partsDirName}`
        );
        err.code = 'ERR_JSON_TOO_LARGE';
        throw err;
      }
      if (resolvedMaxBytes && partLogicalBytes >= resolvedMaxBytes && hasMore) {
        await closePart();
        openPart();
      }
    }
    await closePart();
    await replaceDir(tempPartsDir, partsDir);
  } catch (err) {
    if (current) {
      try { await current.destroy(err); } catch {}
    }
    if (offsetsWriter) {
      await offsetsWriter.destroy(err);
      offsetsWriter = null;
    }
    try { await fsPromises.rm(tempPartsDir, { recursive: true, force: true }); } catch {}
    throw err;
  } finally {
    await closeCompressionPool();
  }

  const maxPartRecords = counts.length ? Math.max(...counts) : 0;
  const maxPartBytes = bytes.length ? Math.max(...bytes) : 0;
  const targetMaxBytes = resolvedMaxBytes > 0 ? resolvedMaxBytes : null;
  return {
    parts,
    counts,
    bytes,
    total,
    totalBytes,
    partsDir,
    maxPartRecords,
    maxPartBytes,
    targetMaxBytes,
    ...(offsetsParts.length ? { offsets: offsetsParts } : {})
  };
}

/**
 * Stream JSON lines into sharded JSONL files from an async iterable.
 * @param {{dir:string,partsDirName:string,partPrefix:string,items:AsyncIterable<any>|Iterable<any>,maxBytes:number,maxItems?:number,atomic?:boolean,compression?:string|null,gzipOptions?:object,highWaterMark?:number,signal?:AbortSignal,offsets?:{suffix?:string,atomic?:boolean},preallocatePartBytes?:number}} input
 * @returns {Promise<{parts:string[],counts:number[],bytes:number[],total:number,totalBytes:number,partsDir:string,maxPartRecords:number,maxPartBytes:number,targetMaxBytes:number|null,offsets?:string[]}>}
 */
export async function writeJsonLinesShardedAsync(input) {
  const {
    dir,
    partsDirName,
    partPrefix,
    items,
    maxBytes,
    maxItems = 0,
    atomic = false,
    compression = null,
    gzipOptions = null,
    highWaterMark = null,
    signal = null,
    offsets = null,
    preallocatePartBytes = null
  } = input || {};
  const resolvedCompression = compression === 'none' ? null : compression;
  if (offsets && resolvedCompression) {
    throw new Error('JSONL offsets require uncompressed output (compressed shards must be scanned).');
  }
  const { maxBytes: resolvedMaxBytes, maxItems: resolvedMaxItems } = resolveShardLimits({ maxBytes, maxItems });
  const resolvedPartPreallocateBytes = resolveJsonlPartPreallocateBytes({
    compression: resolvedCompression,
    maxBytes: resolvedMaxBytes,
    preallocatePartBytes
  });
  const partsDir = path.join(dir, partsDirName);
  const tempPartsDir = createTempPath(partsDir);
  await fsPromises.rm(tempPartsDir, { recursive: true, force: true });
  await fsPromises.mkdir(tempPartsDir, { recursive: true });

  const extension = resolveJsonlExtension(resolvedCompression);

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
      compression: resolvedCompression,
      // Parts are written into a staging directory that is atomically swapped.
      // Avoid per-part atomic temp+rename overhead inside that staging directory.
      atomic: false,
      gzipOptions,
      highWaterMark,
      signal,
      pool: compressionPool,
      preallocateBytes: resolvedPartPreallocateBytes
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

  try {
    for await (const item of items) {
      throwIfAborted(signal);
      const line = resolveJsonlLine(item);
      const lineBuffer = Buffer.from(line, 'utf8');
      const lineBytes = lineBuffer.length + 1;
      const needsNewPart = current
        && ((resolvedMaxItems && partCount >= resolvedMaxItems)
          || (resolvedMaxBytes && (partLogicalBytes + lineBytes) > resolvedMaxBytes));
      if (!current || needsNewPart) {
        await closePart();
        openPart();
      }
      if (offsetsWriter) {
        await offsetsWriter.writeOffset(partLogicalBytes);
      }
      await current.writeLine(lineBuffer, lineBytes);
      partCount += 1;
      partLogicalBytes += lineBytes;
      total += 1;
      counts[counts.length - 1] = partCount;
      if (resolvedMaxBytes && lineBytes > resolvedMaxBytes && partCount === 1) {
        const err = new Error(
          `JSONL entry exceeds maxBytes (${lineBytes} > ${resolvedMaxBytes}) in ${partsDirName}`
        );
        err.code = 'ERR_JSON_TOO_LARGE';
        throw err;
      }
      if (resolvedMaxBytes && partLogicalBytes >= resolvedMaxBytes) {
        await closePart();
      }
    }
    await closePart();
    await replaceDir(tempPartsDir, partsDir);
  } catch (err) {
    if (current) {
      try { await current.destroy(err); } catch {}
    }
    if (offsetsWriter) {
      await offsetsWriter.destroy(err);
      offsetsWriter = null;
    }
    try { await fsPromises.rm(tempPartsDir, { recursive: true, force: true }); } catch {}
    throw err;
  } finally {
    await closeCompressionPool();
  }

  const maxPartRecords = counts.length ? Math.max(...counts) : 0;
  const maxPartBytes = bytes.length ? Math.max(...bytes) : 0;
  const targetMaxBytes = resolvedMaxBytes > 0 ? resolvedMaxBytes : null;
  return {
    parts,
    counts,
    bytes,
    total,
    totalBytes,
    partsDir,
    maxPartRecords,
    maxPartBytes,
    targetMaxBytes,
    ...(offsetsParts.length ? { offsets: offsetsParts } : {})
  };
}

/**
 * Stream a JSON array to disk without holding the full string in memory.
 * @param {string} filePath
 * @param {Iterable<any>} items
 * @param {{trailingNewline?:boolean,compression?:string|null,atomic?:boolean,gzipOptions?:object,highWaterMark?:number,signal?:AbortSignal,checksumAlgo?:string|null}} [options]
 * @returns {Promise<{bytes:number,checksum:string|null,checksumAlgo:string|null,checksumHash:string|null}>}
 */
export async function writeJsonArrayFile(filePath, items, options = {}) {
  const {
    trailingNewline = true,
    compression = null,
    atomic = false,
    gzipOptions = null,
    highWaterMark = null,
    signal = null,
    checksumAlgo = null
  } = options;
  const { stream, done, getBytesWritten, getChecksum, checksumAlgo: resolvedChecksumAlgo } = createJsonWriteStream(filePath, {
    compression,
    atomic,
    gzipOptions,
    highWaterMark,
    signal,
    checksumAlgo
  });
  try {
    await writeChunk(stream, '[');
    await writeArrayItems(stream, items, signal);
    await writeChunk(stream, ']');
    if (trailingNewline) await writeChunk(stream, '\n');
    stream.end();
    await done;
    const checksum = typeof getChecksum === 'function' ? getChecksum() : null;
    return {
      bytes: Number.isFinite(getBytesWritten?.()) ? getBytesWritten() : 0,
      checksum: checksum || null,
      checksumAlgo: resolvedChecksumAlgo || null,
      checksumHash: checksum && resolvedChecksumAlgo ? `${resolvedChecksumAlgo}:${checksum}` : null
    };
  } catch (err) {
    try { stream.destroy(err); } catch {}
    try { await done; } catch {}
    throw err;
  }
}

/**
 * Stream a JSON object with one or more array fields to disk.
 * @param {string} filePath
 * @param {{fields?:object,arrays?:object,trailingNewline?:boolean,compression?:string|null,atomic?:boolean,gzipOptions?:object,highWaterMark?:number,signal?:AbortSignal,checksumAlgo?:string|null}} input
 * @returns {Promise<{bytes:number,checksum:string|null,checksumAlgo:string|null,checksumHash:string|null}>}
 */
export async function writeJsonObjectFile(filePath, input = {}) {
  const {
    fields = {},
    arrays = {},
    trailingNewline = true,
    compression = null,
    atomic = false,
    gzipOptions = null,
    highWaterMark = null,
    signal = null,
    checksumAlgo = null
  } = input;
  const { stream, done, getBytesWritten, getChecksum, checksumAlgo: resolvedChecksumAlgo } = createJsonWriteStream(filePath, {
    compression,
    atomic,
    gzipOptions,
    highWaterMark,
    signal,
    checksumAlgo
  });
  try {
    await writeChunk(stream, '{');
    let first = true;
    for (const [key, value] of Object.entries(fields)) {
      throwIfAborted(signal);
      if (!first) await writeChunk(stream, ',');
      await writeChunk(stream, `${JSON.stringify(key)}:`);
      await writeJsonValue(stream, value);
      first = false;
    }
    for (const [key, items] of Object.entries(arrays)) {
      throwIfAborted(signal);
      const header = `${JSON.stringify(key)}:[`;
      await writeChunk(stream, `${first ? '' : ','}${header}`);
      first = false;
      await writeArrayItems(stream, items, signal);
      await writeChunk(stream, ']');
    }
    await writeChunk(stream, '}');
    if (trailingNewline) await writeChunk(stream, '\n');
    stream.end();
    await done;
    const checksum = typeof getChecksum === 'function' ? getChecksum() : null;
    return {
      bytes: Number.isFinite(getBytesWritten?.()) ? getBytesWritten() : 0,
      checksum: checksum || null,
      checksumAlgo: resolvedChecksumAlgo || null,
      checksumHash: checksum && resolvedChecksumAlgo ? `${resolvedChecksumAlgo}:${checksum}` : null
    };
  } catch (err) {
    try { stream.destroy(err); } catch {}
    try { await done; } catch {}
    throw err;
  }
}
