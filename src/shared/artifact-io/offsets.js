import { readExactAt } from '../io/read-exact.js';
import fs from 'node:fs/promises';
import { openContainedFile } from '../contained-file.js';
import { createContainedFileResource } from '../contained-file-resource.js';
import { createHash } from 'node:crypto';
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
const VERIFIED_SNAPSHOT_BYTES = 64 * 1024;
const READ_IDENTITY_KEYS = ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'];
const contentChanged = () => Object.assign(new Error('Verified JSONL content changed.'), { code: 'ERR_JSONL_CONTENT_INTEGRITY' });
const sameReadIdentity = (before, after) => READ_IDENTITY_KEYS.every(key => before[key] === after[key]);
const bufferReadSource = bytes => ({
  async stat() { return { size: bytes.length }; },
  async read(target, offset, length, position) {
    const bytesRead = Math.max(0, Math.min(length, bytes.length - position));
    if (bytesRead) bytes.copy(target, offset, position, position + bytesRead);
    return { bytesRead, buffer: target };
  },
  async close() {}
});

const hashReadSource = async (source, expectedBytes, signal, snapshot, algorithm) => {
  const before = await source.stat();
  if (before.size !== expectedBytes) throw contentChanged();
  const hash = algorithm === 'xxh64'
    ? await (await import('../hash/xxhash-backend.js')).createXxhash64Hasher() : createHash(algorithm);
  const scratch = Buffer.allocUnsafe(Math.max(1, Math.min(expectedBytes, VERIFIED_SNAPSHOT_BYTES)));
  const captured = snapshot ? Buffer.alloc(expectedBytes) : null;
  const blocks = snapshot ? null : [];
  let bytes = 0;
  while (bytes < expectedBytes) {
    throwIfAborted(signal);
    const length = Math.min(scratch.length, expectedBytes - bytes);
    let filled = 0;
    while (filled < length) {
      throwIfAborted(signal);
      const { bytesRead } = await source.read(scratch, filled, length - filled, bytes + filled);
      if (!bytesRead) throw contentChanged();
      filled += bytesRead;
    }
    const block = scratch.subarray(0, length);
    hash.update(block);
    if (captured) scratch.copy(captured, bytes, 0, length);
    else blocks.push(createHash('sha256').update(block).digest());
    bytes += length;
  }
  const extra = await source.read(scratch, 0, 1, expectedBytes);
  if (extra.bytesRead || !sameReadIdentity(before, await source.stat())) throw contentChanged();
  return { hash: hash.digest('hex'), captured, blocks, stat: before };
};

// Metadata can remain equal after an in-place write. Decode only block bytes
// freshly matched to the original full-file verification, using bounded scratch
// storage rather than retaining a large piece or rereading it for every row.
const verifiedBlockReadSource = (source, { stat, blocks }, signal) => ({
  stat: (...args) => source.stat(...args),
  async read(target, offset, length, position) {
    throwIfAborted(signal);
    const bytesRead = Math.max(0, Math.min(length, stat.size - position));
    let copied = 0;
    while (copied < bytesRead) {
      throwIfAborted(signal);
      const blockIndex = Math.floor((position + copied) / VERIFIED_SNAPSHOT_BYTES);
      const blockStart = blockIndex * VERIFIED_SNAPSHOT_BYTES;
      const block = Buffer.allocUnsafe(Math.min(VERIFIED_SNAPSHOT_BYTES, stat.size - blockStart));
      let filled = 0;
      while (filled < block.length) {
        throwIfAborted(signal);
        const read = await source.read(block, filled, block.length - filled, blockStart + filled);
        if (!read.bytesRead) throw contentChanged();
        filled += read.bytesRead;
      }
      if (!createHash('sha256').update(block).digest().equals(blocks[blockIndex])) throw contentChanged();
      const start = position + copied - blockStart;
      const count = Math.min(bytesRead - copied, block.length - start);
      block.copy(target, offset + copied, start, start + count);
      copied += count;
    }
    return { bytesRead, buffer: target };
  }
});
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
  const { bytesRead } = await readExactAt(handle, buffer, 0, OFFSET_BYTES, index * OFFSET_BYTES);
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
  const { bytesRead } = await readExactAt(handle, spanBuffer, 0, spanBytes, minIndex * OFFSET_BYTES);
  if (bytesRead % OFFSET_BYTES !== 0) throw createOffsetsInvalidError('Offsets sidecar has a partial trailing offset.');
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
  return createContainedFileResource({ handle: ownedHandle, sync: false })
    .run(descriptor => readOffsetsAtWithHandle(descriptor, indexes));
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

// Both opens can finish independently. A rejected peer must not strand the
// successful handle, including when it resolves after the rejection.
const openJsonlHandles = async (jsonlPath, offsetsPath, { containedRoot = null } = {}) => {
  const open = target => containedRoot ? openContainedFile(containedRoot, target) : fs.open(target, 'r');
  const pending = [open(jsonlPath), open(offsetsPath)];
  try {
    return await Promise.all(pending);
  } catch (error) {
    const settled = await Promise.allSettled(pending);
    await Promise.allSettled(settled.filter(result => result.status === 'fulfilled')
      .map(result => result.value.close()));
    throw error;
  }
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
  const [jsonlHandle, offsetsHandle] = await openJsonlHandles(jsonlPath, offsetsPath);
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
    const { bytesRead } = await readExactAt(jsonlHandle, buffer, 0, length, start);
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
const readJsonlRowsAtWithHandles = async (
  jsonlPath,
  offsetsPath,
  indexes,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null,
    metrics = null
  },
  [jsonlHandle, offsetsHandle]
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
    const { bytesRead } = await readExactAt(jsonlHandle, buffer, 0, length, range.start);
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
};

/** Open one operation-scoped row reader. The caller owns close(), including on
 * cancellation or failure. Positioned reads retain the existing byte bounds.
 */
export const openJsonlRowReader = async (jsonlPath, offsetsPath, options = {}) => {
  let handles = await openJsonlHandles(jsonlPath, offsetsPath, options);
  let closed = false;
  let verification = null, identity = null, contentVerification = null, closePromise = null;
  const pending = new Set();
  const track = operation => {
    pending.add(operation);
    operation.then(() => pending.delete(operation), () => pending.delete(operation));
    return operation;
  };
  const checkIdentity = async () => {
    if (!identity) return;
    const current = await Promise.all(handles.map(handle => handle.stat()));
    if (current.some((stat, index) => !sameReadIdentity(identity[index], stat))) throw contentChanged();
  };
  const readSources = signal => contentVerification
    ? handles.map((handle, index) => verifiedBlockReadSource(handle, contentVerification[index], signal))
    : handles;
  return {
    verify({ jsonlBytes, offsetsBytes, jsonlHash, offsetsHash,
      jsonlHashAlgorithm = 'sha256', offsetsHashAlgorithm = 'sha256', signal = null }) {
      if (closed) throw new Error('JSONL row reader is closed.');
      if (verification) throw new Error('JSONL row reader integrity is already initialized.');
      if (pending.size) throw new Error('JSONL integrity must be initialized before reading.');
      if (![jsonlBytes, offsetsBytes].every(value => Number.isSafeInteger(value) && value >= 0)
        || ![[jsonlHash, jsonlHashAlgorithm], [offsetsHash, offsetsHashAlgorithm]].every(([value, algorithm]) =>
          ['sha1', 'sha256', 'xxh64'].includes(algorithm) && typeof value === 'string'
          && new RegExp('^[a-f0-9]{' + ({ sha1: 40, sha256: 64, xxh64: 16 }[algorithm]) + '}$').test(value))) {
        throw new TypeError('JSONL verification requires bounded byte counts and explicit SHA-1/SHA-256/xxh64 hashes.');
      }
      verification = track((async () => {
        const snapshot = jsonlBytes <= VERIFIED_SNAPSHOT_BYTES && offsetsBytes <= VERIFIED_SNAPSHOT_BYTES;
        // Both reads settle before disposal, including cancellation or a failed peer.
        const hashes = await Promise.allSettled(handles.map((handle, index) =>
          hashReadSource(handle, index ? offsetsBytes : jsonlBytes, signal, snapshot,
            index ? offsetsHashAlgorithm : jsonlHashAlgorithm)));
        const failed = hashes.find(result => result.status === 'rejected');
        if (failed) throw failed.reason;
        const values = hashes.map(result => result.value);
        if (values[0].hash !== jsonlHash || values[1].hash !== offsetsHash) throw contentChanged();
        if (snapshot) {
          const disposed = await Promise.allSettled(handles.map(handle => handle.close()));
          const failedClose = disposed.find(result => result.status === 'rejected');
          if (failedClose) throw failedClose.reason;
          // These exact hashed bytes live only in this reader, never a global cache.
          handles = values.map(value => bufferReadSource(value.captured));
        } else {
          // Large pieces retain the same opened objects through decoding.
          identity = values.map(value => value.stat);
          contentVerification = values;
        }
      })());
      return verification;
    },
    readRows(indexes, options = {}) {
      if (closed) throw new Error('JSONL row reader is closed.');
      return track((async () => {
        if (verification) await verification;
        throwIfAborted(options.signal);
        await checkIdentity();
        const rows = await readJsonlRowsAtWithHandles(jsonlPath, offsetsPath, indexes, options, readSources(options.signal));
        await checkIdentity();
        throwIfAborted(options.signal);
        return rows;
      })());
    },
    validateOffsets(options = {}) {
      if (closed) throw new Error('JSONL row reader is closed.');
      return track((async () => {
        if (verification) await verification;
        await checkIdentity();
        const result = await validateOffsetsAgainstSources(jsonlPath, offsetsPath, options, readSources(options.signal));
        await checkIdentity();
        return result;
      })());
    },
    async close() {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = (async () => {
        await Promise.allSettled([...pending]);
        await Promise.allSettled(handles.map(handle => handle.close()));
        handles = [];
        identity = null;
        contentVerification = null;
        verification = null;
        pending.clear();
      })();
      return closePromise;
    }
  };
};

/** Read selected rows and dispose both files before resolving or rejecting. */
export const readJsonlRowsAt = async (jsonlPath, offsetsPath, indexes, options = {}) => {
  const { maxBytes = MAX_JSON_BYTES } = options;
  resolveValidatedMaxBytes(maxBytes, 'readJsonlRowsAt');
  if (!Array.isArray(indexes) || !indexes.some(value => Number.isFinite(value) && value >= 0)) return [];
  const reader = await openJsonlRowReader(jsonlPath, offsetsPath);
  try {
    return await reader.readRows(indexes, options);
  } finally { await reader.close(); }
};

/**
 * Validate offset monotonicity and newline boundaries with bounded scratch space.
 * @param {string} jsonlPath
 * @param {string} offsetsPath
 * @param {{signal?:AbortSignal|null}} [options]
 * @returns {Promise<boolean>}
 */
const validateOffsetsAgainstSources = async (jsonlPath, offsetsPath, { signal = null } = {}, [jsonlHandle, offsetsHandle]) => {
  throwIfAborted(signal);
  const [jsonlStat, offsetsStat] = await Promise.all([jsonlHandle.stat(), offsetsHandle.stat()]);
  throwIfAborted(signal);
  const count = resolveOffsetCountFromSize(offsetsStat.size, offsetsPath);
  const fileSize = jsonlStat.size;
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
  throwIfAborted(signal);
  return true;
};

export const validateOffsetsAgainstFile = async (jsonlPath, offsetsPath, options = {}) => {
  throwIfAborted(options.signal);
  const handles = await openJsonlHandles(jsonlPath, offsetsPath, options);
  try { return await validateOffsetsAgainstSources(jsonlPath, offsetsPath, options, handles); }
  finally { await Promise.allSettled(handles.map(handle => handle.close())); }
};
