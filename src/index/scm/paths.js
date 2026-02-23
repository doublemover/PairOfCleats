import path from 'node:path';
import { isAbsolutePathNative, isRelativePathEscape, toPosix } from '../../shared/files.js';

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
