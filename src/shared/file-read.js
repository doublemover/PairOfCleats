import fs from 'node:fs';
import fsPromises from 'node:fs/promises';

const normalizeJsonReadOptions = (options) => (
  options && typeof options === 'object' && !Array.isArray(options)
    ? options
    : { fallback: options }
);

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

export async function pathExists(targetPath) {
  if (!targetPath) return false;
  try {
    await fsPromises.access(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFileSafe(
  filePath,
  options = {}
) {
  const { fallback = null, maxBytes = null, onError = null } = normalizeJsonReadOptions(options);
  if (!filePath) return fallback;
  const emitError = (phase, error) => {
    if (typeof onError !== 'function') return;
    try {
      onError({ path: String(filePath), error, phase, sync: false });
    } catch {}
  };
  if (Number.isFinite(maxBytes) && maxBytes > 0) {
    try {
      const stat = await fsPromises.stat(filePath);
      if (Number(stat.size) > Number(maxBytes)) {
        const error = new Error(
          `JSON file exceeds maxBytes (${Number(stat.size)} > ${Number(maxBytes)})`
        );
        error.code = 'ERR_JSON_FILE_TOO_LARGE';
        emitError('stat', error);
        return fallback;
      }
    } catch (error) {
      emitError('stat', error);
      return fallback;
    }
  }
  let raw = '';
  try {
    raw = await fsPromises.readFile(filePath, 'utf8');
  } catch (error) {
    emitError('read', error);
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    emitError('parse', error);
    return fallback;
  }
}

export function readJsonFileSyncSafe(
  filePath,
  options = {}
) {
  const { fallback = null, maxBytes = null, onError = null } = normalizeJsonReadOptions(options);
  if (!filePath) return fallback;
  const emitError = (phase, error) => {
    if (typeof onError !== 'function') return;
    try {
      onError({ path: String(filePath), error, phase, sync: true });
    } catch {}
  };
  if (Number.isFinite(maxBytes) && maxBytes > 0) {
    try {
      const stat = fs.statSync(filePath);
      if (Number(stat.size) > Number(maxBytes)) {
        const error = new Error(
          `JSON file exceeds maxBytes (${Number(stat.size)} > ${Number(maxBytes)})`
        );
        error.code = 'ERR_JSON_FILE_TOO_LARGE';
        emitError('stat', error);
        return fallback;
      }
    } catch (error) {
      emitError('stat', error);
      return fallback;
    }
  }
  let raw = '';
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    emitError('read', error);
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    emitError('parse', error);
    return fallback;
  }
}

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
