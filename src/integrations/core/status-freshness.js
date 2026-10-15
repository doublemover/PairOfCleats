import path from 'node:path';
import { loadFileMetaRows } from '../../shared/artifact-io/loaders/core-file-meta.js';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';
import { checksumString } from '../../shared/hash.js';

/** Bounded comparison of indexed files. Optional discovery identifies added paths only after the indexed inventory is complete. */
export const compareIndexedFiles = async ({ repoRoot, indexDir, currentFiles = null, discoveryStatus = 'not-performed', maxFiles = 5000, maxBytes = 8 * 1024 * 1024 }) => {
  const result = { status: 'compared', scope: 'indexed-files-only', checked: 0, unchanged: 0,
    changed: [], missing: [], unknown: [], added: [], truncated: false, newFilesChecked: false,
    discoveryStatus };
  const indexed = new Set();
  let inventoryComplete = true;
  let bytes = 0;
  const started = performance.now();
  try {
    for await (const row of loadFileMetaRows(indexDir, { maxBytes })) {
      if (result.checked >= maxFiles || bytes >= maxBytes || performance.now() - started > 2000) {
        result.truncated = true;
        inventoryComplete = false;
        break;
      }
      result.checked += 1;
      indexed.add(row.file.replace(/\\/g, '/'));
      const record = (kind) => { if (result[kind].length < 100) result[kind].push(row.file); else result.truncated = true; };
      if (!row.hash || !['sha1', 'sha256', 'xxh64'].includes(row.hashAlgo)) {
        record('unknown');
        continue;
      }
      try {
        const read = await readVerifiedContainedFile(repoRoot, path.resolve(repoRoot, row.file), {
          maxBytes: Math.max(0, maxBytes - bytes), hashAlgorithm: row.hashAlgo === 'sha256' ? 'sha256' : 'sha1'
        });
        bytes += read.buffer.length;
        const hash = row.hashAlgo === 'xxh64' ? (await checksumString(read.buffer)).value : read.hash;
        if (hash === row.hash) result.unchanged += 1;
        else record('changed');
      } catch (error) {
        record(error.code === 'ENOENT' ? 'missing' : 'unknown');
      }
    }
  } catch {
    result.status = 'unavailable';
    inventoryComplete = false;
  }
  if (inventoryComplete && Array.isArray(currentFiles)) {
    const added = currentFiles.filter(file => !indexed.has(file.replace(/\\/g, '/'))).sort();
    result.added = added.slice(0, 100);
    result.addedCount = added.length;
    result.truncated ||= added.length > 100 || discoveryStatus !== 'complete';
    result.newFilesChecked = discoveryStatus === 'complete';
    result.scope = 'indexed-files-and-discovered-paths';
  }
  result.bytesRead = bytes;
  return result;
};
