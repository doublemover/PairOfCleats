import path from 'node:path';
import { isAbsolutePathNative, toPosix } from './files.js';

/**
 * Strip a leading "./" prefix from POSIX paths.
 * @param {string} value
 * @returns {string}
 */
const stripDotPrefix = (value) => (
  value.startsWith('./') ? value.slice(2) : value
);

/**
 * Normalize a repo-relative path.
 *
 * Path handling: returns POSIX repo-relative paths or null when outside repo.
 *
 * @param {string} value
 * @param {string} repoRoot
 * @param {{ stripDot?: boolean }} [options]
 * @returns {string|null}
 */
export const normalizeRepoRelativePath = (value, repoRoot, { stripDot = true } = {}) => {
  if (!value) return null;
  const raw = String(value);
  if (!repoRoot) {
    const normalized = toPosix(raw);
    return stripDot ? stripDotPrefix(normalized) : normalized;
  }
  const abs = isAbsolutePathNative(raw) ? raw : path.resolve(repoRoot, raw);
  const rel = path.relative(repoRoot, abs);
  if (!rel || rel.startsWith('..') || isAbsolutePathNative(rel)) return null;
  const normalized = toPosix(rel);
  return stripDot ? stripDotPrefix(normalized) : normalized;
};

/**
 * Normalize a path for repo usage; absolute paths are converted to repo-relative.
 * @param {string} value
 * @param {string} repoRoot
 * @param {{ stripDot?: boolean }} [options]
 * @returns {string|null}
 */
export const normalizePathForRepo = (value, repoRoot, { stripDot = true } = {}) => {
  if (!value) return null;
  const raw = String(value);
  if (!repoRoot) {
    const normalized = toPosix(raw);
    return stripDot ? stripDotPrefix(normalized) : normalized;
  }
  let normalized = raw;
  if (isAbsolutePathNative(raw)) {
    const rel = path.relative(repoRoot, raw);
    if (rel && !rel.startsWith('..') && !isAbsolutePathNative(rel)) {
      normalized = rel;
    }
  }
  normalized = toPosix(normalized);
  return stripDot ? stripDotPrefix(normalized) : normalized;
};

/**
 * Normalize a file path to POSIX, optionally lowercasing.
 * @param {string} value
 * @param {{ lower?: boolean }} [options]
 * @returns {string}
 */
export const normalizeFilePath = (value, { lower = false } = {}) => {
  const normalized = toPosix(String(value || ''));
  return lower ? normalized.toLowerCase() : normalized;
};
