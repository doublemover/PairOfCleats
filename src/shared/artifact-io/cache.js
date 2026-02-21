import fs from 'node:fs';
import { buildLocalCacheKey } from '../cache-key.js';

const PIECE_CACHE_LIMIT = 8;
const pieceCache = new Map();

const buildCacheKey = (filePath) => {
  try {
    const stat = fs.statSync(filePath);
    return buildLocalCacheKey({
      namespace: 'artifact-io',
      payload: {
        filePath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
        ino: stat.ino || 0,
        dev: stat.dev || 0
      }
    }).key;
  } catch {
    return null;
  }
};

export const readCache = (filePath) => {
  const key = buildCacheKey(filePath);
  if (!key) return null;
  const entry = pieceCache.get(key);
  if (!entry) return null;
  return entry.value;
};

export const writeCache = (filePath, value) => {
  const key = buildCacheKey(filePath);
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
