import path from 'node:path';
import { isAbsolutePathNative } from '../../src/shared/files.js';

/**
 * Resolve a triage record id to an artifact path under recordsDir.
 *
 * Returns null when the resolved path escapes recordsDir.
 *
 * @param {string} recordsDir
 * @param {string} recordId
 * @param {string} [extension]
 * @returns {string|null}
 */
export const resolveRecordArtifactPathSafe = (recordsDir, recordId, extension = '.json') => {
  const id = String(recordId || '').trim();
  if (!recordsDir || !id) return null;
  if (id.includes('/') || id.includes('\\')) return null;
  const ext = String(extension || '.json');
  const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
  const resolvedRecordsDir = path.resolve(recordsDir);
  const resolvedPath = path.resolve(resolvedRecordsDir, `${id}${normalizedExt}`);
  const relative = path.relative(resolvedRecordsDir, resolvedPath);
  if (relative.startsWith('..') || isAbsolutePathNative(relative)) return null;
  return resolvedPath;
};

/**
 * Resolve a triage record id to a JSON file path under recordsDir.
 *
 * @param {string} recordsDir
 * @param {string} recordId
 * @returns {string|null}
 */
export const resolveRecordPathSafe = (recordsDir, recordId) => (
  resolveRecordArtifactPathSafe(recordsDir, recordId, '.json')
);
