import { openContainedFile, verifyContainedFileHandle } from '../../../shared/contained-file.js';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { throwIfAborted } from '../../../shared/abort.js';

// Timestamp precision does not establish content identity: restore/copy tools can
// preserve fine-grained mtimes while changing bytes just as they can coarse ones.
export const requiresSourceHashVerification = () => true;

/** Equal timestamps cannot establish content identity. Fixed-size reads. */
export const sourceEntryIsFresh = async ({ absPath, entry, stat, signal = null,
  repoRoot = null, strict = false, metrics = null }) => {
  if (!entry || entry.size !== stat?.size || entry.mtimeMs !== stat?.mtimeMs) return false;
  if (!absPath || !entry.hash) return false;
  let handle;
  try {
    throwIfAborted(signal);
    handle = repoRoot ? await openContainedFile(repoRoot, absPath) : await fs.open(absPath, 'r');
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== stat.size || opened.mtimeMs !== stat.mtimeMs) return false;
    const hash = createHash('sha1'), buffer = Buffer.alloc(65536);
    let bytes = 0;
    for (;;) {
      throwIfAborted(signal);
      const read = await handle.read(buffer, 0, buffer.length, null);
      if (!Number.isSafeInteger(read.bytesRead) || read.bytesRead < 0 || read.bytesRead > buffer.length) {
        throw new Error('Invalid source verification read progress.');
      }
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
      if (metrics) metrics.sourceVerificationBytes += read.bytesRead;
      if (bytes > stat.size) return false;
      hash.update(buffer.subarray(0, read.bytesRead));
    }
    const after = await handle.stat();
    if (repoRoot) verifyContainedFileHandle(handle, repoRoot, absPath);
    return bytes === stat.size && after.size === opened.size && after.mtimeMs === opened.mtimeMs
      && after.ctimeMs === opened.ctimeMs && hash.digest('hex') === entry.hash;
  } catch (error) {
    throwIfAborted(signal);
    if (strict && !['ENOENT', 'ENOTDIR', 'ERR_UNSAFE_FILE_PATH', 'ERR_FILE_CHANGED'].includes(error.code)) throw error;
    return false;
  } finally { await handle?.close(); }
};
