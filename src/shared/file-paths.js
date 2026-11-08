import path from 'node:path';
import { WINDOWS_PATH_BUDGET } from './windows-path-policy.js';

/** Native modules may still use Windows MAX_PATH APIs. Convert only the
 * invocation spelling; callers retain their selected path for identity/leases.
 * Keep ordinary short paths: some native relative-data resolvers cannot join
 * a namespaced base. Node handles long UNC/already-namespaced paths without
 * another prefix. This spelling grants no filesystem or artifact authority. */
export const toNativeFilePath = (filePath, platform = process.platform) => (
  platform === 'win32' && typeof filePath === 'string' && filePath.length > WINDOWS_PATH_BUDGET
    && path.win32.isAbsolute(filePath) ? path.win32.toNamespacedPath(filePath) : filePath
);

export function fileExt(filePath) {
  return path.extname(filePath).toLowerCase();
}

export function toPosix(filePath) {
  if (filePath == null) return '';
  return String(filePath).replace(/\\/g, '/');
}

export function isPathWithinRoot(candidatePath, rootPath, options = {}) {
  if (!candidatePath || !rootPath) return false;
  const platform = typeof options.platform === 'string' ? options.platform : process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const normalizedCandidate = pathApi.resolve(String(candidatePath));
  const normalizedRoot = pathApi.resolve(String(rootPath));
  const candidateForCompare = platform === 'win32'
    ? normalizedCandidate.toLowerCase()
    : normalizedCandidate;
  const rootForCompare = platform === 'win32'
    ? normalizedRoot.toLowerCase()
    : normalizedRoot;
  const boundary = rootForCompare.endsWith(pathApi.sep)
    ? rootForCompare
    : `${rootForCompare}${pathApi.sep}`;
  return candidateForCompare === rootForCompare
    || candidateForCompare.startsWith(boundary);
}

export function isRootPath(targetPath) {
  const resolved = path.resolve(targetPath);
  return path.parse(resolved).root === resolved;
}

export function fromPosix(filePath) {
  if (filePath == null) return '';
  return toPosix(filePath).split('/').join(path.sep);
}

export function isAbsolutePath(value) {
  return isAbsolutePathNative(value);
}

export function isAbsolutePathNative(value, platform = process.platform) {
  if (typeof value !== 'string') return false;
  return platform === 'win32'
    ? path.win32.isAbsolute(value)
    : path.posix.isAbsolute(value);
}

export function isRelativePathEscape(value) {
  if (typeof value !== 'string') return false;
  return /^\.\.(?:[\\/]|$)/.test(value);
}

export function isAbsolutePathAny(value) {
  if (typeof value !== 'string') return false;
  return path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

export function isUncPath(value) {
  if (typeof value !== 'string') return false;
  const text = value.replace(/\//g, '\\');
  if (!text.startsWith('\\\\')) return false;
  const parts = text.slice(2).split('\\').filter(Boolean);
  return parts.length >= 2;
}
