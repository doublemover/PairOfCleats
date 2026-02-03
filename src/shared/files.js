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
 * Detect absolute paths using the current platform's semantics.
 * @param {string} value
 * @returns {boolean}
 */
export function isAbsolutePath(value) {
  return isAbsolutePathNative(value);
}

/**
 * Detect absolute paths using an explicit platform's semantics.
 * @param {string} value
 * @param {'win32'|'posix'} platform
 * @returns {boolean}
 */
export function isAbsolutePathNative(value, platform = process.platform) {
  if (typeof value !== 'string') return false;
  return platform === 'win32'
    ? path.win32.isAbsolute(value)
    : path.posix.isAbsolute(value);
}

/**
 * Detect absolute paths across POSIX and Windows semantics.
 * Only use when you intentionally want cross-platform interpretation.
 * @param {string} value
 * @returns {boolean}
 */
export function isAbsolutePathAny(value) {
  if (typeof value !== 'string') return false;
  return path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}
