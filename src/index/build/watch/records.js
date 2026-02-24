import fs from 'node:fs/promises';
import { runBuildCleanupWithTimeout } from '../cleanup-timeout.js';
import { normalizeRoot } from './shared.js';
import { isWithinRoot, toRealPathSync } from '../../../workspace/identity.js';

export const resolveRecordsRoot = (root, recordsDir) => {
  if (!recordsDir) return null;
  const normalizedRecords = normalizeRoot(recordsDir);
  const canonicalRoot = toRealPathSync(root);
  const canonicalRecords = toRealPathSync(recordsDir);
  if (!isWithinRoot(canonicalRecords, canonicalRoot)) return null;
  return normalizedRecords;
};

export const readRecordSample = async (absPath, maxBytes) => {
  const limit = Number.isFinite(Number(maxBytes)) && Number(maxBytes) > 0
    ? Math.floor(Number(maxBytes))
    : 16384;
  try {
    const handle = await fs.open(absPath, 'r');
    try {
      const buffer = Buffer.alloc(limit);
      const result = await handle.read(buffer, 0, limit, 0);
      return buffer.subarray(0, result.bytesRead || 0).toString('utf8');
    } finally {
      await runBuildCleanupWithTimeout({
        label: 'watch.records.read-sample.close',
        cleanup: () => handle.close(),
        swallowTimeout: false
      });
    }
  } catch {
    return '';
  }
};
