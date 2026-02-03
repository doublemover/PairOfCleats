import path from 'node:path';
import { isAbsolutePathNative } from '../../src/shared/files.js';

/**
 * Check if a path is contained within another path.
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
export function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolutePathNative(rel));
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
