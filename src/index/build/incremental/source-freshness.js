import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { throwIfAborted } from '../../../shared/abort.js';

// Timestamp precision does not establish content identity: restore/copy tools can
// preserve fine-grained mtimes while changing bytes just as they can coarse ones.
export const requiresSourceHashVerification = () => true;

/** Equal timestamps cannot establish content identity. Fixed-size reads. */
export const sourceEntryIsFresh = async ({ absPath, entry, stat, signal = null }) => {
  if (!entry || entry.size !== stat?.size || entry.mtimeMs !== stat?.mtimeMs) return false;
  if (!absPath || !entry.hash) return false;
  let handle;
  try {
    throwIfAborted(signal);
    handle = await fs.open(absPath, 'r');
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== stat.size || opened.mtimeMs !== stat.mtimeMs) return false;
    const hash = createHash('sha1'), buffer = Buffer.alloc(65536);
    let bytes = 0;
    for (;;) {
      throwIfAborted(signal);
      const read = await handle.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
      if (bytes > stat.size) return false;
      hash.update(buffer.subarray(0, read.bytesRead));
    }
    const after = await handle.stat();
    return bytes === stat.size && after.size === opened.size && after.mtimeMs === opened.mtimeMs
      && after.ctimeMs === opened.ctimeMs && hash.digest('hex') === entry.hash;
  } catch {
    throwIfAborted(signal);
    return false;
  } finally { await handle?.close(); }
};
