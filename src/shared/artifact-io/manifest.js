import fs from 'node:fs';
import path from 'node:path';
import { MAX_JSON_BYTES } from './constants.js';
import { existsOrBak } from './fs.js';
import { readJsonFile } from './json.js';
import { readCache, writeCache } from './cache.js';
import { getTestEnvConfig } from '../env.js';
import { fromPosix, isAbsolutePathNative, toPosix } from '../files.js';
import { logLine } from '../progress.js';

const MIN_MANIFEST_BYTES = 64 * 1024;
const warnedMissingCompat = new Set();
const warnedMissingManifest = new Set();
const warnedNonStrictFallback = new Set();
const warnedUnsafePaths = new Set();
const manifestPieceIndexCache = new WeakMap();

const normalizeManifest = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw.fields && typeof raw.fields === 'object' ? raw.fields : raw;
  const pieces = Array.isArray(source.pieces) ? source.pieces : [];
  return { ...source, pieces };
};

export const resolveManifestBinaryColumnarPreference = (
  manifest,
  { fallback = true } = {}
) => {
  const preferFromManifest = manifest?.reader?.preferBinaryColumnar;
  if (typeof preferFromManifest === 'boolean') {
    return preferFromManifest;
  }
  return fallback !== false;
};

const normalizeCompatibilityKey = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const isSafeManifestPath = (value) => {
  if (typeof value !== 'string') return false;
  if (!value) return false;
  if (isAbsolutePathNative(value)) return false;
  const normalized = toPosix(value);
  if (normalized.startsWith('/')) return false;
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '..')) return false;
  return true;
};

const warnUnsafePath = (dir, relPath, reason) => {
  const key = `${dir}:${relPath}:${reason}`;
  if (warnedUnsafePaths.has(key)) return;
  warnedUnsafePaths.add(key);
  logLine(`[manifest] Non-strict mode: skipping unsafe path (${reason}): ${relPath}`, { kind: 'warning' });
};

const resolveManifestMaxBytes = (maxBytes, { strict = true } = {}) => {
  if (maxBytes == null) return maxBytes;
  if (typeof maxBytes !== 'number' || !Number.isFinite(maxBytes)) {
    if (strict) {
      const err = new Error('manifest maxBytes must be a finite number.');
      err.code = 'ERR_MANIFEST_MAX_BYTES';
      throw err;
    }
    return undefined;
  }
  if (maxBytes <= 0) {
    if (strict) {
      const err = new Error('manifest maxBytes must be greater than zero.');
      err.code = 'ERR_MANIFEST_MAX_BYTES';
      throw err;
    }
    return undefined;
  }
  const parsed = Math.floor(maxBytes);
  return Math.max(Math.floor(parsed), MIN_MANIFEST_BYTES);
};

export const resolveManifestPath = (dir, relPath, strict) => {
  if (!relPath) return null;
  if (!isSafeManifestPath(relPath)) {
    if (strict) {
      const err = new Error(`Invalid manifest path: ${relPath}`);
      err.code = 'ERR_MANIFEST_PATH';
      throw err;
    }
    warnUnsafePath(dir, relPath, 'invalid');
    return null;
  }
  const resolved = path.resolve(dir, fromPosix(relPath));
  const root = path.resolve(dir);
  const relative = path.relative(root, resolved);
  const escapes = relative.startsWith('..') || isAbsolutePathNative(relative);
  if (escapes) {
    if (strict) {
      const err = new Error(`Manifest path escapes index root: ${relPath}`);
      err.code = 'ERR_MANIFEST_PATH';
      throw err;
    }
    warnUnsafePath(dir, relPath, 'escape');
    return null;
  }
  return resolved;
};

export const loadPiecesManifest = (dir, { maxBytes = MAX_JSON_BYTES, strict = true } = {}) => {
  const manifestPath = path.join(dir, 'pieces', 'manifest.json');
  if (!existsOrBak(manifestPath)) {
    if (strict) {
      const err = new Error(`Missing pieces manifest: ${manifestPath}`);
      err.code = 'ERR_MANIFEST_MISSING';
      throw err;
    }
    if (!warnedMissingManifest.has(manifestPath)) {
      warnedMissingManifest.add(manifestPath);
      logLine(
        `[manifest] Non-strict mode: missing pieces manifest; falling back to legacy paths (${manifestPath}).`,
        { kind: 'warning' }
      );
    }
    return null;
  }
  const resolvedMaxBytes = resolveManifestMaxBytes(maxBytes, { strict });
  const cached = readCache(manifestPath);
  if (cached) return cached;
  const raw = readJsonFile(manifestPath, { maxBytes: resolvedMaxBytes });
  const manifest = normalizeManifest(raw);
  if (!manifest && strict) {
    const err = new Error(`Invalid pieces manifest: ${manifestPath}`);
    err.code = 'ERR_MANIFEST_INVALID';
    throw err;
  }
  if (manifest) {
    writeCache(manifestPath, manifest);
  }
  return manifest;
};

export const readCompatibilityKey = (dir, { maxBytes = MAX_JSON_BYTES, strict = true } = {}) => {
  const testEnv = getTestEnvConfig();
  const allowMissingInTests = testEnv.testing && testEnv.allowMissingCompatKey !== false;
  let manifest = null;
  if (strict) {
    manifest = loadPiecesManifest(dir, { maxBytes, strict: true });
  } else {
    try {
      manifest = loadPiecesManifest(dir, { maxBytes, strict: false });
    } catch {}
  }
  const manifestKey = normalizeCompatibilityKey(manifest?.compatibilityKey);
  if (manifestKey) {
    return { key: manifestKey, source: 'manifest' };
  }
  const statePath = path.join(dir, 'index_state.json');
  let state = null;
  try {
    state = readJsonFile(statePath, { maxBytes });
  } catch (err) {
    if (strict) {
      if (allowMissingInTests) {
        if (!warnedMissingCompat.has(dir)) {
          warnedMissingCompat.add(dir);
          logLine(`Missing compatibilityKey for index; continuing because tests allow missing keys: ${dir}`, { kind: 'warning' });
        }
        return { key: null, source: null };
      }
      const error = new Error(`Missing compatibilityKey for index: ${dir}`);
      error.code = 'ERR_COMPATIBILITY_KEY_MISSING';
      throw error;
    }
    return { key: null, source: null };
  }
  const stateKey = normalizeCompatibilityKey(state?.compatibilityKey);
  if (stateKey) {
    if (manifest && strict) {
      logLine(
        `Pieces manifest missing compatibilityKey; falling back to index_state.json (${path.join(dir, 'pieces', 'manifest.json')}).`,
        { kind: 'warning' }
      );
    }
    return { key: stateKey, source: 'index_state' };
  }
  if (strict) {
    if (allowMissingInTests) {
      if (!warnedMissingCompat.has(dir)) {
        warnedMissingCompat.add(dir);
        logLine(`Missing compatibilityKey for index; continuing because tests allow missing keys: ${dir}`, { kind: 'warning' });
      }
      return { key: null, source: null };
    }
    const err = new Error(`Missing compatibilityKey for index: ${dir}`);
    err.code = 'ERR_COMPATIBILITY_KEY_MISSING';
    throw err;
  }
  return { key: null, source: null };
};

const indexManifestPieces = (manifest) => {
  if (!manifest || typeof manifest !== 'object') return new Map();
  if (manifestPieceIndexCache.has(manifest)) {
    return manifestPieceIndexCache.get(manifest);
  }
  const map = new Map();
  const list = Array.isArray(manifest?.pieces) ? manifest.pieces : [];
  for (const entry of list) {
    const name = typeof entry?.name === 'string' ? entry.name : '';
    if (!name) continue;
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(entry);
  }
  manifestPieceIndexCache.set(manifest, map);
  return map;
};

const resolveManifestEntries = (manifest, name) => {
  const map = indexManifestPieces(manifest);
  return map.get(name) || [];
};

const inferEntryFormat = (entry) => {
  if (entry && typeof entry.format === 'string' && entry.format) return entry.format;
  const pathValue = typeof entry?.path === 'string' ? entry.path : '';
  if (pathValue.endsWith('.jsonl') || pathValue.endsWith('.jsonl.gz') || pathValue.endsWith('.jsonl.zst')) {
    return 'jsonl';
  }
  return 'json';
};

const stripCompressionSuffix = (value) => (
  typeof value === 'string'
    ? value.replace(/\.(?:gz|zst)$/i, '')
    : ''
);

const resolveCompressionPreference = (entry) => {
  const value = typeof entry?.path === 'string' ? entry.path.toLowerCase() : '';
  if (value.endsWith('.zst')) return 0;
  if (value.endsWith('.gz')) return 1;
  return 2;
};

const canResolveSingleVariantEntry = (entries) => {
  const basePaths = new Set(
    entries
      .map((entry) => stripCompressionSuffix(entry?.path || ''))
      .filter(Boolean)
  );
  return basePaths.size === 1;
};

const selectCanonicalVariantEntry = (entries) => (
  entries
    .slice()
    .sort((a, b) => {
      const compressionDiff = resolveCompressionPreference(a) - resolveCompressionPreference(b);
      if (compressionDiff !== 0) return compressionDiff;
      const left = a?.path || '';
      const right = b?.path || '';
      return left < right ? -1 : (left > right ? 1 : 0);
    })[0] || null
);

export const normalizeMetaParts = (parts) => {
  if (!Array.isArray(parts)) return [];
  return parts
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && typeof part.path === 'string') return part.path;
      return null;
    })
    .filter(Boolean);
};

export const resolveMetaFormat = (meta, fallback) => {
  const raw = typeof meta?.format === 'string' ? meta.format : null;
  if (!raw) return fallback;
  if (raw === 'jsonl') return 'jsonl';
  if (raw === 'jsonl-sharded') return 'sharded';
  if (raw === 'sharded') return 'sharded';
  if (raw === 'json') return 'json';
  return raw;
};

export const resolveManifestArtifactSources = ({ dir, manifest, name, strict, maxBytes = MAX_JSON_BYTES }) => {
  if (!manifest) return null;
  const entries = resolveManifestEntries(manifest, name);
  const metaEntries = resolveManifestEntries(manifest, `${name}_meta`);
  if (metaEntries.length > 1 && strict) {
    const err = new Error(`Multiple manifest entries for ${name}_meta`);
    err.code = 'ERR_MANIFEST_INVALID';
    throw err;
  }
  if (metaEntries.length === 1) {
    const metaEntry = metaEntries[0];
    const metaPath = resolveManifestPath(dir, metaEntry.path, strict);
    if (metaPath) {
      const cachedMeta = readCache(metaPath);
      const metaRaw = cachedMeta || readJsonFile(metaPath, { maxBytes });
      if (!cachedMeta) writeCache(metaPath, metaRaw);
      const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
      const parts = normalizeMetaParts(meta?.parts);
      const offsets = Array.isArray(meta?.offsets) ? meta.offsets : [];
      if (parts.length) {
        const partSet = new Set(entries.map((entry) => entry?.path));
        if (strict) {
          for (const part of parts) {
            if (!partSet.has(part)) {
              const err = new Error(`Manifest missing shard path for ${name}: ${part}`);
              err.code = 'ERR_MANIFEST_INCOMPLETE';
              throw err;
            }
          }
        }
        if (strict && offsets.length && offsets.length !== parts.length) {
          const err = new Error(`Manifest offsets length mismatch for ${name}`);
          err.code = 'ERR_MANIFEST_INVALID';
          throw err;
        }
        const paths = parts
          .map((part) => resolveManifestPath(dir, part, strict))
          .filter(Boolean);
        const resolvedOffsets = offsets
          .map((offset) => resolveManifestPath(dir, offset, strict))
          .filter(Boolean);
        if (paths.length) {
          return {
            format: resolveMetaFormat(meta, 'jsonl'),
            paths,
            meta,
            metaPath,
            offsets: resolvedOffsets.length === paths.length ? resolvedOffsets : null
          };
        }
      }
      const rawFormat = typeof meta?.format === 'string' ? meta.format : null;
      if (strict && (rawFormat === 'jsonl-sharded' || rawFormat === 'sharded')) {
        const err = new Error(`Manifest meta missing parts for ${name}`);
        err.code = 'ERR_MANIFEST_INVALID';
        throw err;
      }
    }
  }
  if (!entries.length) return null;
  let resolvedEntries = entries.slice().sort((a, b) => {
    const aPath = a?.path || '';
    const bPath = b?.path || '';
    return aPath < bPath ? -1 : (aPath > bPath ? 1 : 0);
  });
  if (resolvedEntries.length > 1 && strict) {
    if (canResolveSingleVariantEntry(resolvedEntries)) {
      const selected = selectCanonicalVariantEntry(resolvedEntries);
      resolvedEntries = selected ? [selected] : resolvedEntries;
    } else {
      const err = new Error(`Ambiguous manifest entries for ${name}`);
      err.code = 'ERR_MANIFEST_INVALID';
      throw err;
    }
  }
  const paths = resolvedEntries
    .map((entry) => resolveManifestPath(dir, entry?.path, strict))
    .filter(Boolean);
  if (!paths.length) return null;
  return {
    format: inferEntryFormat(resolvedEntries[0]),
    paths,
    entries: resolvedEntries
  };
};

export const resolveArtifactPresence = (
  dir,
  name,
  {
    manifest = null,
    maxBytes = MAX_JSON_BYTES,
    strict = true,
    fallbackPath = null,
    fallbackDirEntry = false
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  let sources = null;
  let error = null;
  try {
    sources = resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name,
      strict,
      maxBytes
    });
  } catch (err) {
    error = err;
  }
  if (!sources) {
    if (!strict) {
      const fallback = resolveFallbackPath(fallbackPath, { dirEntry: fallbackDirEntry });
      if (fallback) {
        warnNonStrictFallback(dir, name);
        return {
          name,
          format: fallbackDirEntry ? 'directory' : inferEntryFormat({ path: fallback }),
          paths: [fallback],
          metaPath: null,
          meta: null,
          missingPaths: [],
          missingMeta: false,
          error
        };
      }
    }
    return {
      name,
      format: 'missing',
      paths: [],
      metaPath: null,
      meta: null,
      missingPaths: [],
      missingMeta: false,
      error
    };
  }
  const paths = Array.isArray(sources.paths) ? sources.paths : [];
  const missingPaths = paths.filter((target) => !existsOrBak(target));
  const metaPath = sources.metaPath || null;
  const missingMeta = metaPath ? !existsOrBak(metaPath) : false;
  return {
    name,
    format: sources.format === 'sharded' ? 'sharded' : sources.format,
    paths,
    metaPath,
    meta: sources.meta || null,
    missingPaths,
    missingMeta,
    error
  };
};

const resolveFallbackPath = (fallbackPath, { dirEntry = false } = {}) => {
  if (!fallbackPath) return null;
  if (dirEntry) {
    return fs.existsSync(fallbackPath) ? fallbackPath : null;
  }
  return existsOrBak(fallbackPath) ? fallbackPath : null;
};

const warnNonStrictFallback = (dir, name) => {
  const key = `${dir}:${name}`;
  if (warnedNonStrictFallback.has(key)) return;
  warnedNonStrictFallback.add(key);
  logLine(
    `[manifest] Non-strict mode: ${name} missing from manifest; using legacy path (${dir}).`,
    { kind: 'warning' }
  );
};

export const resolveBinaryArtifactPath = (
  dir,
  name,
  {
    manifest = null,
    maxBytes = MAX_JSON_BYTES,
    strict = true,
    fallbackPath = null
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name,
    strict,
    maxBytes
  });
  if (sources?.paths?.length) {
    if (sources.paths.length > 1 && strict) {
      const err = new Error(`Ambiguous manifest entries for ${name}`);
      err.code = 'ERR_MANIFEST_INVALID';
      throw err;
    }
    return sources.paths[0] || null;
  }
  if (strict) {
    const err = new Error(`Missing manifest entry for ${name}`);
    err.code = 'ERR_MANIFEST_MISSING';
    throw err;
  }
  const fallback = resolveFallbackPath(fallbackPath);
  if (fallback) warnNonStrictFallback(dir, name);
  return fallback;
};

export const resolveDirArtifactPath = (
  dir,
  name,
  {
    manifest = null,
    maxBytes = MAX_JSON_BYTES,
    strict = true,
    fallbackPath = null
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name,
    strict,
    maxBytes
  });
  if (sources?.paths?.length) {
    if (sources.paths.length > 1 && strict) {
      const err = new Error(`Ambiguous manifest entries for ${name}`);
      err.code = 'ERR_MANIFEST_INVALID';
      throw err;
    }
    return sources.paths[0] || null;
  }
  if (strict) {
    const err = new Error(`Missing manifest entry for ${name}`);
    err.code = 'ERR_MANIFEST_MISSING';
    throw err;
  }
  const fallback = resolveFallbackPath(fallbackPath, { dirEntry: true });
  if (fallback) warnNonStrictFallback(dir, name);
  return fallback;
};
