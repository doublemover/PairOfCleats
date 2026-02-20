import { checksumString } from '../../../shared/hash.js';
import { buildCacheKey } from '../../../shared/cache-key.js';
import {
  VFS_DOC_HASH_CACHE_MAX,
  VFS_DOC_HASH_CACHE_SCHEMA_VERSION
} from './constants.js';

const VFS_DOC_HASH_CACHE = new Map();

/**
 * Build an LRU cache key for segment-scoped document hashing.
 *
 * @param {{
 *   fileHash:string,
 *   fileHashAlgo?:string|null,
 *   languageId?:string|null,
 *   effectiveExt?:string|null,
 *   segmentStart:number,
 *   segmentEnd:number
 * }} input
 * @returns {string|null}
 */
export const buildDocHashCacheKey = ({
  fileHash,
  fileHashAlgo,
  languageId,
  effectiveExt,
  segmentStart,
  segmentEnd
}) => {
  if (!fileHash) return null;
  const algo = fileHashAlgo || 'sha1';
  const lang = languageId || 'unknown';
  const ext = effectiveExt || '';
  const range = `${segmentStart}-${segmentEnd}`;
  return buildCacheKey({
    repoHash: `${algo}:${fileHash}`,
    buildConfigHash: null,
    mode: 'vfs',
    schemaVersion: VFS_DOC_HASH_CACHE_SCHEMA_VERSION,
    featureFlags: [`lang:${lang}`, `ext:${ext}`],
    pathPolicy: 'posix',
    extra: { range }
  }).key;
};

const getCachedDocHash = (cacheKey) => {
  if (!cacheKey) return null;
  const cached = VFS_DOC_HASH_CACHE.get(cacheKey) || null;
  if (!cached) return null;
  VFS_DOC_HASH_CACHE.delete(cacheKey);
  VFS_DOC_HASH_CACHE.set(cacheKey, cached);
  return cached;
};

const setCachedDocHash = (cacheKey, docHash) => {
  if (!cacheKey) return;
  VFS_DOC_HASH_CACHE.set(cacheKey, docHash);
  if (VFS_DOC_HASH_CACHE.size > VFS_DOC_HASH_CACHE_MAX) {
    const oldestKey = VFS_DOC_HASH_CACHE.keys().next().value;
    if (oldestKey !== undefined) VFS_DOC_HASH_CACHE.delete(oldestKey);
  }
};

/**
 * Compute a stable document hash with optional in-memory LRU reuse.
 *
 * @param {string} text
 * @param {string|null} [cacheKey]
 * @returns {Promise<string>}
 */
export const computeDocHash = async (text, cacheKey = null) => {
  const cached = getCachedDocHash(cacheKey);
  if (cached) return cached;
  const hash = await checksumString(text || '');
  const docHash = hash?.value ? `xxh64:${hash.value}` : 'xxh64:';
  setCachedDocHash(cacheKey, docHash);
  return docHash;
};
