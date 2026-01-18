import path from 'node:path';

export const TANTIVY_SCHEMA_VERSION = 1;
export const TANTIVY_META_FILE = 'tantivy.meta.json';

const normalizeText = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export function normalizeTantivyConfig(raw = {}) {
  if (raw === false) {
    return { enabled: false, path: null, autoBuild: false };
  }
  if (raw === true) {
    return { enabled: true, path: null, autoBuild: false };
  }
  const config = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: config.enabled === true,
    path: normalizeText(config.path),
    autoBuild: config.autoBuild === true
  };
}

export function resolveTantivyDir(indexDir, mode, config = {}) {
  if (config?.path) {
    const raw = config.path;
    const resolved = raw.includes('{mode}')
      ? raw.replace('{mode}', mode)
      : path.join(raw, mode);
    return path.resolve(resolved);
  }
  return path.join(indexDir, 'tantivy', mode);
}

export function resolveTantivyPaths(indexDir, mode, config = {}) {
  const dir = resolveTantivyDir(indexDir, mode, config);
  return {
    dir,
    metaPath: path.join(dir, TANTIVY_META_FILE)
  };
}
