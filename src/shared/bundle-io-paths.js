import path from 'node:path';
import { sha1 } from './hash.js';
import {
  BUNDLE_JSON_CHECKSUM_SUFFIX,
  BUNDLE_PATCH_LOCK_SUFFIX,
  BUNDLE_PATCH_META_SUFFIX,
  BUNDLE_PATCH_SUFFIX,
  MSGPACK_EXTENSIONS
} from './bundle-io-constants.js';

export function normalizeBundleFormat(raw) {
  const format = String(raw || '').trim().toLowerCase();
  if (!format || format === 'json') return 'json';
  if (format === 'msgpack' || format === 'msgpackr' || format === 'mpk') return 'msgpack';
  throw new Error(`unsupported bundle format: ${raw}`);
}

export function resolveBundleFilename(relKey, format) {
  const ext = format === 'msgpack' ? 'mpk' : 'json';
  return `${sha1(relKey)}.${ext}`;
}

export function resolveBundleShardFilename(relKey, format, shardIndex = 0) {
  const baseName = resolveBundleFilename(relKey, format);
  const index = Number.isFinite(Number(shardIndex))
    ? Math.max(0, Math.floor(Number(shardIndex)))
    : 0;
  if (index <= 0) return baseName;
  const parsed = path.parse(baseName);
  return `${parsed.name}.part${String(index).padStart(4, '0')}${parsed.ext}`;
}

export function resolveManifestBundleNames(entry) {
  return resolveManifestBundleNamesResult(entry).names;
}

export function resolveManifestBundleNamesResult(entry) {
  if (!entry || typeof entry !== 'object') {
    return { ok: false, reason: 'bundle manifest entry missing or invalid', names: [] };
  }
  const legacyBundle = typeof entry.bundle === 'string' ? entry.bundle.trim() : '';
  const rawBundleNames = Array.isArray(entry.bundles) && entry.bundles.length
    ? entry.bundles
    : (legacyBundle ? [legacyBundle] : []);
  if (!rawBundleNames.length) {
    return { ok: false, reason: 'missing bundle entries', names: [] };
  }
  const names = [];
  const seen = new Set();
  for (const value of rawBundleNames) {
    if (typeof value !== 'string') {
      return { ok: false, reason: 'bundle entry names must be strings', names: [] };
    }
    const name = value.trim();
    if (!name) {
      return { ok: false, reason: 'bundle entry names must be non-empty strings', names: [] };
    }
    if (name.includes('/') || name.includes('\\')) {
      return { ok: false, reason: 'bundle entry names must not contain path separators', names: [] };
    }
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return { ok: true, reason: null, names };
}

export function resolveBundleFormatFromName(bundleName, fallback = 'json') {
  if (typeof bundleName !== 'string' || !bundleName) return fallback;
  const ext = path.extname(bundleName).toLowerCase();
  return MSGPACK_EXTENSIONS.has(ext) ? 'msgpack' : 'json';
}

export function resolveBundlePatchPath(bundlePath) {
  return `${bundlePath}${BUNDLE_PATCH_SUFFIX}`;
}

export function resolveBundlePatchLockPath(bundlePath) {
  return `${resolveBundlePatchPath(bundlePath)}${BUNDLE_PATCH_LOCK_SUFFIX}`;
}

export function resolveBundlePatchMetaPath(bundlePath) {
  return `${resolveBundlePatchPath(bundlePath)}${BUNDLE_PATCH_META_SUFFIX}`;
}

export function resolveBundleJsonChecksumPath(bundlePath) {
  return `${bundlePath}${BUNDLE_JSON_CHECKSUM_SUFFIX}`;
}
