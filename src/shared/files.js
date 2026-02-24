import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

/**
 * Normalize a file extension to lowercase.
 * @param {string} filePath
 * @returns {string}
 */
export function fileExt(filePath) {
  return path.extname(filePath).toLowerCase();
}

/**
 * Convert a path to POSIX separators.
 * @param {string} filePath
 * @returns {string}
 */
export function toPosix(filePath) {
  if (filePath == null) return '';
  return String(filePath).replace(/\\/g, '/');
}

/**
 * Determine whether a path resolves inside (or equal to) a root directory.
 *
 * @param {string} candidatePath
 * @param {string} rootPath
 * @param {{platform?:string}} [options]
 * @returns {boolean}
 */
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

/**
 * Convert a path to platform separators (accepts POSIX or Windows input).
 * @param {string} filePath
 * @returns {string}
 */
export function fromPosix(filePath) {
  if (filePath == null) return '';
  return toPosix(filePath).split('/').join(path.sep);
}

/**
 * Detect absolute paths using the current platform's semantics.
 * @param {string} value
 * @returns {boolean}
 */
export function isAbsolutePath(value) {
  return isAbsolutePathNative(value);
}

/**
 * Detect absolute paths using an explicit platform's semantics.
 * @param {string} value
 * @param {'win32'|'posix'} platform
 * @returns {boolean}
 */
export function isAbsolutePathNative(value, platform = process.platform) {
  if (typeof value !== 'string') return false;
  return platform === 'win32'
    ? path.win32.isAbsolute(value)
    : path.posix.isAbsolute(value);
}

/**
 * Detect whether a relative path denotes parent traversal (`..` segment).
 * Accepts both separator styles so checks are robust across mixed inputs.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isRelativePathEscape(value) {
  if (typeof value !== 'string') return false;
  return /^\.\.(?:[\\/]|$)/.test(value);
}

/**
 * Detect absolute paths across POSIX and Windows semantics.
 * Only use when you intentionally want cross-platform interpretation.
 * @param {string} value
 * @returns {boolean}
 */
export function isAbsolutePathAny(value) {
  if (typeof value !== 'string') return false;
  return path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

/**
 * Detect UNC paths (e.g. `\\\\server\\share\\path`) with conservative checks.
 * @param {string} value
 * @returns {boolean}
 */
export function isUncPath(value) {
  if (typeof value !== 'string') return false;
  const text = value.replace(/\//g, '\\');
  if (!text.startsWith('\\\\')) return false;
  const parts = text.slice(2).split('\\').filter(Boolean);
  return parts.length >= 2;
}

/**
 * Read a byte range from a file (synchronous).
 * @param {string} filePath
 * @param {number} start
 * @param {number} end
 * @returns {Buffer}
 */
export function readFileRangeSync(filePath, start, end) {
  const safeStart = Number.isFinite(start) ? Math.max(0, Math.floor(start)) : 0;
  const safeEnd = Number.isFinite(end) ? Math.max(safeStart, Math.floor(end)) : safeStart;
  const length = Math.max(0, safeEnd - safeStart);
  if (!length) return Buffer.alloc(0);
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, safeStart);
    return buffer.subarray(0, bytesRead);
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * Async existence probe for files or directories.
 * Returns false for not-found and true for any existing target.
 *
 * @param {string} targetPath
 * @returns {Promise<boolean>}
 */
export async function pathExists(targetPath) {
  if (!targetPath) return false;
  try {
    await fsPromises.access(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort JSON reader for async paths.
 *
 * @param {string} filePath
 * @param {{fallback?:any,maxBytes?:number|null}} [options]
 * @returns {Promise<any>}
 */
export async function readJsonFileSafe(filePath, { fallback = null, maxBytes = null } = {}) {
  if (!filePath) return fallback;
  try {
    if (Number.isFinite(maxBytes) && maxBytes > 0) {
      const stat = await fsPromises.stat(filePath);
      if (Number(stat.size) > Number(maxBytes)) return fallback;
    }
    const raw = await fsPromises.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Best-effort JSON reader for sync tooling paths.
 *
 * @param {string} filePath
 * @param {{fallback?:any,maxBytes?:number|null}} [options]
 * @returns {any}
 */
export function readJsonFileSyncSafe(filePath, { fallback = null, maxBytes = null } = {}) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try {
    if (Number.isFinite(maxBytes) && maxBytes > 0) {
      const stat = fs.statSync(filePath);
      if (Number(stat.size) > Number(maxBytes)) return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Read newline-delimited JSON rows from a file, skipping malformed rows.
 *
 * @param {string} filePath
 * @returns {any[]}
 */
export function readJsonLinesSyncSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const PARSE_FAILED = Symbol('PARSE_FAILED');
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return PARSE_FAILED;
        }
      })
      .filter((entry) => entry !== PARSE_FAILED);
  } catch {
    return [];
  }
}
