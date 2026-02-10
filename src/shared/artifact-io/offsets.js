import fs from 'node:fs/promises';
import { parseJsonlLine } from './jsonl.js';
import { MAX_JSON_BYTES } from './constants.js';
import { toJsonTooLargeError } from './limits.js';

export const OFFSETS_FORMAT_VERSION = 1;
export const OFFSETS_FORMAT = 'u64-le';
export const OFFSETS_COMPRESSION = 'none';

const OFFSET_BYTES = 8;
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

export const readOffsetsFile = async (offsetsPath) => {
  const data = await fs.readFile(offsetsPath);
  const count = Math.floor(data.length / OFFSET_BYTES);
  const offsets = new Array(count);
  for (let i = 0; i < count; i += 1) {
    offsets[i] = readOffsetValue(data, i);
  }
  return offsets;
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

export const readOffsetAt = async (
  offsetsPath,
  index,
  { handle = null } = {}
) => {
  if (!Number.isInteger(index) || index < 0) return null;
  const offsets = await readOffsetsAt(offsetsPath, [index], { handle });
  return offsets.get(index) ?? null;
};

export const resolveOffsetsCount = async (
  offsetsPath,
  { handle = null } = {}
) => {
  if (handle) {
    const { size } = await handle.stat();
    return Math.floor(size / OFFSET_BYTES);
  }
  const { size } = await fs.stat(offsetsPath);
  return Math.floor(size / OFFSET_BYTES);
};

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
  if (typeof maxBytes !== 'number' || !Number.isFinite(maxBytes) || maxBytes <= 0) {
    const err = new Error('readJsonlRowAt maxBytes must be a finite positive number.');
    err.code = 'ERR_INVALID_MAX_BYTES';
    throw err;
  }
  const resolvedMaxBytes = Math.floor(maxBytes);
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
  if (typeof maxBytes !== 'number' || !Number.isFinite(maxBytes) || maxBytes <= 0) {
    const err = new Error('readJsonlRowsAt maxBytes must be a finite positive number.');
    err.code = 'ERR_INVALID_MAX_BYTES';
    throw err;
  }
  if (!Array.isArray(indexes) || indexes.length === 0) return [];
  const resolvedMaxBytes = Math.floor(maxBytes);
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
    const offsetCount = Math.floor(offsetsStat.size / OFFSET_BYTES);
    const offsetValues = await readOffsetsAtWithHandle(offsetsHandle, [...uniqueNeeded]);
    const rowByIndex = new Map();
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
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await jsonlHandle.read(buffer, 0, length, start);
      const line = buffer.slice(0, bytesRead).toString('utf8');
      if (metrics && typeof metrics === 'object') {
        const currentRead = Number.isFinite(metrics.bytesRead) ? metrics.bytesRead : 0;
        metrics.bytesRead = currentRead + bytesRead;
      }
      rowByIndex.set(index, parseJsonlLine(line, jsonlPath, index + 1, resolvedMaxBytes, requiredKeys));
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
  let last = -1;
  for (const offset of offsets) {
    if (!Number.isFinite(offset) || offset < 0) {
      throw new Error(`Invalid offset value: ${offset}`);
    }
    if (offset <= last) {
      throw new Error(`Offsets not monotonic for ${offsetsPath}`);
    }
    last = offset;
  }
  if (offsets.length) {
    if (last >= jsonlStat.size) {
      throw new Error(`Offset exceeds file size for ${jsonlPath}`);
    }
    const handle = await fs.open(jsonlPath, 'r');
    try {
      const buffer = Buffer.allocUnsafe(1);
      const { bytesRead } = await handle.read(buffer, 0, 1, jsonlStat.size - 1);
      if (bytesRead === 1 && buffer[0] !== 0x0a) {
        throw new Error(`JSONL missing trailing newline for ${jsonlPath}`);
      }
    } finally {
      await handle.close();
    }
  }
  setCachedOffsetsValidation(cacheKey, jsonlStat, offsetsStat);
  return true;
};
