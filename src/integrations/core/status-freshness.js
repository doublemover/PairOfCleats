import path from 'node:path';
import { loadFileMetaRows } from '../../shared/artifact-io/loaders/core-file-meta.js';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';
import { checksumString } from '../../shared/hash.js';

/** Bounded comparison of indexed files. New/unindexed files are explicitly outside this evidence. */
export const compareIndexedFiles = async ({ repoRoot, indexDir, maxFiles = 5000, maxBytes = 8 * 1024 * 1024 }) => {
  const result = { status: 'compared', scope: 'indexed-files-only', checked: 0, unchanged: 0,
    changed: [], missing: [], unknown: [], truncated: false, newFilesChecked: false };
  let bytes = 0;
  const started = performance.now();
  try {
    for await (const row of loadFileMetaRows(indexDir, { maxBytes })) {
      if (result.checked >= maxFiles || bytes >= maxBytes || performance.now() - started > 2000) {
        result.truncated = true;
        break;
      }
      result.checked += 1;
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
  }
  result.bytesRead = bytes;
  return result;
};
