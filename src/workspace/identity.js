import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { isAbsolutePathNative } from '../shared/files.js';

export const normalizeIdentityPath = (value, { platform = process.platform } = {}) => {
  const resolved = value ? path.resolve(String(value)) : '';
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
};

export const toRealPathSync = (value, options = {}) => {
  if (!value) return '';
  try {
    const real = typeof fs.realpathSync?.native === 'function'
      ? fs.realpathSync.native(value)
      : fs.realpathSync(value);
    return normalizeIdentityPath(real, options);
  } catch {
    return normalizeIdentityPath(value, options);
  }
};

export const toRealPath = async (value, options = {}) => {
  if (!value) return '';
  try {
    const real = await fsPromises.realpath(value);
    return normalizeIdentityPath(real, options);
  } catch {
    return normalizeIdentityPath(value, options);
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
