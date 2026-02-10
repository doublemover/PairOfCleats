import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeRoot } from './shared.js';

export const resolveRecordsRoot = (root, recordsDir) => {
  if (!recordsDir) return null;
  const normalizedRoot = normalizeRoot(root);
  const normalizedRecords = normalizeRoot(recordsDir);
  if (normalizedRecords === normalizedRoot) return normalizedRecords;
  if (normalizedRecords.startsWith(`${normalizedRoot}${path.sep}`)) return normalizedRecords;
  return null;
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
      await handle.close();
    }
  } catch {
    return '';
  }
};
