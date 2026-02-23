import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve a request path under a fixed base directory.
 *
 * Returns `null` when the resolved path escapes the base directory.
 *
 * @param {string} baseDir
 * @param {string} requestPath
 * @param {typeof path} [pathApi]
 * @param {{realpathSync?:(targetPath:string)=>string}|{realpathSync:{native?:(targetPath:string)=>string}}} [fsApi]
 * @returns {string|null}
 */
export const safeJoinUnderBase = (baseDir, requestPath, pathApi = path, fsApi = fs) => {
  if (!baseDir) return null;
  const resolvedBase = pathApi.resolve(baseDir);
  const resolvedTarget = pathApi.resolve(resolvedBase, requestPath || '');
  const realpathSync = typeof fsApi?.realpathSync?.native === 'function'
    ? fsApi.realpathSync.native
    : (typeof fsApi?.realpathSync === 'function' ? fsApi.realpathSync : null);
  const canonicalizePath = (targetPath) => {
    if (!realpathSync) return targetPath;
    try {
      return pathApi.resolve(realpathSync(targetPath));
    } catch {
      return targetPath;
    }
  };
  const canonicalBase = canonicalizePath(resolvedBase);
  const canonicalTarget = canonicalizePath(resolvedTarget);
  const relative = pathApi.relative(canonicalBase, canonicalTarget);
  if (relative.startsWith('..') || pathApi.isAbsolute(relative)) return null;
  return canonicalTarget;
};

/**
 * Decode a URL pathname and return null when URI encoding is malformed.
 *
 * @param {string} rawPathname
 * @returns {string|null}
 */
export const decodePathnameSafe = (rawPathname) => {
  try {
    return decodeURIComponent(String(rawPathname || '/'));
  } catch {
    return null;
  }
};
