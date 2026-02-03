import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createTempPath, replaceFile } from './json-stream/atomic.js';
import { writeJsonValue, stringifyJsonValue, writeArrayItems } from './json-stream/encode.js';
import { createJsonWriteStream, writeChunk } from './json-stream/streams.js';
import { throwIfAborted } from './json-stream/runtime.js';

export { createTempPath, replaceFile };

/**
 * Stream JSON lines to disk (one JSON object per line).
 * @param {string} filePath
 * @param {Iterable<any>} items
 * @param {{trailingNewline?:boolean,compression?:string|null,atomic?:boolean,gzipOptions?:object,highWaterMark?:number,signal?:AbortSignal}} [options]
 * @returns {Promise<void>}
 */
export async function writeJsonLinesFile(filePath, items, options = {}) {
  const {
    compression = null,
    atomic = false,
    gzipOptions = null,
    highWaterMark = null,
    signal = null
  } = options;
  const { stream, done } = createJsonWriteStream(filePath, {
    compression,
    atomic,
    gzipOptions,
    highWaterMark,
    signal
  });
  try {
    for (const item of items) {
      throwIfAborted(signal);
      await writeJsonValue(stream, item);
      await writeChunk(stream, '\n');
    }
    stream.end();
    await done;
  } catch (err) {
    try { stream.destroy(err); } catch {}
    try { await done; } catch {}
    throw err;
  }
}

/**
 * Stream JSON lines into sharded JSONL files.
 * @param {{dir:string,partsDirName:string,partPrefix:string,items:Iterable<any>,maxBytes:number,maxItems?:number,atomic?:boolean,compression?:string|null,gzipOptions?:object,highWaterMark?:number,signal?:AbortSignal}} input
 * @returns {Promise<{parts:string[],counts:number[],bytes:number[],total:number,totalBytes:number,partsDir:string,maxPartRecords:number,maxPartBytes:number,targetMaxBytes:number|null}>}
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
    signal = null
  } = input || {};
  const resolvedMaxBytes = Number.isFinite(Number(maxBytes)) ? Math.max(0, Math.floor(Number(maxBytes))) : 0;
  const resolvedMaxItems = Number.isFinite(Number(maxItems)) ? Math.max(0, Math.floor(Number(maxItems))) : 0;
  const partsDir = path.join(dir, partsDirName);
  await fsPromises.rm(partsDir, { recursive: true, force: true });
  await fsPromises.mkdir(partsDir, { recursive: true });

  const resolveJsonlExtension = (value) => {
    if (value === 'gzip') return 'jsonl.gz';
    if (value === 'zstd') return 'jsonl.zst';
    return 'jsonl';
  };
  const extension = resolveJsonlExtension(compression);

  const parts = [];
  const counts = [];
  const bytes = [];
  let total = 0;
  let totalBytes = 0;
  let partIndex = -1;
  let partCount = 0;
  let partBytes = 0;
  let partLogicalBytes = 0;
  let current = null;
  let currentPath = null;

  const closePart = async () => {
    if (!current) return;
    current.stream.end();
    await current.done;
    if (currentPath) {
      try {
        const stat = await fsPromises.stat(currentPath);
        bytes[bytes.length - 1] = stat.size;
        totalBytes += stat.size;
      } catch {}
    }
    current = null;
    currentPath = null;
  };

  const openPart = () => {
    partIndex += 1;
    partCount = 0;
    partBytes = 0;
    partLogicalBytes = 0;
    const partName = `${partPrefix}${String(partIndex).padStart(5, '0')}.${extension}`;
    const absPath = path.join(partsDir, partName);
    const relPath = path.posix.join(partsDirName, partName);
    parts.push(relPath);
    counts.push(0);
    bytes.push(0);
    current = createJsonWriteStream(absPath, {
      atomic,
      compression,
      gzipOptions,
      highWaterMark,
      signal
    });
    currentPath = absPath;
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
      const line = stringifyJsonValue(item);
      const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
      const needsNewPart = current
        && ((resolvedMaxItems && partCount >= resolvedMaxItems)
          || (resolvedMaxBytes && (partLogicalBytes + lineBytes) > resolvedMaxBytes));
      if (!current || needsNewPart) {
        await closePart();
        openPart();
      }
      await writeChunk(current.stream, line);
      await writeChunk(current.stream, '\n');
      partCount += 1;
      partBytes = current.getBytesWritten();
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
  } catch (err) {
    if (current?.stream) {
      try { current.stream.destroy(err); } catch {}
      try { await current.done; } catch {}
    }
    throw err;
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
    targetMaxBytes
  };
}

/**
 * Stream a JSON array to disk without holding the full string in memory.
 * @param {string} filePath
 * @param {Iterable<any>} items
 * @param {{trailingNewline?:boolean,compression?:string|null,atomic?:boolean,gzipOptions?:object,highWaterMark?:number,signal?:AbortSignal}} [options]
 * @returns {Promise<void>}
 */
export async function writeJsonArrayFile(filePath, items, options = {}) {
  const {
    trailingNewline = true,
    compression = null,
    atomic = false,
    gzipOptions = null,
    highWaterMark = null,
    signal = null
  } = options;
  const { stream, done } = createJsonWriteStream(filePath, {
    compression,
    atomic,
    gzipOptions,
    highWaterMark,
    signal
  });
  try {
    await writeChunk(stream, '[');
    await writeArrayItems(stream, items, signal);
    await writeChunk(stream, ']');
    if (trailingNewline) await writeChunk(stream, '\n');
    stream.end();
    await done;
  } catch (err) {
    try { stream.destroy(err); } catch {}
    try { await done; } catch {}
    throw err;
  }
}

/**
 * Stream a JSON object with one or more array fields to disk.
 * @param {string} filePath
 * @param {{fields?:object,arrays?:object,trailingNewline?:boolean,compression?:string|null,atomic?:boolean,gzipOptions?:object,highWaterMark?:number,signal?:AbortSignal}} input
 * @returns {Promise<void>}
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
    signal = null
  } = input;
  const { stream, done } = createJsonWriteStream(filePath, {
    compression,
    atomic,
    gzipOptions,
    highWaterMark,
    signal
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
  } catch (err) {
    try { stream.destroy(err); } catch {}
    try { await done; } catch {}
    throw err;
  }
}
