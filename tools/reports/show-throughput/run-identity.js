import fs from 'node:fs';
import path from 'node:path';

const GENERIC_PATH_SEGMENTS = new Set([
  'usr',
  'users',
  'home',
  'var',
  'tmp',
  'private',
  'opt',
  'mnt',
  'repos',
  'repo',
  'cache',
  'caches',
  'builds',
  'current'
]);

/**
 * Canonicalize filesystem path-like values so identity/history keys stay
 * stable across relative segments, separator differences, and symlink aliases.
 *
 * @param {string} value
 * @returns {string}
 */
const canonicalizePathLikeValue = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (!trimmed.includes('/') && !trimmed.includes('\\')) return trimmed;
  const windowsPosixAbsolute = process.platform === 'win32'
    && /^\/(?!\/)/.test(trimmed);
  if (windowsPosixAbsolute) {
    return trimmed.replace(/[\\/]+/g, '/').replace(/\/+$/g, '') || trimmed;
  }
  let resolved = trimmed;
  try {
    resolved = path.resolve(trimmed);
  } catch {}
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {}
  const normalized = resolved.replace(/[\\/]+/g, '/').replace(/\/+$/g, '');
  return normalized || trimmed;
};

const normalizeRepoIdentityValue = (value, fallback = '') => {
  const candidate = String(value || '').trim();
  const fallbackText = String(fallback || '').trim();
  if (!candidate) return fallbackText;
  if (!candidate.includes('/') && !candidate.includes('\\')) return candidate;
  const normalized = canonicalizePathLikeValue(candidate);
  const segments = normalized.split('/').filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];
    const lower = segment.toLowerCase();
    if (!segment || GENERIC_PATH_SEGMENTS.has(lower)) continue;
    if (/^[a-z]:$/i.test(segment)) continue;
    return segment;
  }
  return fallbackText || candidate;
};

const normalizeRepoHistoryKeyValue = (value, fallback = '') => {
  const candidate = String(value || '').trim();
  const fallbackText = String(fallback || '').trim();
  if (!candidate) return fallbackText || 'unknown';
  if (!candidate.includes('/') && !candidate.includes('\\')) return candidate;
  const normalized = canonicalizePathLikeValue(candidate);
  return normalized || fallbackText || 'unknown';
};

export const resolveRepoIdentity = ({ payload, file }) => {
  const fileFallback = String(file || '').replace(/\.json$/i, '').trim();
  const candidate = payload?.repo?.root
    || payload?.artifacts?.repo?.root
    || fileFallback
    || payload?.artifacts?.repo?.cacheRoot
    || '';
  return normalizeRepoIdentityValue(candidate, fileFallback || 'unknown');
};

export const resolveRepoHistoryKey = ({ payload, file }) => {
  const fileFallback = String(file || '').replace(/\.json$/i, '').trim();
  const candidate = payload?.repo?.root
    || payload?.artifacts?.repo?.root
    || payload?.artifacts?.repo?.cacheRoot
    || fileFallback
    || '';
  return normalizeRepoHistoryKeyValue(candidate, fileFallback || 'unknown');
};
