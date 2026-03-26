import path from 'node:path';

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
