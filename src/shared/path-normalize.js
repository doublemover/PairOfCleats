import path from 'node:path';
import { isAbsolutePathNative, toPosix } from './files.js';

const stripDotPrefix = (value) => (
  value.startsWith('./') ? value.slice(2) : value
);

/**
 * Normalize a path into repo-relative form, or return null when outside root.
 * @param {unknown} value
 * @param {string|null} repoRoot
 * @param {{stripDot?:boolean}} [options]
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
 * Normalize a file path for a repository, preferring repo-relative values.
 * @param {unknown} value
 * @param {string|null} repoRoot
 * @param {{stripDot?:boolean}} [options]
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
 * Normalize a file path to POSIX and optionally lower-case it.
 * @param {unknown} value
 * @param {{lower?:boolean}} [options]
 * @returns {string}
 */
export const normalizeFilePath = (value, { lower = false } = {}) => {
  const normalized = toPosix(String(value || ''));
  return lower ? normalized.toLowerCase() : normalized;
};
