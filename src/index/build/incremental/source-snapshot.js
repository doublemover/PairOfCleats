import fs from 'node:fs';
import path from 'node:path';
import { readVerifiedContainedFile, withContainedFile } from '../../../shared/contained-file.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { describeStorageFailure } from '../../../shared/storage/failure-observation.js';

const receipts = new WeakMap();
const MAX_CACHE_ENTRIES = 256, MAX_CACHE_BYTES = 16 * 1024 * 1024, MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const fields = ['size', 'mtimeMs', 'ctimeMs'];
const rootIdentity = root => {
  const stat = fs.lstatSync(root, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino === 0n) throw Object.assign(
    new Error('Incremental source root must identify its authorized ordinary directory.'), { code: 'ERR_UNSAFE_FILE_PATH' });
  return `${stat.dev}:${stat.ino}`;
};
export const isIncrementalSourceMiss = error => ['ENOENT', 'ENOTDIR', 'ERR_UNSAFE_FILE_PATH', 'ERR_FILE_CHANGED',
  'ERR_FILE_TOO_LARGE', 'ERR_FILE_INTEGRITY'].includes(describeStorageFailure(error, { phase: 'incremental-source-read' }).code);

/** Reuse only this map's private admitted byte snapshot. Every reuse reopens
 * the contained object and verifies exact descriptor/root and native metadata;
 * public map entries and returned buffers cannot forge or mutate its receipt.
 */
export const readIncrementalSourceSnapshot = async ({ repoRoot, absPath, fileStat = null,
  relKey = null, sharedReadState = null, signal = null }) => {
  throwIfAborted(signal);
  const root = path.resolve(repoRoot), file = path.resolve(absPath), rootId = rootIdentity(root);
  const cache = sharedReadState instanceof Map ? sharedReadState : null;
  const entry = cache?.get(relKey), previous = entry && receipts.get(entry);
  if (previous && previous.cache === cache && previous.rootId === rootId
    && path.relative(previous.root, root) === '' && path.relative(previous.file, file) === ''
    && (!fileStat || fields.every(key => !Number.isFinite(fileStat[key]) || fileStat[key] === previous.stat[key]))) {
    try {
      const current = await withContainedFile(root, file, descriptor => {
        throwIfAborted(signal);
        const stat = fs.fstatSync(descriptor.fd);
        const matches = fields.every(key => stat[key] === previous.stat[key]);
        descriptor.verify();
        return matches;
      }, { expectedFileIdentity: previous.fileIdentity });
      throwIfAborted(signal);
      if (current) return { hash: previous.hash, buffer: Buffer.from(previous.buffer), stat: previous.stat };
    } catch (error) { if (!isIncrementalSourceMiss(error)) throw error; }
  }
  if (entry && cache.get(relKey) === entry) cache.delete(relKey);
  const maxBytes = Number.isSafeInteger(fileStat?.size) && fileStat.size >= 0
    ? Math.min(fileStat.size, MAX_SOURCE_BYTES) : MAX_SOURCE_BYTES;
  const snapshot = await readVerifiedContainedFile(root, file,
    { maxBytes, expectedStat: fileStat, hashAlgorithm: 'sha1', signal });
  // Closing the original descriptor can itself observe cancellation. Do not
  // publish either bytes or a reusable receipt after that boundary.
  throwIfAborted(signal);
  if (cache && relKey && snapshot.buffer.length <= MAX_CACHE_BYTES) {
    const admitted = Object.freeze({ schemaVersion: 1, hash: snapshot.hash, size: snapshot.stat.size, mtimeMs: snapshot.stat.mtimeMs });
    const stat = Object.freeze(Object.fromEntries(fields.map(key => [key, snapshot.stat[key]])));
    receipts.set(admitted, { cache, root, rootId, file, stat, fileIdentity: snapshot.fileIdentity,
      hash: snapshot.hash, buffer: Buffer.from(snapshot.buffer) });
    cache.set(relKey, admitted);
    let bytes = 0;
    for (const value of cache.values()) bytes += receipts.get(value)?.buffer.length || 0;
    while (cache.size > MAX_CACHE_ENTRIES || bytes > MAX_CACHE_BYTES) {
      const key = cache.keys().next().value, value = cache.get(key);
      bytes -= receipts.get(value)?.buffer.length || 0; cache.delete(key);
    }
  }
  return snapshot;
};
