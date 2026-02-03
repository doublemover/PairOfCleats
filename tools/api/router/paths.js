import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { resolveRepoRoot } from '../../dict-utils.js';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import { isAbsolutePath } from '../../../src/shared/files.js';

const normalizePath = (value) => {
  const resolved = value ? path.resolve(value) : '';
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const toRealPath = (value) => {
  if (!value) return '';
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
};

const toRealPathAsync = async (value) => {
  if (!value) return '';
  try {
    return await fsPromises.realpath(value);
  } catch {
    return path.resolve(value);
  }
};

const isWithinRoot = (candidate, root) => {
  if (!candidate || !root) return false;
  const relative = path.relative(root, candidate);
  if (!relative) return true;
  return !relative.startsWith('..') && !isAbsolutePath(relative);
};

export const createRepoResolver = ({ defaultRepo, allowedRepoRoots = [] }) => {
  const normalizedDefaultRepo = defaultRepo ? path.resolve(defaultRepo) : '';
  const resolvedRepoRoots = [
    normalizedDefaultRepo,
    ...allowedRepoRoots.map((entry) => path.resolve(String(entry || '')))
  ].filter(Boolean);
  const normalizedRepoRoots = resolvedRepoRoots.map((root) => normalizePath(toRealPath(root)));
  const isAllowedRepoPath = (candidate) => normalizedRepoRoots.some((root) => isWithinRoot(candidate, root));

  /**
   * Resolve and validate a repo path.
   * @param {string|null|undefined} value
   * @returns {string}
   */
  const resolveRepo = async (value) => {
    const candidate = value ? path.resolve(value) : normalizedDefaultRepo;
    const candidateReal = await toRealPathAsync(candidate);
    const candidateNormalized = normalizePath(candidateReal);
    if (value && !isAllowedRepoPath(candidateNormalized)) {
      const err = new Error('Repo path not permitted by server configuration.');
      err.code = ERROR_CODES.FORBIDDEN;
      throw err;
    }
    let candidateStat;
    try {
      candidateStat = await fsPromises.stat(candidateReal);
    } catch {
      candidateStat = null;
    }
    if (!candidateStat) {
      throw new Error(`Repo path not found: ${candidate}`);
    }
    if (!candidateStat.isDirectory()) {
      throw new Error(`Repo path is not a directory: ${candidate}`);
    }
    const resolvedRoot = value ? resolveRepoRoot(candidateReal) : candidateReal;
    const resolvedReal = await toRealPathAsync(resolvedRoot);
    const resolvedNormalized = normalizePath(resolvedReal);
    if (value && !isAllowedRepoPath(resolvedNormalized)) {
      if (isAllowedRepoPath(candidateNormalized)) {
        return candidateReal;
      }
      const err = new Error('Resolved repo root not permitted by server configuration.');
      err.code = ERROR_CODES.FORBIDDEN;
      throw err;
    }
    return resolvedReal;
  };

  return { resolveRepo };
};
