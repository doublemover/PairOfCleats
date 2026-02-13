import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { isWithinRoot, resolveRepoRoot, toRealPath, toRealPathSync } from '../../shared/dict-utils.js';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';

export const createRepoResolver = ({ defaultRepo, allowedRepoRoots = [] }) => {
  const normalizedDefaultRepo = defaultRepo ? path.resolve(defaultRepo) : '';
  const resolvedRepoRoots = [
    normalizedDefaultRepo,
    ...allowedRepoRoots.map((entry) => path.resolve(String(entry || '')))
  ].filter(Boolean);
  const canonicalRepoRoots = resolvedRepoRoots.map((root) => toRealPathSync(root));
  const isAllowedRepoPath = (candidate) => canonicalRepoRoots.some((root) => isWithinRoot(candidate, root));

  /**
   * Resolve and validate a repo path.
   *
   * For explicit repo inputs, we resolve VCS root when possible, but preserve
   * the validated explicit path when the discovered VCS root sits above the
   * configured allowlist boundary (common in monorepos with nested allowlists).
   *
   * @param {string|null|undefined} value
   * @returns {string}
   */
  const resolveRepo = async (value) => {
    const candidate = value ? path.resolve(value) : normalizedDefaultRepo;
    const candidateCanonical = await toRealPath(candidate);
    if (value && !isAllowedRepoPath(candidateCanonical)) {
      const err = new Error('Repo path not permitted by server configuration.');
      err.code = ERROR_CODES.FORBIDDEN;
      throw err;
    }
    let candidateStat;
    try {
      candidateStat = await fsPromises.stat(candidateCanonical);
    } catch {
      candidateStat = null;
    }
    if (!candidateStat) {
      throw new Error(`Repo path not found: ${candidate}`);
    }
    if (!candidateStat.isDirectory()) {
      throw new Error(`Repo path is not a directory: ${candidate}`);
    }
    const resolvedRoot = value ? resolveRepoRoot(candidateCanonical) : candidateCanonical;
    const resolvedCanonical = await toRealPath(resolvedRoot);
    if (value) {
      if (isAllowedRepoPath(resolvedCanonical)) return resolvedCanonical;
      // Preserve explicit allowlisted subdirectory requests when their VCS root
      // sits above the configured allowlist boundary (for example monorepos).
      return candidateCanonical;
    }
    return resolvedCanonical;
  };

  return { resolveRepo };
};
