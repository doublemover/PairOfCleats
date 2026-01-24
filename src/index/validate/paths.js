import fs from 'node:fs';
import path from 'node:path';
import { getIndexDir } from '../../../tools/dict-utils.js';

export const resolveIndexDir = (root, mode, userConfig, indexRoot = null, strict = false) => {
  const cached = getIndexDir(root, mode, userConfig, { indexRoot });
  if (strict) return cached;
  const cachedMeta = path.join(cached, 'chunk_meta.json');
  const cachedMetaJsonl = path.join(cached, 'chunk_meta.jsonl');
  const cachedMetaParts = path.join(cached, 'chunk_meta.meta.json');
  if (fs.existsSync(cachedMeta) || fs.existsSync(cachedMetaJsonl) || fs.existsSync(cachedMetaParts)) {
    return cached;
  }
  const local = path.join(root, `index-${mode}`);
  const localMeta = path.join(local, 'chunk_meta.json');
  const localMetaJsonl = path.join(local, 'chunk_meta.jsonl');
  const localMetaParts = path.join(local, 'chunk_meta.meta.json');
  if (fs.existsSync(localMeta) || fs.existsSync(localMetaJsonl) || fs.existsSync(localMetaParts)) {
    return local;
  }
  return cached;
};

export const normalizeManifestPath = (value) => String(value || '').split('\\').join('/');

export const isManifestPathSafe = (value) => {
  if (typeof value !== 'string' || !value) return false;
  if (path.isAbsolute(value)) return false;
  if (value.startsWith('/')) return false;
  const normalized = normalizeManifestPath(value);
  if (normalized.includes('..')) return false;
  return true;
};
