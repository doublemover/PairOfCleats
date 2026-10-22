// Source and focused regressions are UNVALIDATED in this development batch.
import { createHash } from 'node:crypto';
import { openContainedFile, verifyContainedFileHandle } from '../../src/shared/contained-file.js';
import { sameStorageFileIdentity, storageFileIdentity } from '../../src/shared/storage/inventory.js';

/** Conditional requests reuse an exact readable local object, not a stale
 * manifest's claim about its bytes. The downloader may append one final LF to
 * the approved source; accept only that known normalization when hashing it.
 */
export const inspectReusableDictionary = async ({ root, file, maxBytes, expectedHash = null, signal = null }) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes === Number.MAX_SAFE_INTEGER) {
    throw new TypeError('Dictionary reuse requires a bounded positive source byte allowance.');
  }
  let handle;
  try { handle = await openContainedFile(root, file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try {
    const before = storageFileIdentity(await handle.stat({ bigint: true }));
    if (!Number.isSafeInteger(before.size) || before.size === 0 || before.size > maxBytes + 1) return null;
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let bytes = 0, finalByte = null;
    for (;;) {
      signal?.throwIfAborted();
      const read = await handle.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
      if (bytes > before.size || bytes > maxBytes + 1) throw new Error('Dictionary local bytes changed during reuse inspection.');
      if (finalByte !== null) hash.update(Buffer.from([finalByte]));
      hash.update(buffer.subarray(0, read.bytesRead - 1));
      finalByte = buffer[read.bytesRead - 1];
    }
    const withoutFinalByte = hash.copy().digest('hex');
    if (finalByte !== null) hash.update(Buffer.from([finalByte]));
    const sha256 = hash.digest('hex');
    verifyContainedFileHandle(handle, root, file);
    const after = storageFileIdentity(await handle.stat({ bigint: true }));
    signal?.throwIfAborted();
    if (bytes !== before.size || !sameStorageFileIdentity(before, after)) throw new Error('Dictionary local object changed during reuse inspection.');
    if (expectedHash && sha256 !== expectedHash && !(finalByte === 10 && withoutFinalByte === expectedHash)) return null;
    if (bytes > maxBytes && !(finalByte === 10 && expectedHash && withoutFinalByte === expectedHash)) return null;
    return { identity: after, sha256 };
  } finally { await handle.close(); }
};

export const sameReusableDictionary = (before, after) => Boolean(before && after
  && before.sha256 === after.sha256 && sameStorageFileIdentity(before.identity, after.identity));
