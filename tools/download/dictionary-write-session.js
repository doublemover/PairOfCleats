// Source implementation and regressions are UNVALIDATED in this development batch.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { runWithStorageSession } from '../../src/shared/storage/session.js';
import { dictionaryStorageCoordinationRoot, registerDictionaryStorageRoot } from '../../src/shared/storage/dictionary-access.js';
import { acquireFileLock, releaseFileLockOrThrow } from '../../src/shared/locks/file-lock.js';

export const observeDictionaryStream = stream => {
  let closed = stream.closed === true;
  let resolveClosed;
  const closure = new Promise(resolve => { resolveClosed = resolve; });
  if (closed) resolveClosed();
  else stream.once('close', () => { closed = true; resolveClosed(); });
  // Destruction during another resource's failure must not emit an unowned
  // error while the actual close event is still pending.
  stream.on('error', () => {});
  return { closed: closure, isClosed: () => closed, close: () => stream.destroy() };
};

const waitForClosure = async (resources, timeoutMs) => {
  if (resources.every(resource => resource.isClosed())) return true;
  let timer;
  try {
    return await Promise.race([Promise.all(resources.map(resource => resource.closed)).then(() => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })]);
  } finally { clearTimeout(timer); }
};

export const closeDictionaryResources = async (resources, { primaryError = null, timeoutMs = 4000 } = {}) => {
  let cleanupError = null;
  for (const resource of resources) {
    try { resource.close(); } catch (error) { cleanupError ||= error; }
  }
  const closed = await waitForClosure(resources, timeoutMs);
  if (!closed || cleanupError) {
    const error = primaryError || cleanupError || new Error('Dictionary response/output closure remains unconfirmed.');
    if (!closed) error.cacheOwnershipPending = true;
    if (cleanupError && error !== cleanupError) error.dictionaryCleanupError ||= cleanupError;
    throw error;
  }
};

/** Same actual dictionary root and appHome/state/storage-access namespace as
 * byte readers/migration. The writer owns prep, request/stream/file closure and
 * manifest publication; a pending teardown retains both its lease and lock.
 */
export const runDictionaryWriteSession = async ({ dictDir, signal = null, settlementTimeoutMs = 4000 }, execute) => {
  dictDir = path.resolve(dictDir);
  registerDictionaryStorageRoot(dictDir);
  const coordinationRoot = dictionaryStorageCoordinationRoot();
  const resources = [];
  let lock = null;
  let resourcesSettled = true;
  const trackResource = resource => {
    if (!resource || typeof resource.isClosed !== 'function' || typeof resource.close !== 'function' || !resource.closed?.then) throw new TypeError('Dictionary writer requires actual resource closure evidence.');
    resources.push(resource);
    return resource;
  };
  return runWithStorageSession({ roots: [dictDir], coordinationRoot,
    authorizedRoots: [dictDir, path.resolve(coordinationRoot, '../..')], scope: 'dictionary-download-write' }, async session => {
    let value;
    let primaryError = null;
    try {
      signal?.throwIfAborted();
      await fs.mkdir(dictDir, { recursive: true });
      lock = await acquireFileLock({ lockPath: path.join(dictDir, '.pairofcleats-download.lock'), waitMs: 0, signal,
        metadata: { scope: 'dictionary-download-write', resourceId: session.resourceId } });
      if (!lock) throw new Error('Another dictionary downloader owns publication; retry after it settles.');
      value = await execute({ signal, resourceId: session.resourceId, trackResource,
        trackStream: stream => trackResource(observeDictionaryStream(stream)) });
    } catch (error) {
      primaryError = error && typeof error === 'object' ? error : new Error(String(error), { cause: error });
      for (const resource of resources) {
        try { resource.close(); } catch (cleanupError) { primaryError.dictionaryCleanupError ||= cleanupError; }
      }
    }
    resourcesSettled = await waitForClosure(resources, settlementTimeoutMs);
    if (!resourcesSettled || primaryError?.cacheOwnershipPending) {
      const error = primaryError || new Error('Dictionary resources have not confirmed actual closure.');
      error.cacheOwnershipPending = true;
      let released = false;
      Object.defineProperty(error, 'dictionaryWriteSession', { configurable: true, value: { resourceId: session.resourceId,
        pendingResources: resources.filter(resource => !resource.isClosed()).length,
        releaseAfterClosure: async () => {
          if (released) return true;
          await Promise.all(resources.map(resource => resource.closed));
          if (!resources.every(resource => resource.isClosed())) throw new Error('Dictionary resource closure remains unconfirmed.');
          for (const resource of resources) await resource.cleanupAfterClosure?.();
          if (lock) await releaseFileLockOrThrow(lock);
          const result = error.storageSession.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false });
          released = true;
          return result;
        } } });
      throw error;
    }
    try {
      for (const resource of resources) await resource.cleanupAfterClosure?.();
      if (lock) await releaseFileLockOrThrow(lock);
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError;
      primaryError.dictionaryCleanupError ||= cleanupError;
    }
    if (primaryError) throw primaryError;
    return value;
  }, { settlement: ({ resourceId, error }) => ({ resourceId,
    settled: resourcesSettled && error?.cacheOwnershipPending !== true,
    pending: !resourcesSettled || error?.cacheOwnershipPending === true }) });
};

/** Pipeline owns backpressure and actual fs output closure. Unique exclusive
 * temporary files are removed only after closure and exact file identity check.
 */
export const streamDictionaryToFile = async (stream, outputPath, { maxBytes, expectedHash, policy, signal = null, trackResource } = {}) => {
  if (typeof trackResource !== 'function') throw new TypeError('Dictionary output requires an active resource-owning write session.');
  let total = 0;
  let lastByte = null;
  const hasher = expectedHash || policy?.requireHash ? crypto.createHash('sha256') : null;
  const tempPath = `${outputPath}.tmp-${crypto.randomUUID()}`;
  const out = fsSync.createWriteStream(tempPath, { flags: 'wx' });
  let identity = null;
  out.once('open', fd => { const stat = fsSync.fstatSync(fd); identity = { dev: stat.dev, ino: stat.ino }; });
  trackResource(observeDictionaryStream(stream));
  const output = observeDictionaryStream(out);
  output.cleanupAfterClosure = async () => {
    if (!identity) return;
    const stat = await fs.lstat(tempPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat && stat.isFile() && !stat.isSymbolicLink() && stat.dev === identity.dev && stat.ino === identity.ino) await fs.rm(tempPath);
  };
  trackResource(output);
  const meter = new Transform({ transform(chunk, _encoding, done) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (maxBytes && total > maxBytes) { done(new Error(`Download exceeds maximum size (${maxBytes} bytes).`)); return; }
    if (hasher) hasher.update(buffer);
    if (buffer.length) lastByte = buffer[buffer.length - 1];
    done(null, buffer);
  } });
  await pipeline(stream, meter, out, signal ? { signal } : {});
  await output.closed;
  return { tempPath, bytes: total, lastByte, hashHex: hasher ? hasher.digest('hex') : null };
};
