import path from 'node:path';
import { getIndexDir } from '../../shared/dict-utils.js';
import { toPosix } from '../../shared/files.js';
import { hasChunkMetaArtifactsSync } from '../../shared/index-artifact-helpers.js';

export const resolveIndexDir = (root, mode, userConfig, indexRoot = null, strict = false) => {
  const cached = getIndexDir(root, mode, userConfig, { indexRoot });
  if (strict) return cached;
  if (hasChunkMetaArtifactsSync(cached)) {
    return cached;
  }
  const local = path.join(root, `index-${mode}`);
  if (hasChunkMetaArtifactsSync(local)) {
    return local;
  }
  return cached;
};

export const normalizeManifestPath = (value) => toPosix(value);

export const isManifestPathSafe = (value) => {
  if (typeof value !== 'string' || !value) return false;
  const isAbsolute = process.platform === 'win32'
    ? path.win32.isAbsolute(value)
    : path.posix.isAbsolute(value);
  if (isAbsolute) return false;
  const normalized = normalizeManifestPath(value);
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '..')) return false;
  return true;
};
