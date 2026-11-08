import fs from 'node:fs';
import path from 'node:path';
import { withContainedFileSync } from '../../shared/contained-file.js';
import { decodeTextBuffer } from '../../shared/encoding.js';
import { buildLocalCacheKey } from '../../shared/cache-key.js';
import { isWithinRoot, toRealPathSync } from '../../workspace/identity.js';
import { observeStorageResource, describeStorageFailure } from '../../shared/storage/failure-observation.js';
import { getFileTextCache } from './cache.js';

export const MAX_RENDER_SOURCE_BYTES = 512 * 1024;
export const MAX_RENDER_SCAN_CHARS = 64 * 1024;
const snapshots = new WeakSet(), readers = new WeakMap();
const generationOf = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
const bound = (value, maximum) => Math.max(0, Math.floor(Math.min(maximum, Number(value) || 0)));
const unavailable = (reason, errorCode = null) => Object.freeze({ state: 'unavailable', reason, errorCode, snapshot: null });
export const isRenderSourceReader = (value, rootDir) => readers.has(value)
  && readers.get(value) === (rootDir ? toRealPathSync(path.resolve(rootDir)) : null);

/** One render owns file/read/scan admission, including refusals and failed reads.
 * Global retention can reuse only privately admitted, generation-matching text;
 * it cannot grant another request a larger read budget or bypass confinement.
 */
export const createRenderSourceReader = (rootDir, { maxFiles = 32, maxBytes = 2 * 1024 * 1024,
  maxScanChars = 2 * 1024 * 1024 } = {}) => {
  const root = rootDir ? toRealPathSync(path.resolve(rootDir)) : null;
  const sources = new Map(), fileLimit = bound(maxFiles, 32);
  let remainingBytes = bound(maxBytes, 2 * 1024 * 1024), remainingScan = bound(maxScanChars, 2 * 1024 * 1024);
  let remainingReadWork = remainingBytes;
  const stats = { fileAttempts: 0, admittedBytes: 0, physicalReadBytes: 0, decodeBytes: 0,
    physicalReadRequestedBytes: 0, readCalls: 0, admittedScanChars: 0, cacheHits: 0, refusedFiles: 0 };
  const read = chunk => {
    if (!root || typeof chunk?.file !== 'string' || !chunk.file || !Number.isSafeInteger(chunk.start)
      || !Number.isSafeInteger(chunk.end) || chunk.start < 0 || chunk.end <= chunk.start) return unavailable('invalid-source-selection');
    const file = path.resolve(root, chunk.file);
    if (!isWithinRoot(file, root)) return unavailable('outside-root');
    if (sources.has(file)) {
      const prior = sources.get(file);
      if (prior.state !== 'available') return prior;
      try {
        const current = fs.lstatSync(file, { bigint: true });
        if (!current.isFile() || generationOf(current) !== prior.snapshot.generation) throw new Error('Source generation changed.');
      } catch (error) {
        observeStorageResource(error, { phase: 'render-source-revalidation' }).requireSettled();
        const refused = unavailable('source-changed'); sources.set(file, refused); return refused;
      }
      return prior;
    }
    if (sources.size >= fileLimit) return unavailable('file-budget');
    sources.set(file, unavailable('source-read-failed')); stats.fileAttempts++;
    try {
      let fresh = false;
      const product = withContainedFileSync(root, file, descriptor => {
        const before = descriptor.stat({ bigint: true });
        if (!before.isFile() || before.size > BigInt(MAX_RENDER_SOURCE_BYTES) || before.size > BigInt(remainingBytes)) {
          return unavailable(before.size > BigInt(MAX_RENDER_SOURCE_BYTES) ? 'file-byte-limit' : 'read-byte-budget');
        }
        const bytes = Number(before.size), generation = generationOf(before);
        remainingBytes -= bytes; stats.admittedBytes += bytes;
        const key = buildLocalCacheKey({ namespace: 'render-source-v1', payload: { file, generation } }).key;
        const cached = getFileTextCache().get(key);
        if (snapshots.has(cached) && cached.key === key && cached.generation === generation && cached.path === file) {
          if (generationOf(descriptor.verify()) !== generation) throw new Error('Cached source changed during admission.');
          stats.cacheHits++; return cached;
        }
        const buffer = Buffer.alloc(bytes);
        let offset = 0, calls = 0;
        while (offset < bytes) {
          const length = Math.min(65536, bytes - offset);
          // Charge the requested physical work before entering the captured read.
          if (++calls > 16 || length > remainingReadWork) throw new Error('Source physical-read work budget exhausted.');
          remainingReadWork -= length; stats.physicalReadRequestedBytes += length; stats.readCalls++;
          const count = descriptor.read(buffer, offset, length, offset);
          if (!Number.isInteger(count) || count <= 0 || count > length) throw new Error('Source read is incomplete.');
          stats.physicalReadBytes += count; offset += count;
        }
        const after = descriptor.stat({ bigint: true });
        const verified = descriptor.verify();
        if (generationOf(after) !== generation || generationOf(verified) !== generation) throw new Error('Source changed during read.');
        stats.decodeBytes += bytes;
        const { text } = decodeTextBuffer(buffer, { filePath: file });
        if (typeof text !== 'string' || text.length > 2 * MAX_RENDER_SOURCE_BYTES) throw new Error('Decoded source exceeds its text bound.');
        fresh = true;
        return Object.freeze({ text, key, generation, path: file, bytes });
      });
      // Publication happens only after the original descriptor has closed.
      if (fresh) { snapshots.add(product); getFileTextCache().set(product.key, product); }
      const result = snapshots.has(product) ? Object.freeze({ state: 'available', reason: 'admitted-source', snapshot: product }) : product;
      if (result.state !== 'available') stats.refusedFiles++;
      sources.set(file, result); return result;
    } catch (error) {
      observeStorageResource(error, { phase: 'render-source-read' }).requireSettled();
      stats.refusedFiles++;
      const refused = unavailable('source-read-failed', describeStorageFailure(error, {
        phase: 'render-source-read', defaultCode: 'ERR_RENDER_SOURCE_READ'
      }).code);
      sources.set(file, refused); return refused;
    }
  };
  const reader = Object.freeze({ read,
    admitScan(chars) {
      if (!Number.isSafeInteger(chars) || chars < 0 || chars > remainingScan) return false;
      remainingScan -= chars; stats.admittedScanChars += chars; return true;
    },
    stats: () => Object.freeze({ ...stats, remainingBytes, remainingReadWork, remainingScanChars: remainingScan })
  });
  readers.set(reader, root);
  return reader;
};
