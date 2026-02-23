import path from 'node:path';

/**
 * Resolve a request path under a fixed base directory.
 *
 * Returns `null` when the resolved path escapes the base directory.
 *
 * @param {string} baseDir
 * @param {string} requestPath
 * @param {typeof path} [pathApi]
 * @returns {string|null}
 */
export const safeJoinUnderBase = (baseDir, requestPath, pathApi = path) => {
  if (!baseDir) return null;
  const resolvedBase = pathApi.resolve(baseDir);
  const resolvedTarget = pathApi.resolve(resolvedBase, requestPath || '');
  const relative = pathApi.relative(resolvedBase, resolvedTarget);
  if (relative.startsWith('..') || pathApi.isAbsolute(relative)) return null;
  return resolvedTarget;
};

