import fs from 'node:fs';
import path from 'node:path';
import { getBakPath } from './cache.js';

export const existsOrBak = (filePath) => fs.existsSync(filePath) || fs.existsSync(getBakPath(filePath));
export const resolvePathOrBak = (filePath) => {
  if (fs.existsSync(filePath)) return filePath;
  const bakPath = getBakPath(filePath);
  if (fs.existsSync(bakPath)) return bakPath;
  return filePath;
};

export const readShardFiles = (dir, prefix) => {
  try {
    const names = fs.readdirSync(dir);
    return names
      .filter((name) => name.startsWith(prefix))
      .filter((name) => (
        name.endsWith('.jsonl')
        || name.endsWith('.jsonl.gz')
        || name.endsWith('.jsonl.zst')
      ))
      .sort()
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
};

export const resolveArtifactMtime = (filePath) => {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {}
  return 0;
};

export const resolveDirMtime = (dirPath) => {
  try {
    return fs.statSync(dirPath).mtimeMs;
  } catch {}
  return 0;
};

const normalizeTier = (value, fallback = 'warm') => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'hot' || normalized === 'warm' || normalized === 'cold') return normalized;
  return fallback;
};

/**
 * Resolve normalized tier hint from manifest entry metadata.
 *
 * @param {object|null|undefined} entry
 * @param {'hot'|'warm'|'cold'} [fallback]
 * @returns {'hot'|'warm'|'cold'}
 */
export const resolveManifestEntryTier = (entry, fallback = 'warm') => (
  normalizeTier(entry?.tier ?? entry?.layout?.tier, fallback)
);

const resolveNumericLayoutOrder = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor(parsed));
};

/**
 * Resolve stable layout order hint for mmap-friendly artifact groups.
 *
 * @param {object|null|undefined} entry
 * @returns {number}
 */
export const resolveManifestEntryLayoutOrder = (entry) => {
  const layout = entry?.layout && typeof entry.layout === 'object' ? entry.layout : null;
  return Math.min(
    resolveNumericLayoutOrder(layout?.order),
    resolveNumericLayoutOrder(layout?.hotOrder),
    resolveNumericLayoutOrder(entry?.layoutOrder),
    resolveNumericLayoutOrder(entry?.hotOrder)
  );
};
