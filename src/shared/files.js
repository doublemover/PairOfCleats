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
  return filePath.split(path.sep).join('/');
}
