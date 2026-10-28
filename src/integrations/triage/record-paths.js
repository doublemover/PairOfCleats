import path from 'node:path';
import { isAbsolutePathNative, isRelativePathEscape } from '../../shared/file-paths.js';

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
  if (typeof recordsDir !== 'string' || !recordsDir || typeof recordId !== 'string'
    || !recordId || recordId !== recordId.trim() || typeof extension !== 'string') return null;
  const id = recordId;
  if (/[\\/\0]/u.test(id)) return null;
  const ext = extension || '.json';
  if (/[\\/\0]/u.test(ext)) return null;
  const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
  const leaf = `${id}${normalizedExt}`;
  // Containment alone cannot distinguish an ordinary Windows file from an
  // alternate stream or DOS device. Validate the complete selected component,
  // including the extension, before either reader or writer performs any IO.
  if (process.platform === 'win32' && (leaf.length > 255 || /[<>:"|?*\x01-\x1f]/u.test(leaf)
    || /[. ]$/u.test(leaf) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?: *\.|$)/iu.test(leaf))) return null;
  const resolvedRecordsDir = path.resolve(recordsDir);
  const resolvedPath = path.resolve(resolvedRecordsDir, leaf);
  const relative = path.relative(resolvedRecordsDir, resolvedPath);
  if (isRelativePathEscape(relative) || isAbsolutePathNative(relative)) return null;
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
