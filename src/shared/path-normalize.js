import path from 'node:path';
import fs from 'node:fs';
import { isAbsolutePathNative, isRelativePathEscape, toPosix } from './files.js';

const stripDotPrefix = (value) => (
  value.startsWith('./') ? value.slice(2) : value
);
const WINDOWS_DRIVE_PREFIX_RE = /^([a-zA-Z]):/;

const hasWindowsPathHint = (value) => {
  const text = String(value || '');
  if (!text) return false;
  if (text.startsWith('\\\\')) return true;
  if (text.length < 3) return false;
  const code = text.charCodeAt(0);
  const isAsciiLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
  return isAsciiLetter && text[1] === ':' && (text[2] === '\\' || text[2] === '/');
};

const shouldUseWin32PathApi = (repoRoot, rawPath) => {
  const repoText = String(repoRoot || '');
  const rawText = String(rawPath || '');
  if (isAbsolutePathNative(repoText, 'win32') || hasWindowsPathHint(repoText)) {
    return true;
  }
  if (isAbsolutePathNative(rawText, 'win32') || hasWindowsPathHint(rawText)) {
    return true;
  }
  return false;
};

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
  const useWin32 = shouldUseWin32PathApi(repoRoot, raw);
  const platform = useWin32 ? 'win32' : 'posix';
  const pathApi = useWin32 ? path.win32 : path.posix;
  const normalizedRoot = normalizePathForPlatform(repoRoot, { platform });
  const normalizedRaw = normalizePathForPlatform(raw, { platform });
  const abs = isAbsolutePathNative(normalizedRaw, platform)
    ? normalizedRaw
    : pathApi.resolve(normalizedRoot, normalizedRaw);
  const rel = pathApi.relative(normalizedRoot, abs);
  if (isRelativePathEscape(rel) || isAbsolutePathNative(rel, platform)) return null;
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
    if (!isRelativePathEscape(rel) && !isAbsolutePathNative(rel)) {
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

/**
 * Normalize a Windows drive letter prefix to uppercase (`c:` -> `C:`).
 * Non-drive-prefixed values are returned unchanged.
 *
 * @param {string} value
 * @returns {string}
 */
export const normalizeWindowsDriveLetter = (value) => {
  const text = String(value || '');
  const prefix = (text.startsWith('\\\\?\\') || text.startsWith('\\\\.\\'))
    ? text.slice(0, 4)
    : '';
  const body = prefix ? text.slice(prefix.length) : text;
  const match = WINDOWS_DRIVE_PREFIX_RE.exec(body);
  if (!match) return text;
  return `${prefix}${match[1].toUpperCase()}:${body.slice(2)}`;
};

/**
 * Normalize path separators and root forms for the selected platform.
 *
 * Rules:
 * - strips NUL bytes
 * - preserves spaces (no trimming of interior text)
 * - normalizes repeated separators
 * - normalizes Windows drive-letter casing
 * - preserves UNC roots on Windows
 *
 * @param {unknown} value
 * @param {{platform?:'win32'|'posix'}} [options]
 * @returns {string}
 */
export const normalizePathForPlatform = (value, { platform = process.platform } = {}) => {
  if (value == null) return '';
  let text = String(value);
  if (!text) return '';
  text = text.replace(/\0/g, '');
  if (!text) return '';
  if (platform === 'win32') {
    const slashed = text.replace(/\//g, '\\');
    const isUnc = slashed.startsWith('\\\\');
    let normalized = isUnc
      ? `\\\\${slashed.slice(2).replace(/[\\]+/g, '\\')}`
      : slashed.replace(/[\\]+/g, '\\');
    normalized = normalizeWindowsDriveLetter(normalized);
    return normalized;
  }
  const slashed = text.replace(/\\/g, '/');
  if (!slashed.startsWith('//')) {
    return slashed.replace(/\/+/g, '/');
  }
  const rest = slashed
    .slice(2)
    .replace(/^\/+/g, '')
    .replace(/\/+/g, '/');
  return rest ? `//${rest}` : '//';
};

/**
 * Resolve and normalize a child path under `baseDir`.
 * Returns null when the resolved path escapes the base.
 *
 * @param {string} baseDir
 * @param {string[]} segments
 * @param {{platform?:'win32'|'posix'}} [options]
 * @returns {string|null}
 */
export const joinPathSafe = (baseDir, segments, { platform = process.platform } = {}) => {
  if (!baseDir) return null;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const normalizedBase = normalizePathForPlatform(baseDir, { platform });
  if (!normalizedBase) return null;
  const normalizedSegments = Array.isArray(segments)
    ? segments.map((entry) => normalizePathForPlatform(entry, { platform }))
    : [];
  const resolved = pathApi.resolve(normalizedBase, ...normalizedSegments);
  const rel = pathApi.relative(pathApi.resolve(normalizedBase), resolved);
  if (isRelativePathEscape(rel) || isAbsolutePathNative(rel, platform)) {
    return null;
  }
  return normalizePathForPlatform(resolved, { platform });
};

/**
 * Return true when targetPath is at or under baseDir.
 * @param {string} baseDir
 * @param {string} targetPath
 * @returns {boolean}
 */
export const isPathUnderDir = (baseDir, targetPath) => {
  if (!baseDir || !targetPath) return false;
  const resolveCanonicalPath = (inputPath) => {
    let resolved = path.resolve(inputPath);
    let remainder = '';
    while (!fs.existsSync(resolved)) {
      const parent = path.dirname(resolved);
      if (!parent || parent === resolved) break;
      remainder = path.join(path.basename(resolved), remainder);
      resolved = parent;
    }
    let canonicalBase = resolved;
    try {
      canonicalBase = fs.realpathSync.native(resolved);
    } catch {}
    return remainder ? path.resolve(canonicalBase, remainder) : canonicalBase;
  };
  const canonicalBaseDir = resolveCanonicalPath(baseDir);
  const canonicalTargetPath = resolveCanonicalPath(targetPath);
  const rel = path.relative(canonicalBaseDir, canonicalTargetPath);
  return rel === '' || (!isRelativePathEscape(rel) && !isAbsolutePathNative(rel));
};
