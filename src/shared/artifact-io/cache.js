import { currentVerifiedArtifactReadScope } from './verified-read-scope.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { MAX_JSON_BYTES } from './constants.js';

const PIECE_CACHE_LIMIT = 8;
const pieceCache = new Map();
const require = createRequire(import.meta.url);
let cacheKeyBuilder;

const buildCacheKey = (filePath, {
  maxBytes = MAX_JSON_BYTES,
  view = 'json',
  validationMode = null,
  strict = null,
  containedRoot = null,
  recoveryFallback = false
} = {}) => {
  try {
    // Unsupported/coercible limits retain cold-reader behavior without allowing
    // a memoized value to stand in for their current admission checks.
    if (typeof maxBytes !== 'number' || !Number.isFinite(maxBytes) || maxBytes <= 0
      || (containedRoot !== null && typeof containedRoot !== 'string')) return null;
    const stat = fs.statSync(filePath);
    // Keep synchronous cache admission while deferring the canonical key
    // owner's memo/config dependencies until an artifact is actually read.
    return (cacheKeyBuilder ||= require('../cache-key.js').buildLocalCacheKey)({
      namespace: 'artifact-io',
      payload: {
        filePath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
        ino: stat.ino || 0,
        dev: stat.dev || 0,
        maxBytes,
        view,
        validationMode,
        strict,
        containedRoot,
        recoveryFallback: recoveryFallback === true
      }
    }).key;
  } catch {
    return null;
  }
};

export const readCache = (filePath, options) => {
  // Mutable health/validation invocations require fresh descriptor bytes, never a stat-only memo.
  if (currentVerifiedArtifactReadScope()) return null;
  const key = buildCacheKey(filePath, options);
  if (!key) return null;
  const entry = pieceCache.get(key);
  if (!entry) return null;
  return entry.value;
};

export const writeCache = (filePath, value, options) => {
  if (currentVerifiedArtifactReadScope()) return;
  const key = buildCacheKey(filePath, options);
  if (!key) return;
  pieceCache.set(key, { value, time: Date.now() });
  if (pieceCache.size > PIECE_CACHE_LIMIT) {
    const [firstKey] = pieceCache.keys();
    pieceCache.delete(firstKey);
  }
};

export const getBakPath = (filePath) => `${filePath}.bak`;

export const cleanupBak = (filePath) => {
  const bakPath = getBakPath(filePath);
  if (!fs.existsSync(bakPath)) return;
  try {
    fs.rmSync(bakPath, { force: true });
  } catch {}
};
