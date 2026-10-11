import fs from 'node:fs/promises';
import { throwIfAborted } from '../abort.js';
import { parseJsonlLine } from './jsonl.js';
import { MAX_JSON_BYTES } from './constants.js';
import { toJsonTooLargeError } from './limits.js';
import { INTEGER_COERCE_MODE_STRICT, coercePositiveInt } from '../number-coerce.js';

export const OFFSETS_FORMAT_VERSION = 1;
export const OFFSETS_FORMAT = 'u64-le';
export const OFFSETS_COMPRESSION = 'none';

const OFFSET_BYTES = 8;
const MAX_OFFSETS_SPAN_BYTES = 4 * 1024 * 1024;
const JSONL_ROWS_AT_MAX_BATCH_BYTES = 8 * 1024 * 1024;
const OFFSETS_VALIDATION_WINDOW_BYTES = 64 * 1024;
const OFFSETS_VALIDATION_CACHE = new Map();
const OFFSETS_VALIDATION_CACHE_MAX = 256;

const buildValidationCacheKey = (jsonlPath, offsetsPath) => `${jsonlPath}::${offsetsPath}`;

const getCachedOffsetsValidation = (key, jsonlStat, offsetsStat) => {
  if (!key) return null;
  const cached = OFFSETS_VALIDATION_CACHE.get(key);
  if (!cached) return null;
  if (
    cached.jsonlSize !== jsonlStat.size
    || cached.jsonlMtimeMs !== jsonlStat.mtimeMs
    || cached.jsonlCtimeMs !== jsonlStat.ctimeMs
    || cached.offsetsSize !== offsetsStat.size
    || cached.offsetsMtimeMs !== offsetsStat.mtimeMs
    || cached.offsetsCtimeMs !== offsetsStat.ctimeMs
  ) {
    OFFSETS_VALIDATION_CACHE.delete(key);
    return null;
  }
  OFFSETS_VALIDATION_CACHE.delete(key);
  OFFSETS_VALIDATION_CACHE.set(key, cached);
  return cached;
};

const setCachedOffsetsValidation = (key, jsonlStat, offsetsStat) => {
  if (!key) return;
  OFFSETS_VALIDATION_CACHE.set(key, {
    jsonlSize: jsonlStat.size,
    jsonlMtimeMs: jsonlStat.mtimeMs,
    jsonlCtimeMs: jsonlStat.ctimeMs,
    offsetsSize: offsetsStat.size,
    offsetsMtimeMs: offsetsStat.mtimeMs,
    offsetsCtimeMs: offsetsStat.ctimeMs
  });
  while (OFFSETS_VALIDATION_CACHE.size > OFFSETS_VALIDATION_CACHE_MAX) {
    const oldest = OFFSETS_VALIDATION_CACHE.keys().next().value;
    if (oldest === undefined) break;
    OFFSETS_VALIDATION_CACHE.delete(oldest);
  }
};

const readOffsetValue = (buffer, index) => {
  const value = buffer.readBigUInt64LE(index * OFFSET_BYTES);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Offset exceeds MAX_SAFE_INTEGER: ${value.toString()}`);
  }
  return Number(value);
};

const createOffsetsInvalidError = (message) => {
  const err = new Error(message);
  err.code = 'ERR_OFFSETS_INVALID';
  return err;
};

const assertOffsetsAligned = (size, offsetsPath) => {
  if (size % OFFSET_BYTES !== 0) {
    throw createOffsetsInvalidError(`Offsets sidecar misaligned: ${offsetsPath}`);
  }
};

const resolveOffsetCountFromSize = (size, offsetsPath) => {
  assertOffsetsAligned(size, offsetsPath);
  return Math.floor(size / OFFSET_BYTES);
};

const assertExactRead = (bytesRead, expected, message) => {
  if (bytesRead !== expected) {
    throw createOffsetsInvalidError(message);
  }
};

const resolveValidatedMaxBytes = (maxBytes, apiName) => {
  if (typeof maxBytes !== 'number') {
    const err = new Error(`${apiName} maxBytes must be a finite positive number.`);
    err.code = 'ERR_INVALID_MAX_BYTES';
    throw err;
  }
  const resolved = coercePositiveInt(maxBytes, { mode: INTEGER_COERCE_MODE_STRICT });
  if (resolved != null) return resolved;
  const err = new Error(`${apiName} maxBytes must be a finite positive number.`);
  err.code = 'ERR_INVALID_MAX_BYTES';
  throw err;
};

/**
 * Read an entire offsets sidecar into memory.
 * @param {string} offsetsPath
 * @returns {Promise<number[]>}
 */
export const readOffsetsFile = async (offsetsPath) => {
  const data = await fs.readFile(offsetsPath);
  const count = resolveOffsetCountFromSize(data.length, offsetsPath);
  const offsets = new Array(count);
  for (let i = 0; i < count; i += 1) {
    offsets[i] = readOffsetValue(data, i);
  }
  return offsets;
};

const readSingleOffsetAtWithHandle = async (handle, index) => {
  const buffer = Buffer.allocUnsafe(OFFSET_BYTES);
  const { bytesRead } = await handle.read(buffer, 0, OFFSET_BYTES, index * OFFSET_BYTES);
  if (bytesRead === 0) return null;
  if (bytesRead !== OFFSET_BYTES) {
    throw createOffsetsInvalidError(`Offsets sidecar truncated at index ${index}`);
  }
  return readOffsetValue(buffer, 0);
};

const readOffsetsAtWithHandle = async (handle, indexes) => {
  const sorted = Array.from(new Set(indexes.filter((index) => Number.isInteger(index) && index >= 0)))
    .sort((a, b) => a - b);
  if (!sorted.length) return new Map();
  const out = new Map();
  const minIndex = sorted[0];
  const maxIndex = sorted[sorted.length - 1];
  const spanCount = maxIndex - minIndex + 1;
  const spanBytes = spanCount * OFFSET_BYTES;
  if (spanBytes > MAX_OFFSETS_SPAN_BYTES) {
    for (const index of sorted) {
      out.set(index, await readSingleOffsetAtWithHandle(handle, index));
    }
    return out;
  }
  const spanBuffer = Buffer.allocUnsafe(spanBytes);
  const { bytesRead } = await handle.read(spanBuffer, 0, spanBytes, minIndex * OFFSET_BYTES);
  for (const index of sorted) {
    const relative = index - minIndex;
    const offset = relative * OFFSET_BYTES;
    if (offset + OFFSET_BYTES > bytesRead) {
      out.set(index, null);
      continue;
    }
    out.set(index, readOffsetValue(spanBuffer.subarray(offset, offset + OFFSET_BYTES), 0));
  }
  return out;
};

/**
 * Read selected offset rows by index with a coalesced span read.
 * @param {string} offsetsPath
 * @param {number[]} indexes
 * @param {{handle?:import('node:fs/promises').FileHandle|null}} [options]
 * @returns {Promise<Map<number, number|null>>}
 */
export const readOffsetsAt = async (
  offsetsPath,
  indexes,
  { handle = null } = {}
) => {
  if (handle) {
    return readOffsetsAtWithHandle(handle, indexes);
  }
  const ownedHandle = await fs.open(offsetsPath, 'r');
  try {
    return await readOffsetsAtWithHandle(ownedHandle, indexes);
  } finally {
    await ownedHandle.close();
  }
};

/**
 * Read one offset row by index.
 * @param {string} offsetsPath
 * @param {number} index
 * @param {{handle?:import('node:fs/promises').FileHandle|null}} [options]
 * @returns {Promise<number|null>}
 */
export const readOffsetAt = async (
  offsetsPath,
  index,
  { handle = null } = {}
) => {
  if (!Number.isInteger(index) || index < 0) return null;
  const offsets = await readOffsetsAt(offsetsPath, [index], { handle });
  return offsets.get(index) ?? null;
};

/**
 * Resolve row count from an offsets sidecar file.
 * @param {string} offsetsPath
 * @param {{handle?:import('node:fs/promises').FileHandle|null}} [options]
 * @returns {Promise<number>}
 */
export const resolveOffsetsCount = async (
  offsetsPath,
  { handle = null } = {}
) => {
  if (handle) {
    const { size } = await handle.stat();
    return resolveOffsetCountFromSize(size, offsetsPath);
  }
  const { size } = await fs.stat(offsetsPath);
  return resolveOffsetCountFromSize(size, offsetsPath);
};

/**
 * Read one JSONL row by index using its offsets sidecar.
 * @param {string} jsonlPath
 * @param {string} offsetsPath
 * @param {number} index
 * @param {{maxBytes?:number,requiredKeys?:string[]|null,metrics?:object|null}} [options]
 * @returns {Promise<object|null>}
 */
export const readJsonlRowAt = async (
  jsonlPath,
  offsetsPath,
  index,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
    metrics = null
  } = {}
) => {
  const resolvedMaxBytes = resolveValidatedMaxBytes(maxBytes, 'readJsonlRowAt');
  if (!Number.isFinite(index) || index < 0) return null;
  const [jsonlHandle, offsetsHandle] = await Promise.all([
    fs.open(jsonlPath, 'r'),
    fs.open(offsetsPath, 'r')
  ]);
  try {
    const [offsetCount, jsonlStat, offsets] = await Promise.all([
      resolveOffsetsCount(offsetsPath, { handle: offsetsHandle }),
      jsonlHandle.stat(),
      readOffsetsAt(offsetsPath, [index, index + 1], { handle: offsetsHandle })
    ]);
    if (index >= offsetCount) return null;
    const start = offsets.get(index);
    const next = index + 1 < offsetCount ? offsets.get(index + 1) : null;
    if (!Number.isFinite(start)) return null;
    const end = Number.isFinite(next) ? next : jsonlStat.size;
    if (end < start) {
      throw new Error(`Invalid offsets: end (${end}) < start (${start}) for ${jsonlPath}`);
    }
    const length = end - start;
    if (length === 0) return null;
    if (metrics && typeof metrics === 'object') {
      const currentRequested = Number.isFinite(metrics.bytesRequested) ? metrics.bytesRequested : 0;
      metrics.bytesRequested = currentRequested + length;
    }
    if (length > resolvedMaxBytes) {
      throw toJsonTooLargeError(jsonlPath, length);
    }
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await jsonlHandle.read(buffer, 0, length, start);
    assertExactRead(bytesRead, length, `JSONL row short read at index ${index} for ${jsonlPath}`);
    const line = buffer.slice(0, bytesRead).toString('utf8');
    if (metrics && typeof metrics === 'object') {
      const currentRead = Number.isFinite(metrics.bytesRead) ? metrics.bytesRead : 0;
      metrics.bytesRead = currentRead + bytesRead;
      const currentRows = Number.isFinite(metrics.rowsRead) ? metrics.rowsRead : 0;
      metrics.rowsRead = currentRows + 1;
    }
    return parseJsonlLine(line, jsonlPath, index + 1, resolvedMaxBytes, requiredKeys);
  } finally {
    await Promise.allSettled([jsonlHandle.close(), offsetsHandle.close()]);
  }
};

/**
 * Read multiple JSONL rows by index using one shared offsets+data scan.
 * @param {string} jsonlPath
 * @param {string} offsetsPath
 * @param {number[]} indexes
 * @param {{maxBytes?:number,requiredKeys?:string[]|null,metrics?:object|null}} [options]
 * @returns {Promise<Array<object|null>>}
 */
export const readJsonlRowsAt = async (
  jsonlPath,
  offsetsPath,
  indexes,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
    metrics = null
  } = {}
) => {
  const resolvedMaxBytes = resolveValidatedMaxBytes(maxBytes, 'readJsonlRowsAt');
  if (!Array.isArray(indexes) || indexes.length === 0) return [];
  const normalized = indexes.map((value) => (
    Number.isFinite(value) && value >= 0 ? Math.floor(value) : -1
  ));
  const validIndexes = normalized.filter((value) => value >= 0);
  if (!validIndexes.length) return [];
  const uniqueIndexes = Array.from(new Set(validIndexes)).sort((a, b) => a - b);
  const uniqueNeeded = new Set();
  for (const index of uniqueIndexes) {
    uniqueNeeded.add(index);
    uniqueNeeded.add(index + 1);
  }
  const [jsonlHandle, offsetsHandle] = await Promise.all([
    fs.open(jsonlPath, 'r'),
    fs.open(offsetsPath, 'r')
  ]);
  try {
    const [offsetsStat, jsonlStat] = await Promise.all([
      offsetsHandle.stat(),
      jsonlHandle.stat()
    ]);
    const offsetCount = resolveOffsetCountFromSize(offsetsStat.size, offsetsPath);
    const offsetValues = await readOffsetsAtWithHandle(offsetsHandle, [...uniqueNeeded]);
    const rowByIndex = new Map();
    const rowSpecs = [];
    for (const index of uniqueIndexes) {
      if (index >= offsetCount) {
        rowByIndex.set(index, null);
        continue;
      }
      const start = offsetValues.get(index);
      const next = index + 1 < offsetCount ? offsetValues.get(index + 1) : null;
      if (!Number.isFinite(start)) {
        rowByIndex.set(index, null);
        continue;
      }
      const end = Number.isFinite(next) ? next : jsonlStat.size;
      if (end < start) {
        throw new Error(`Invalid offsets: end (${end}) < start (${start}) for ${jsonlPath}`);
      }
      const length = end - start;
      if (length === 0) {
        rowByIndex.set(index, null);
        continue;
      }
      if (metrics && typeof metrics === 'object') {
        const currentRequested = Number.isFinite(metrics.bytesRequested) ? metrics.bytesRequested : 0;
        metrics.bytesRequested = currentRequested + length;
      }
      if (length > resolvedMaxBytes) {
        throw toJsonTooLargeError(jsonlPath, length);
      }
      rowSpecs.push({ index, start, end });
    }
    const ranges = [];
    let currentRange = null;
    for (const spec of rowSpecs) {
      if (!currentRange) {
        currentRange = {
          start: spec.start,
          end: spec.end,
          rows: [spec]
        };
        continue;
      }
      const contiguous = spec.start === currentRange.end;
      const mergedBytes = spec.end - currentRange.start;
      if (contiguous && mergedBytes <= JSONL_ROWS_AT_MAX_BATCH_BYTES) {
        currentRange.end = spec.end;
        currentRange.rows.push(spec);
        continue;
      }
      ranges.push(currentRange);
      currentRange = {
        start: spec.start,
        end: spec.end,
        rows: [spec]
      };
    }
    if (currentRange) ranges.push(currentRange);
    for (const range of ranges) {
      const length = range.end - range.start;
      if (length <= 0) continue;
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await jsonlHandle.read(buffer, 0, length, range.start);
      assertExactRead(bytesRead, length, `JSONL row short read for ${jsonlPath}`);
      if (metrics && typeof metrics === 'object') {
        const currentRead = Number.isFinite(metrics.bytesRead) ? metrics.bytesRead : 0;
        metrics.bytesRead = currentRead + bytesRead;
      }
      for (const spec of range.rows) {
        const start = spec.start - range.start;
        const end = spec.end - range.start;
        const line = buffer.slice(start, end).toString('utf8');
        rowByIndex.set(
          spec.index,
          parseJsonlLine(line, jsonlPath, spec.index + 1, resolvedMaxBytes, requiredKeys)
        );
      }
    }
    if (metrics && typeof metrics === 'object') {
      const currentRows = Number.isFinite(metrics.rowsRead) ? metrics.rowsRead : 0;
      metrics.rowsRead = currentRows + uniqueIndexes.length;
    }
    return normalized.map((index) => (index >= 0 ? (rowByIndex.get(index) ?? null) : null));
  } finally {
    await Promise.allSettled([jsonlHandle.close(), offsetsHandle.close()]);
  }
};

/**
 * Validate offset monotonicity and newline boundaries with bounded scratch space.
 * @param {string} jsonlPath
 * @param {string} offsetsPath
 * @param {{signal?:AbortSignal|null}} [options]
 * @returns {Promise<boolean>}
 */
export const validateOffsetsAgainstFile = async (jsonlPath, offsetsPath, { signal = null } = {}) => {
  throwIfAborted(signal);
  const [jsonlStat, offsetsStat] = await Promise.all([fs.stat(jsonlPath), fs.stat(offsetsPath)]);
  throwIfAborted(signal);
  const cacheKey = buildValidationCacheKey(jsonlPath, offsetsPath);
  if (getCachedOffsetsValidation(cacheKey, jsonlStat, offsetsStat)) return true;
  const count = resolveOffsetCountFromSize(offsetsStat.size, offsetsPath);
  const fileSize = jsonlStat.size;
  const offsetsHandle = await fs.open(offsetsPath, 'r');
  let jsonlHandle;
  try {
    jsonlHandle = await fs.open(jsonlPath, 'r');
    // Fixed scratch space, independent of row count. Do not materialize the
    // sidecar or a second array of boundary positions on recovery scans.
    const offsetBuffer = Buffer.allocUnsafe(Math.min(offsetsStat.size, OFFSETS_VALIDATION_WINDOW_BYTES));
    const dataBuffer = Buffer.allocUnsafe(Math.min(fileSize, OFFSETS_VALIDATION_WINDOW_BYTES));
    let last = -1;
    for (let first = 0; first < count;) {
      throwIfAborted(signal);
      const batchCount = Math.min(offsetBuffer.length / OFFSET_BYTES, count - first);
      const length = batchCount * OFFSET_BYTES;
      const { bytesRead } = await offsetsHandle.read(offsetBuffer, 0, length, first * OFFSET_BYTES);
      assertExactRead(bytesRead, length, 'Offsets sidecar short read for ' + offsetsPath);
      for (let i = 0; i < batchCount; i += 1) {
        const offset = readOffsetValue(offsetBuffer, i);
        if (first === 0 && i === 0 && offset !== 0) {
          throw createOffsetsInvalidError('Offsets must start at zero for ' + offsetsPath);
        }
        if (offset <= last) throw createOffsetsInvalidError('Offsets not monotonic for ' + offsetsPath);
        if (offset >= fileSize) throw createOffsetsInvalidError('Offset exceeds file size for ' + jsonlPath);
        last = offset;
      }
      // Coalesce only boundaries within a 64 KiB span. Sparse/large records
      // still read one byte, instead of scanning their intervening payloads.
      const isLastBatch = first + batchCount === count;
      const boundaryCount = batchCount + (isLastBatch ? 1 : 0);
      const positionAt = (i) => i === batchCount ? fileSize - 1 : readOffsetValue(offsetBuffer, i) - 1;
      for (let i = first === 0 ? 1 : 0; i < boundaryCount;) {
        throwIfAborted(signal);
        const start = positionAt(i);
        let end = i + 1;
        while (end < boundaryCount && positionAt(end) - start < dataBuffer.length) end += 1;
        const readLength = positionAt(end - 1) - start + 1;
        const { bytesRead: dataBytes } = await jsonlHandle.read(dataBuffer, 0, readLength, start);
        assertExactRead(dataBytes, readLength, 'JSONL boundary read failed for ' + jsonlPath);
        for (; i < end; i += 1) {
          const position = positionAt(i);
          if (dataBuffer[position - start] !== 0x0a) {
            throw createOffsetsInvalidError(i === batchCount
              ? 'JSONL missing trailing newline for ' + jsonlPath
              : 'Offset boundary missing newline at byte ' + position + ' for ' + jsonlPath);
          }
        }
      }
      first += batchCount;
    }
  } finally {
    await Promise.allSettled([offsetsHandle.close(), jsonlHandle?.close()]);
  }
  throwIfAborted(signal);
  setCachedOffsetsValidation(cacheKey, jsonlStat, offsetsStat);
  return true;
};
