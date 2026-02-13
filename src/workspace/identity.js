import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { isAbsolutePathNative } from '../shared/files.js';

export const normalizeIdentityPath = (value, { platform = process.platform } = {}) => {
  const resolved = value ? path.resolve(String(value)) : '';
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const realpathSyncCompat = (value) => (
  typeof fs.realpathSync?.native === 'function'
    ? fs.realpathSync.native(value)
    : fs.realpathSync(value)
);

/**
 * Resolve a path by realpathing the nearest existing ancestor and appending any
 * non-existent suffix segments.
 *
 * This keeps canonicalization stable for paths that do not yet exist while still
 * honoring symlink/junction boundaries in the existing portion of the path.
 *
 * @param {string} value
 * @returns {string}
 */
const resolveRealPathWithExistingAncestorSync = (value) => {
  const absolute = path.resolve(String(value));
  let current = absolute;
  const suffix = [];
  while (true) {
    try {
      const realAncestor = realpathSyncCompat(current);
      let resolved = realAncestor;
      for (let i = suffix.length - 1; i >= 0; i -= 1) {
        resolved = path.join(resolved, suffix[i]);
      }
      return resolved;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) break;
      const name = path.basename(current);
      if (name) suffix.push(name);
      current = parent;
    }
  }
  return absolute;
};

/**
 * Async variant of {@link resolveRealPathWithExistingAncestorSync}.
 *
 * @param {string} value
 * @returns {Promise<string>}
 */
const resolveRealPathWithExistingAncestor = async (value) => {
  const absolute = path.resolve(String(value));
  let current = absolute;
  const suffix = [];
  while (true) {
    try {
      const realAncestor = await fsPromises.realpath(current);
      let resolved = realAncestor;
      for (let i = suffix.length - 1; i >= 0; i -= 1) {
        resolved = path.join(resolved, suffix[i]);
      }
      return resolved;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) break;
      const name = path.basename(current);
      if (name) suffix.push(name);
      current = parent;
    }
  }
  return absolute;
};

export const toRealPathSync = (value, options = {}) => {
  if (!value) return '';
  try {
    const real = realpathSyncCompat(value);
    return normalizeIdentityPath(real, options);
  } catch {
    return normalizeIdentityPath(resolveRealPathWithExistingAncestorSync(value), options);
  }
};

export const toRealPath = async (value, options = {}) => {
  if (!value) return '';
  try {
    const real = await fsPromises.realpath(value);
    return normalizeIdentityPath(real, options);
  } catch {
    const resolved = await resolveRealPathWithExistingAncestor(value);
    return normalizeIdentityPath(resolved, options);
  }
};

export const isWithinRoot = (candidate, root, options = {}) => {
  const normalizedCandidate = normalizeIdentityPath(candidate, options);
  const normalizedRoot = normalizeIdentityPath(root, options);
  if (!normalizedCandidate || !normalizedRoot) return false;
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  if (!relative) return true;
  return !relative.startsWith('..') && !isAbsolutePathNative(relative);
};
