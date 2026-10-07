import path from 'node:path';
import { isAbsolutePathNative, isRelativePathEscape, toPosix } from '../../shared/file-paths.js';

export const toRepoPosixPath = (filePath, repoRoot) => {
  if (!filePath) return null;
  const baseRoot = repoRoot ? path.resolve(repoRoot) : null;
  const resolved = isAbsolutePathNative(filePath)
    ? path.resolve(filePath)
    : (baseRoot ? path.resolve(baseRoot, filePath) : path.resolve(filePath));
  const rel = baseRoot ? path.relative(baseRoot, resolved) : resolved;
  const normalized = toPosix(rel).replace(/^\.\//, '');
  if (isRelativePathEscape(normalized)) return null;
  return normalized;
};

export const normalizeScmFileKey = (filePath, {
  repoRoot = null,
  rejectEscape = true
} = {}) => {
  const normalized = repoRoot
    ? toRepoPosixPath(filePath, repoRoot)
    : toPosix(String(filePath || '')).replace(/^\.\//, '').trim();
  if (!normalized) return null;
  if (rejectEscape && isRelativePathEscape(normalized)) return null;
  return normalized;
};

export const toUniqueRepoPosixFiles = (files = [], {
  repoRoot = null,
  rejectEscape = true,
  sort = false
} = {}) => {
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(files) ? files : []) {
    const normalized = normalizeScmFileKey(raw, { repoRoot, rejectEscape });
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  if (sort) output.sort((left, right) => left.localeCompare(right));
  return output;
};
