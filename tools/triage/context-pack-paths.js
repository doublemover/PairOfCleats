import path from 'node:path';
import { isAbsolutePathNative } from '../../src/shared/files.js';

/**
 * Resolve a triage record id to a JSON file path under recordsDir.
 *
 * Returns null when the resolved path escapes recordsDir.
 *
 * @param {string} recordsDir
 * @param {string} recordId
 * @returns {string|null}
 */
export const resolveRecordPathSafe = (recordsDir, recordId) => {
  const id = String(recordId || '').trim();
  if (!recordsDir || !id) return null;
  const resolvedRecordsDir = path.resolve(recordsDir);
  const resolvedPath = path.resolve(resolvedRecordsDir, `${id}.json`);
  const relative = path.relative(resolvedRecordsDir, resolvedPath);
  if (relative.startsWith('..') || isAbsolutePathNative(relative)) return null;
  return resolvedPath;
};
