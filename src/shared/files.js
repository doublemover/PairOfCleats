import path from 'node:path';

/**
 * Normalize a file extension to lowercase.
 * @param {string} filePath
 * @returns {string}
 */
export function fileExt(filePath) {
  return path.extname(filePath).toLowerCase();
}

/**
 * Convert a path to POSIX separators.
 * @param {string} filePath
 * @returns {string}
 */
export function toPosix(filePath) {
  if (filePath == null) return '';
  return String(filePath).replace(/\\/g, '/');
}

/**
 * Convert a path to platform separators (accepts POSIX or Windows input).
 * @param {string} filePath
 * @returns {string}
 */
export function fromPosix(filePath) {
  if (filePath == null) return '';
  return toPosix(filePath).split('/').join(path.sep);
}

/**
 * Detect absolute paths for both POSIX and Windows-style inputs.
 * @param {string} value
 * @returns {boolean}
 */
export function isAbsolutePath(value) {
  if (typeof value !== 'string') return false;
  return path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}
