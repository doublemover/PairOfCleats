import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  MIN_COMPACT_TOKEN_CHARS,
  WINDOWS_PATH_BUDGET
} from './persistence-helpers.js';

let tempPathCounter = 0;

const createTempToken = () => {
  tempPathCounter = (tempPathCounter + 1) >>> 0;
  const counter = tempPathCounter.toString(16).padStart(8, '0');
  const hr = process.hrtime.bigint().toString(16);
  const random = crypto.randomBytes(6).toString('hex');
  return `${process.pid}-${hr}-${counter}-${random}`;
};

export const createTempPath = (filePath, options = {}) => {
  const preferFallback = options?.preferFallback === true;
  const token = createTempToken();
  const suffix = `.tmp-${token}`;
  const tempPath = `${filePath}${suffix}`;
  if (process.platform !== 'win32' || tempPath.length <= WINDOWS_PATH_BUDGET) {
    return tempPath;
  }
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const compactToken = crypto
    .createHash('sha256')
    .update(filePath)
    .update(':')
    .update(token)
    .digest('hex');

  const buildCompactPathInDir = (baseDir, maxLen, withExt = true) => {
    const suffixExt = withExt ? ext : '';
    const prefix = 't.tmp-';
    const budget = maxLen - baseDir.length - 1 - prefix.length - suffixExt.length;
    if (budget < MIN_COMPACT_TOKEN_CHARS) return null;
    const tokenBudget = Math.min(compactToken.length, budget);
    const name = `${prefix}${compactToken.slice(0, tokenBudget)}`;
    return path.join(baseDir, `${name}${suffixExt}`);
  };

  const isCandidateDirWritable = (candidateDir) => {
    if (typeof candidateDir !== 'string' || !candidateDir) return false;
    let probe = candidateDir;
    while (!fsSync.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (!parent || parent === probe) return false;
      probe = parent;
    }
    try {
      fsSync.accessSync(probe, fsSync.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  };

  const buildCompactPathInAncestors = (maxLen, withExt = true) => {
    let baseDir = dir;
    while (baseDir) {
      const candidate = buildCompactPathInDir(baseDir, maxLen, withExt);
      if (candidate && isCandidateDirWritable(baseDir)) return candidate;
      const parent = path.dirname(baseDir);
      if (!parent || parent === baseDir) break;
      baseDir = parent;
    }
    return null;
  };

  const buildFallbackTempPath = (withExt = true) => {
    const suffixExt = withExt ? ext : '';
    const baseDir = path.join(dir, '.poc-atomic');
    const name = `t.tmp-${compactToken}`;
    if (!isCandidateDirWritable(baseDir)) return null;
    return path.join(baseDir, `${name}${suffixExt}`);
  };

  const compactCandidate = preferFallback
    ? null
    : (
      buildCompactPathInAncestors(WINDOWS_PATH_BUDGET, true)
      || buildCompactPathInAncestors(WINDOWS_PATH_BUDGET, false)
    );
  return compactCandidate
    || buildFallbackTempPath(true)
    || buildFallbackTempPath(false)
    || tempPath;
};
