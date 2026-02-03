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

export const normalizeDictSignaturePath = ({ dictFile, dictDir, repoRoot }) => {
  const normalized = path.resolve(dictFile);
  if (dictDir) {
    const normalizedDictDir = path.resolve(dictDir);
    if (normalized === normalizedDictDir || normalized.startsWith(normalizedDictDir + path.sep)) {
      return toPosix(path.relative(normalizedDictDir, normalized));
    }
  }
  const normalizedRepoRoot = path.resolve(repoRoot);
  if (normalized === normalizedRepoRoot || normalized.startsWith(normalizedRepoRoot + path.sep)) {
    return toPosix(path.relative(normalizedRepoRoot, normalized));
  }
  return normalized;
};
