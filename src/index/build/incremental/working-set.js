import fs from 'node:fs/promises';
import path from 'node:path';
import { throwIfAborted } from '../../../shared/abort.js';
import { createSemanticDiskAccount } from '../artifacts/writers/semantic/partition.js';

/** Reopen the existing cache/staging footprint before granting new disk credits.
 * Count physical files once across overlapping roots and hard links. Do not
 * follow links out of the owned cache. Pending and corrupt objects still cost
 * storage; they cannot disappear from accounting because they are not reusable.
 */
export const reopenSemanticDiskAccount = async ({ limit, roots, signal = null }) => {
  const account = createSemanticDiskAccount(limit);
  const seenPaths = new Set(), seenFiles = new Set();
  const pending = [...new Set(roots.filter(Boolean).map(root => path.resolve(root)))];
  let files = 0;
  while (pending.length) {
    throwIfAborted(signal);
    const filename = pending.pop();
    if (seenPaths.has(filename)) continue;
    seenPaths.add(filename);
    let stat;
    try { stat = await fs.lstat(filename); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink()) throw Object.assign(new Error('Semantic working-set roots cannot contain symbolic links: ' + filename), { code: 'ERR_SEMANTIC_INTEGRITY' });
    if (stat.isDirectory()) {
      const directory = await fs.opendir(filename);
      for await (const entry of directory) pending.push(path.join(filename, entry.name));
    } else if (stat.isFile()) {
      const key = stat.ino ? stat.dev + ':' + stat.ino : filename;
      if (seenFiles.has(key)) continue;
      seenFiles.add(key);
      account.reserve(stat.size);
      files += 1;
    }
  }
  return { account, retainedBytes: account.used, retainedFiles: files };
};
