import fs from 'node:fs/promises';
import { parseJsonlLine } from './jsonl.js';
import { MAX_JSON_BYTES } from './constants.js';
import { toJsonTooLargeError } from './limits.js';
import { coercePositiveInt } from '../number-coerce.js';

export const OFFSETS_FORMAT_VERSION = 1;
export const OFFSETS_FORMAT = 'u64-le';
export const OFFSETS_COMPRESSION = 'none';

const OFFSET_BYTES = 8;
const MAX_OFFSETS_SPAN_BYTES = 4 * 1024 * 1024;
const JSONL_ROWS_AT_MAX_BATCH_BYTES = 8 * 1024 * 1024;
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
    || cached.offsetsSize !== offsetsStat.size
    || cached.offsetsMtimeMs !== offsetsStat.mtimeMs
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
    offsetsSize: offsetsStat.size,
    offsetsMtimeMs: offsetsStat.mtimeMs
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
  const resolved = coercePositiveInt(maxBytes);
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
 * Validate offset monotonicity and bounds against a JSONL source file.
 * @param {string} jsonlPath
 * @param {string} offsetsPath
 * @returns {Promise<boolean>}
 */
export const validateOffsetsAgainstFile = async (jsonlPath, offsetsPath) => {
  const [offsets, jsonlStat, offsetsStat] = await Promise.all([
    readOffsetsFile(offsetsPath),
    fs.stat(jsonlPath),
    fs.stat(offsetsPath)
  ]);
  const cacheKey = buildValidationCacheKey(jsonlPath, offsetsPath);
  if (getCachedOffsetsValidation(cacheKey, jsonlStat, offsetsStat)) {
    return true;
  }
  const fileSize = Number(jsonlStat.size) || 0;
  if (offsets.length && offsets[0] !== 0) {
    throw createOffsetsInvalidError(`Offsets must start at zero for ${offsetsPath}`);
  }
  let last = -1;
  const boundaryPositions = [];
  for (let i = 0; i < offsets.length; i += 1) {
    const offset = offsets[i];
    if (!Number.isFinite(offset) || offset < 0) {
      throw createOffsetsInvalidError(`Invalid offset value: ${offset}`);
    }
    if (offset <= last) {
      throw createOffsetsInvalidError(`Offsets not monotonic for ${offsetsPath}`);
    }
    if (offset >= fileSize) {
      throw createOffsetsInvalidError(`Offset exceeds file size for ${jsonlPath}`);
    }
    if (i > 0) {
      boundaryPositions.push(offset - 1);
    }
    last = offset;
  }
  if (offsets.length && fileSize > 0) {
    boundaryPositions.push(fileSize - 1);
    const handle = await fs.open(jsonlPath, 'r');
    try {
      const buffer = Buffer.allocUnsafe(1);
      for (let i = 0; i < boundaryPositions.length; i += 1) {
        const position = boundaryPositions[i];
        const { bytesRead } = await handle.read(buffer, 0, 1, position);
        if (bytesRead !== 1) {
          throw createOffsetsInvalidError(`JSONL boundary read failed for ${jsonlPath}`);
        }
        if (buffer[0] !== 0x0a) {
          if (i === boundaryPositions.length - 1) {
            throw createOffsetsInvalidError(`JSONL missing trailing newline for ${jsonlPath}`);
          }
          throw createOffsetsInvalidError(
            `Offset boundary missing newline at byte ${position} for ${jsonlPath}`
          );
        }
      }
    } finally {
      await handle.close();
    }
  }
  setCachedOffsetsValidation(cacheKey, jsonlStat, offsetsStat);
  return true;
};
