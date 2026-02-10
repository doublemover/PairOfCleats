import path from 'node:path';
import { isPathUnderDir } from '../../src/shared/path-normalize.js';

/**
 * Check if a path is contained within another path.
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
export function isInside(parent, child) {
  return isPathUnderDir(parent, child);
}

/**
 * Guard against deleting filesystem root paths.
 * @param {string} targetPath
 * @returns {boolean}
 */
export function isRootPath(targetPath) {
  const resolved = path.resolve(targetPath);
  return path.parse(resolved).root === resolved;
}
