import path from 'node:path';
import { toPosix } from '../../../shared/files.js';

export const normalizeParser = (raw, fallback, allowed) => {
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return allowed.includes(normalized) ? normalized : fallback;
};

export const normalizeFlowSetting = (raw) => {
  if (raw === true) return 'on';
  if (raw === false) return 'off';
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return ['auto', 'on', 'off'].includes(normalized) ? normalized : 'auto';
};

const resolvePath = (value) => path.resolve(String(value || ''));

const normalizeAbsolutePathForSignature = (value) => {
  const normalized = path.normalize(value);
  if (process.platform !== 'win32') return normalized;
  return normalized.replace(/^[A-Z]:/, (drive) => drive.toLowerCase());
};

const toPosixRelative = (from, to) => {
  const relative = path.relative(from, to);
  if (!relative || relative === '.') return '';
  return toPosix(relative);
};

const isWithinRoot = (rootPath, targetPath) => {
  const relative = path.relative(rootPath, targetPath);
  if (!relative || relative === '.') return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
};

export const normalizeDictSignaturePath = ({ dictFile, dictDir, repoRoot }) => {
  const normalized = resolvePath(dictFile);
  if (dictDir) {
    const normalizedDictDir = resolvePath(dictDir);
    if (isWithinRoot(normalizedDictDir, normalized)) {
      return toPosixRelative(normalizedDictDir, normalized);
    }
  }
  const normalizedRepoRoot = resolvePath(repoRoot);
  if (isWithinRoot(normalizedRepoRoot, normalized)) {
    return toPosixRelative(normalizedRepoRoot, normalized);
  }
  return toPosix(normalizeAbsolutePathForSignature(normalized));
};
