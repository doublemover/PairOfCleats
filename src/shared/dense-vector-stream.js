import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { openContainedFile, openContainedFileSync, verifyContainedFileHandle } from './contained-file.js';
import { normalizeDenseVectorMeta } from './dense-vector-meta.js';
import { decodeDenseVectorValidity } from './dense-vector-validity.js';
import { throwIfAborted } from './abort.js';
import { createXxhash64Hasher } from './hash/xxhash-backend.js';

const MAX_ROW_BYTES = 16 * 1024 * 1024;
const DEFAULT_WINDOW_BYTES = 1024 * 1024;
const invalid = message => Object.assign(new Error(message), { code: 'ERR_DENSE_VECTOR_STREAM' });
const identityFields = ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'];
const sameStat = (left, right) => identityFields.every(key => left[key] === right[key]);

export const normalizeDenseVectorStreamMeta = raw => {
  const input = normalizeDenseVectorMeta(raw);
  const count = input?.count ?? input?.totalRecords;
  if (!input || !Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(input.dims)
    || input.dims <= 0 || input.dims > MAX_ROW_BYTES || !Number.isSafeInteger(count * input.dims)
    || (input.count != null && input.totalRecords != null && input.count !== input.totalRecords)
    || (input.bytes != null && input.bytes !== count * input.dims)) throw invalid('Invalid dense vector stream dimensions or count.');
  const meta = { ...input, count };
  decodeDenseVectorValidity(meta);
  return meta;
};

const plan = (raw, { start = 0, count = null, maxBytes = DEFAULT_WINDOW_BYTES, expectedChecksum = null } = {}) => {
  const meta = normalizeDenseVectorStreamMeta(raw);
  count ??= meta.count - start;
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count) || count < 0 || start + count > meta.count
    || !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_ROW_BYTES) throw invalid('Invalid dense vector range or byte window.');
  const match = expectedChecksum == null ? null : /^(sha256|sha1|xxh64):([a-f0-9]+)$/i.exec(expectedChecksum);
  if (expectedChecksum != null && (!match || match[2].length !== ({ sha256: 64, sha1: 40, xxh64: 16 })[match[1].toLowerCase()])) {
    throw invalid('Invalid dense vector manifest checksum.');
  }
  const bits = decodeDenseVectorValidity(meta);
  return { meta, bits, start, end: start + count, rowsPerWindow: Math.max(1, Math.floor(maxBytes / meta.dims)),
    expectedDigest: match?.[2].toLowerCase() ?? null, digestAlgorithm: match?.[1].toLowerCase() ?? null };
};
const admit = (stat, meta) => {
  if (!stat.isFile() || stat.size !== BigInt(meta.count * meta.dims)) throw invalid('Dense vector payload byte count disagrees with metadata.');
};
const present = (bits, id) => !bits || Boolean(bits[id >> 3] & (1 << (id & 7)));
const recordRead = (metrics, bytes, capacity) => {
  if (!metrics) return;
  metrics.bytesRead = (metrics.bytesRead || 0) + bytes;
  metrics.readCalls = (metrics.readCalls || 0) + 1;
  metrics.peakWindowBytes = Math.max(metrics.peakWindowBytes || 0, capacity);
};
const finish = ({ before, after, digest, expectedDigest, fd, root, filename, signal }) => {
  throwIfAborted(signal);
  verifyContainedFileHandle(fd, root, filename);
  if (!sameStat(before, after)) throw invalid('Dense vector payload changed during streaming.');
  if (digest && digest.digest('hex') !== expectedDigest) throw invalid('Dense vector payload differs from its manifest checksum.');
};

/** Every row preserves its ordinal, including explicitly absent channels.
 * Windows are immutable after yielding, so a consumer retaining a row never
 * observes a subsequent read overwrite its bytes. Retention belongs to that
 * consumer; the reader holds only its current bounded window.
 * With a checksum, even a selected subrange verifies the complete file before
 * the iterator completes. Consumers publish only after successful completion. */
export async function* iterateDenseVectorBinaryRows({ root, filename, meta: raw, signal = null, metrics = null, ...options }) {
  const selected = plan(raw, options);
  const { meta, bits, start, end, rowsPerWindow, expectedDigest, digestAlgorithm } = selected;
  throwIfAborted(signal);
  const digest = digestAlgorithm === 'xxh64' ? await createXxhash64Hasher() : digestAlgorithm ? createHash(digestAlgorithm) : null;
  const handle = await openContainedFile(root, filename);
  try {
    const before = await handle.stat({ bigint: true }); admit(before, meta);
    const firstRow = digest ? 0 : start, lastRow = digest ? meta.count : end;
    for (let first = firstRow; first < lastRow; first += rowsPerWindow) {
      throwIfAborted(signal);
      const rowCount = Math.min(rowsPerWindow, lastRow - first);
      const bytes = Buffer.alloc(rowCount * meta.dims);
      let offset = 0;
      while (offset < bytes.length) {
        throwIfAborted(signal);
        const remaining = bytes.length - offset;
        const result = await handle.read(bytes, offset, remaining, first * meta.dims + offset);
        const progress = result.bytesRead;
        if (!Number.isSafeInteger(progress) || progress <= 0 || progress > remaining) throw invalid('Dense vector read made invalid forward progress.');
        recordRead(metrics, progress, bytes.length); offset += progress;
      }
      digest?.update(bytes);
      for (let row = Math.max(first, start); row < Math.min(first + rowCount, end); row++) {
        throwIfAborted(signal);
        yield { docId: row, vector: present(bits, row) ? bytes.subarray((row - first) * meta.dims, (row - first + 1) * meta.dims) : new Uint8Array(0) };
      }
    }
    finish({ before, after: await handle.stat({ bigint: true }), digest, expectedDigest, fd: handle, root, filename, signal });
  } finally { await handle.close(); }
}

/** Open and validate descriptor/length before a synchronous SQLite transaction.
 * The same descriptor remains owned until close; late read/integrity failure
 * must roll back the caller's transaction before any publication. */
export const openDenseVectorBinarySourceSync = ({ root, filename, meta: raw, signal = null, metrics = null, ...options }) => {
  const selected = plan(raw, options);
  const { meta, bits, start, end, rowsPerWindow, expectedDigest, digestAlgorithm } = selected;
  if (digestAlgorithm === 'xxh64') throw invalid('Synchronous xxh64 reads require prior asynchronous verification.');
  throwIfAborted(signal);
  const fd = openContainedFileSync(root, filename);
  let before;
  try { before = fs.fstatSync(fd, { bigint: true }); admit(before, meta); }
  catch (error) { fs.closeSync(fd); throw error; }
  let closed = false;
  const close = () => { if (!closed) { closed = true; fs.closeSync(fd); } };
  return { count: end - start, meta, close, *[Symbol.iterator]() {
    if (closed) throw invalid('Dense vector stream descriptor has closed.');
    const digest = digestAlgorithm ? createHash(digestAlgorithm) : null;
    const firstRow = digest ? 0 : start, lastRow = digest ? meta.count : end;
    for (let first = firstRow; first < lastRow; first += rowsPerWindow) {
      throwIfAborted(signal);
      const rowCount = Math.min(rowsPerWindow, lastRow - first), bytes = Buffer.alloc(rowCount * meta.dims);
      let offset = 0;
      while (offset < bytes.length) {
        throwIfAborted(signal);
        const remaining = bytes.length - offset;
        const progress = fs.readSync(fd, bytes, offset, remaining, first * meta.dims + offset);
        if (!Number.isSafeInteger(progress) || progress <= 0 || progress > remaining) throw invalid('Dense vector read made invalid forward progress.');
        recordRead(metrics, progress, bytes.length); offset += progress;
      }
      digest?.update(bytes);
      for (let row = Math.max(first, start); row < Math.min(first + rowCount, end); row++) {
        throwIfAborted(signal);
        yield { docId: row, vector: present(bits, row) ? bytes.subarray((row - first) * meta.dims, (row - first + 1) * meta.dims) : new Uint8Array(0) };
      }
    }
    finish({ before, after: fs.fstatSync(fd, { bigint: true }), digest, expectedDigest, fd, root, filename, signal });
  } };
};
