import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { atomicWriteText } from '../../shared/io/atomic-write.js';
import { readPersistenceFailureCode, syncParentDirectory } from '../../shared/io/persistence-helpers.js';
import { throwIfAborted } from '../../shared/abort.js';
import { assertNoSymlinkPath, verifyContainedFileHandle, withContainedFile } from '../../shared/contained-file.js';
import { createContainedFileResource } from '../../shared/contained-file-resource.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';
import { readSemanticSourceCapability } from './source-capability.js';

const retainedPayloads = new WeakMap();
const requireVoid = (value, operation) => {
  if (value !== undefined) throw Object.assign(new Error(`Original semantic ${operation} did not confirm its standard void result.`), { cacheOwnershipPending: true });
};
/** Capture raw source once before its serialized writer can yield. Only exact
 * identity metadata leaves this owner; its private bytes are never borrowed.
 */
export const captureSemanticRetainedBytes = bytes => {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Exact semantic bytes are required.');
  const payload = Buffer.from(bytes);
  const snapshot = Object.freeze({ byteLength: payload.length, byteHash: createHash('sha256').update(payload).digest('hex') });
  retainedPayloads.set(snapshot, payload);
  return snapshot;
};
const capturePayload = bytes => {
  const retained = retainedPayloads.get(bytes);
  if (retained) return retained;
  const source = readSemanticSourceCapability(bytes);
  if (source) return Buffer.from(source.text, 'utf8');
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Exact semantic bytes are required.');
  return Buffer.from(bytes);
};

const writers = new WeakMap(), retentionWriters = new WeakMap();
const withDiskWriter = async (owners, account, filename, write) => {
  let pending = owners.get(account);
  if (!pending) { pending = new Map(); owners.set(account, pending); }
  const key = path.resolve(filename), prior = pending.get(key) || Promise.resolve();
  const operation = prior.catch(error => {
    observeStorageResource(error, { phase: 'semantic-disk-writer-prerequisite' }).requireSettled();
  }).then(write);
  pending.set(key, operation);
  let settled = false;
  try { const result = await operation; settled = true; return result; }
  catch (error) {
    observeStorageResource(error, { phase: 'semantic-disk-writer-result' }).requireSettled();
    settled = true; throw error;
  }
  finally { if (settled && pending.get(key) === operation) pending.delete(key); }
};
export const withSemanticDiskWriter = (account, filename, write) => withDiskWriter(writers, account, filename, write);

/** Mutable metadata keeps both old and temporary bytes admitted until rename.
 * Uncertain failures retain credits; reopening counts the physical inventory.
 */
export const writeSemanticJson = async ({ filename, value, diskAccount, signal = null }) => {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  return withSemanticDiskWriter(diskAccount, filename, async () => {
    throwIfAborted(signal);
    let oldBytes = 0;
    try {
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Semantic metadata must be a regular file.');
      oldBytes = stat.nlink === 1 ? stat.size : 0;
    }
    catch (error) { if (readPersistenceFailureCode(error) !== 'ENOENT') throw error; }
    diskAccount.reserve(bytes.length);
    await atomicWriteText(filename, bytes, { newline: false });
    diskAccount.release(oldBytes);
    return bytes.length;
  });
};

/** Immutable publication never exposes a partial final name. The winner and
 * its parent directory are durable before its caller may record a reference.
 */
export const retainSemanticBytes = async ({ filename, bytes, diskAccount, signal = null,
  root = path.dirname(filename), metrics = null }) => {
  const payload = capturePayload(bytes);
  // Source callers may already hold their source/receipt writer. A separate
  // retention lane joins publication through temporary-link removal without
  // re-entering that writer or allowing peers to change the inode's ctime.
  return withDiskWriter(retentionWriters, diskAccount, filename, async () => {
    const conflict = () => Object.assign(new Error('Conflicting immutable semantic bytes.'), { code: 'ERR_SEMANTIC_INTEGRITY' });
    const verify = async () => {
      const result = await withContainedFile(root, filename, async descriptor => {
        throwIfAborted(signal);
        const before = await descriptor.stat({ bigint: true });
        if (before.size !== BigInt(payload.length)) throw conflict();
        // Compare bounded chunks to the captured payload. No readFile allocation,
        // second source hash or mutable caller byte view crosses an awaited read.
        const buffer = Buffer.alloc(Math.min(65536, payload.length));
        let offset = 0;
        while (offset < payload.length) {
          throwIfAborted(signal);
          const length = Math.min(buffer.length, payload.length - offset);
          const { bytesRead } = await descriptor.read(buffer, 0, length, offset);
          throwIfAborted(signal);
          if (!Number.isInteger(bytesRead) || bytesRead < 1 || bytesRead > length) throw conflict();
          if (metrics) metrics.semanticRetentionBytesRead = (metrics.semanticRetentionBytesRead || 0) + bytesRead;
          if (!buffer.subarray(0, bytesRead).equals(payload.subarray(offset, offset + bytesRead))) throw conflict();
          offset += bytesRead;
        }
        const after = await descriptor.stat({ bigint: true }), current = await fs.lstat(filename, { bigint: true });
        throwIfAborted(signal);
        const stable = stat => stat.isFile() && !stat.isSymbolicLink() && stat.dev === before.dev && stat.ino === before.ino
        && stat.size === before.size && stat.mtimeNs === before.mtimeNs && stat.ctimeNs === before.ctimeNs;
        if (!stable(after) || !stable(current)) throw new Error('Semantic immutable storage changed during verification.');
        descriptor.verify();
        return after;
      });
      throwIfAborted(signal);
      if (metrics) metrics.semanticRetentionVerifications = (metrics.semanticRetentionVerifications || 0) + 1;
      return result;
    };
    throwIfAborted(signal);
    try { return await verify(); } catch (error) { if (readPersistenceFailureCode(error) !== 'ENOENT') throw error; }
    await fs.mkdir(path.dirname(filename), { recursive: true });
    throwIfAborted(signal);
    assertNoSymlinkPath(root, filename, { allowMissing: true });
    diskAccount.reserve(payload.length);
    const temporary = path.join(path.dirname(filename), '.pending-' + randomUUID());
    let retained = false, primaryError, primaryCaught = false;
    try {
      const handle = await fs.open(temporary, 'wx');
      const owner = createContainedFileResource({ handle, sync: false, additionalMethods: ['writeFile', 'sync'] });
      await owner.run(async descriptor => {
        owner.inspect(fd => verifyContainedFileHandle(fd, root, temporary));
        throwIfAborted(signal); requireVoid(await descriptor.writeFile(payload), 'temporary write');
        throwIfAborted(signal); requireVoid(await descriptor.sync(), 'temporary sync');
        owner.inspect(fd => verifyContainedFileHandle(fd, root, temporary));
      });
      throwIfAborted(signal);
      assertNoSymlinkPath(root, filename, { allowMissing: true });
      try { requireVoid(await fs.link(temporary, filename), 'immutable publication'); retained = true; }
      catch (error) { if (readPersistenceFailureCode(error) !== 'EEXIST') throw error; await verify(); }
      await syncParentDirectory(filename);
      await syncParentDirectory(path.dirname(filename));
    } catch (error) {
      primaryCaught = true; primaryError = error; throw error;
    } finally {
      // A failed original close or directory operation cannot authorize unlink or
      // credit release. Recovery retains only that exact original resource owner.
      if (primaryCaught) observeStorageResource(primaryError, { phase: 'semantic-retention-cleanup' }).requireSettled();
      try { requireVoid(await fs.rm(temporary, { force: true }), 'temporary removal'); }
      catch (error) { if (primaryCaught) throw addStorageFailureContext(primaryError, {}, error, { secondaryPresent: true }); throw error; }
      if (!retained) diskAccount.release(payload.length);
    }
    return verify();
  });
};
