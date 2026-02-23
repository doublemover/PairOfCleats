import path from 'node:path';
import { getIndexDir } from '../../shared/dict-utils.js';
import { toPosix } from '../../shared/files.js';
import { hasChunkMetaArtifactsSync } from '../../shared/index-artifact-helpers.js';

/**
 * Resolve the index directory for validation routines.
 *
 * In non-strict mode we prefer the configured cache path but fall back to a
 * local `index-<mode>` directory when it contains recognizable chunk metadata.
 *
 * @param {string} root
 * @param {string} mode
 * @param {object} userConfig
 * @param {string|null} [indexRoot=null]
 * @param {boolean} [strict=false]
 * @returns {string}
 */
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

/**
 * Validate that a manifest-relative path stays within the index root.
 *
 * @param {string} value
 * @returns {boolean}
 */
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
