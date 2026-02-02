import path from 'node:path';
import { toPosix } from '../../shared/files.js';

export const toRepoPosixPath = (filePath, repoRoot) => {
  if (!filePath) return null;
  const baseRoot = repoRoot ? path.resolve(repoRoot) : null;
  const resolved = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : (baseRoot ? path.resolve(baseRoot, filePath) : path.resolve(filePath));
  const rel = baseRoot ? path.relative(baseRoot, resolved) : resolved;
  const normalized = toPosix(rel).replace(/^\.\//, '');
  if (normalized.startsWith('..')) return null;
  return normalized;
};
