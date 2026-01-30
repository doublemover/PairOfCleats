import path from 'node:path';

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
      return path.relative(normalizedDictDir, normalized).split(path.sep).join('/');
    }
  }
  const normalizedRepoRoot = path.resolve(repoRoot);
  if (normalized === normalizedRepoRoot || normalized.startsWith(normalizedRepoRoot + path.sep)) {
    return path.relative(normalizedRepoRoot, normalized).split(path.sep).join('/');
  }
  return normalized;
};
