// Source and focused regressions are UNVALIDATED in this development batch.
import { createHash } from 'node:crypto';
import { getContainedFileSession, withContainedFile } from '../../src/shared/contained-file.js';
import { describeStorageFailure } from '../../src/shared/storage/failure-observation.js';
import { sameStorageFileIdentity, storageFileIdentity } from '../../src/shared/storage/inventory.js';

/** Conditional requests reuse an exact readable local object, not a stale
 * manifest's claim about its bytes. The downloader may append one final LF to
 * the approved source; accept only that known normalization when hashing it.
 */
export const inspectReusableDictionary = async ({ root, file, maxBytes, expectedHash = null, signal = null }) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes === Number.MAX_SAFE_INTEGER) {
    throw new TypeError('Dictionary reuse requires a bounded positive source byte allowance.');
  }
  signal?.throwIfAborted();
  let started = false;
  try {
    return await withContainedFile(root, file, async handle => {
      started = true;
      const before = storageFileIdentity(await handle.stat({ bigint: true }));
      if (!Number.isSafeInteger(before.size) || before.size === 0 || before.size > maxBytes + 1) return null;
      const hash = createHash('sha256');
      const buffer = Buffer.alloc(64 * 1024);
      let bytes = 0, finalByte = null;
      for (;;) {
        signal?.throwIfAborted();
        const read = await handle.read(buffer, 0, buffer.length, null);
        const count = read.bytesRead;
        if (!Number.isInteger(count) || count < 0 || count > buffer.length) throw new Error('Dictionary local read made invalid progress.');
        if (!count) break;
        bytes += count;
        if (bytes > before.size || bytes > maxBytes + 1) throw new Error('Dictionary local bytes changed during reuse inspection.');
        if (finalByte !== null) hash.update(Buffer.from([finalByte]));
        hash.update(buffer.subarray(0, count - 1));
        finalByte = buffer[count - 1];
      }
      const withoutFinalByte = hash.copy().digest('hex');
      if (finalByte !== null) hash.update(Buffer.from([finalByte]));
      const sha256 = hash.digest('hex');
      handle.verify();
      const after = storageFileIdentity(await handle.stat({ bigint: true }));
      signal?.throwIfAborted();
      if (bytes !== before.size || !sameStorageFileIdentity(before, after)) throw new Error('Dictionary local object changed during reuse inspection.');
      if (expectedHash && sha256 !== expectedHash && !(finalByte === 10 && withoutFinalByte === expectedHash)) return null;
      if (bytes > maxBytes && !(finalByte === 10 && expectedHash && withoutFinalByte === expectedHash)) return null;
      return { identity: after, sha256 };
    });
  } catch (error) {
    if (getContainedFileSession(error)) throw error;
    const diagnostic = describeStorageFailure(error, { phase: 'dictionary-local-reuse' });
    if (!started && diagnostic.code === 'ENOENT') return null;
    throw error;
  }
};

export const sameReusableDictionary = (before, after) => Boolean(before && after
  && before.sha256 === after.sha256 && sameStorageFileIdentity(before.identity, after.identity));
