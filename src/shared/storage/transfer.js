import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { openContainedFile, verifyContainedFileHandle } from '../contained-file.js';
import { throwIfAborted } from '../abort.js';
import { sameStorageFileIdentity, storageFileIdentity } from './inventory.js';

/** Bounded streaming read/copy through the existing contained descriptor owner. */
export const verifyStorageFile = async ({ root, file, identity = null, expectedHash = null,
  destination = null, signal = null, deadline = null, maxBytes = Number.MAX_SAFE_INTEGER }) => {
  const handle = await openContainedFile(root, file, { expectedFileIdentity: identity ? { dev: identity.dev, ino: identity.ino } : null });
  let output = null;
  try {
    const before = storageFileIdentity(await handle.stat({ bigint: true }));
    if (!Number.isSafeInteger(before.size) || before.size < 0 || before.size > maxBytes
      || (identity && !sameStorageFileIdentity(before, identity))) throw new Error('Migration source identity or byte budget changed.');
    if (destination) output = await fs.open(destination, 'wx', before.mode & 0o777);
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let bytes = 0;
    for (;;) {
      throwIfAborted(signal);
      if (deadline !== null && Date.now() >= deadline) throw new Error('Storage transfer time budget exhausted.');
      const read = await handle.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
      if (bytes > maxBytes || bytes > before.size) throw new Error('Storage transfer source grew beyond its admitted bytes.');
      const chunk = buffer.subarray(0, read.bytesRead);
      hash.update(chunk);
      if (output) {
        let written = 0;
        while (written < chunk.length) {
          const next = await output.write(chunk, written, chunk.length - written, null);
          if (!next.bytesWritten) throw new Error('Storage transfer made no write progress.');
          written += next.bytesWritten;
        }
      }
    }
    verifyContainedFileHandle(handle, root, file);
    const after = storageFileIdentity(await handle.stat({ bigint: true }));
    const sha256 = hash.digest('hex');
    if (!sameStorageFileIdentity(before, after) || bytes !== before.size || (expectedHash && sha256 !== expectedHash)) {
      throw new Error('Storage transfer checksum or source identity changed.');
    }
    if (output) {
      await output.chmod(before.mode & 0o777);
      await output.sync();
    }
    return { sha256, bytes, identity: after };
  } finally {
    if (output) await output.close();
    await handle.close();
  }
};
