import fs from 'node:fs';
import path from 'node:path';
import { MAX_JSON_BYTES } from './constants.js';
import {
  existsOrBak,
  resolveManifestEntryLayoutOrder,
  resolveManifestEntryTier
} from './fs.js';
import { readJsonFile } from './json.js';
import { readCache, writeCache } from './cache.js';
import { getTestEnvConfig } from '../env.js';
import { fromPosix, isAbsolutePathNative, isRelativePathEscape, toPosix } from '../files.js';
import { logLine } from '../progress.js';

const MIN_MANIFEST_BYTES = 64 * 1024;
const warnedMissingCompat = new Set();
const warnedMissingManifest = new Set();
const warnedNonStrictFallback = new Set();
const warnedUnsafePaths = new Set();
const manifestPieceIndexCache = new WeakMap();

export const CHUNK_META_PARTS_DIR = 'chunk_meta.parts';
export const CHUNK_META_PART_PREFIX = 'chunk_meta.part-';
export const CHUNK_META_PART_EXTENSIONS = ['.jsonl', '.jsonl.gz', '.jsonl.zst'];
export const TOKEN_POSTINGS_SHARDS_DIR = 'token_postings.shards';
export const TOKEN_POSTINGS_PART_PREFIX = 'token_postings.part-';
export const TOKEN_POSTINGS_PART_EXTENSIONS = ['.json', '.json.gz', '.json.zst'];

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

export const resolveManifestMmapHotLayoutPreference = (
  manifest,
  { fallback = true } = {}
) => {
  const preferFromManifest = manifest?.reader?.preferMmapHotLayout;
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
  const escapes = isRelativePathEscape(relative) || isAbsolutePathNative(relative);
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

const sortManifestEntries = (entries) => (
  entries
    .slice()
    .sort((a, b) => {
      const layoutDiff = resolveManifestEntryLayoutOrder(a) - resolveManifestEntryLayoutOrder(b);
      if (Number.isFinite(layoutDiff) && layoutDiff !== 0) return layoutDiff;
      const aPath = a?.path || '';
      const bPath = b?.path || '';
      return aPath < bPath ? -1 : (aPath > bPath ? 1 : 0);
    })
);

const resolveNamedManifestEntry = ({
  manifest,
  name,
  strict,
  code = 'ERR_MANIFEST_INVALID'
}) => {
  const entries = sortManifestEntries(resolveManifestEntries(manifest, name));
  if (!entries.length) return null;
  if (entries.length > 1 && strict) {
    const err = new Error(`Multiple manifest entries for ${name}`);
    err.code = code;
    throw err;
  }
  return entries[0] || null;
};

const resolveNamedManifestPath = ({
  dir,
  manifest,
  names,
  strict,
  code = 'ERR_MANIFEST_INVALID'
}) => {
  for (const candidate of names) {
    const entry = resolveNamedManifestEntry({
      manifest,
      name: candidate,
      strict,
      code
    });
    if (!entry) continue;
    const targetPath = resolveManifestPath(dir, entry.path, strict);
    if (!targetPath) continue;
    return { name: candidate, entry, path: targetPath };
  }
  return null;
};

const resolveBinaryColumnarSidecars = ({ dir, manifest, name, strict }) => {
  const meta = resolveNamedManifestPath({
    dir,
    manifest,
    strict,
    names: [`${name}_binary_columnar_meta`, `${name}_meta`]
  });
  const offsets = resolveNamedManifestPath({
    dir,
    manifest,
    strict,
    names: [`${name}_binary_columnar_offsets`, `${name}_offsets`]
  });
  const lengths = resolveNamedManifestPath({
    dir,
    manifest,
    strict,
    names: [`${name}_binary_columnar_lengths`, `${name}_lengths`]
  });
  return {
    metaPath: meta?.path || null,
    offsetsPath: offsets?.path || null,
    lengthsPath: lengths?.path || null,
    metaName: meta?.name || null,
    offsetsName: offsets?.name || null,
    lengthsName: lengths?.name || null
  };
};

export const resolveManifestPieceByPath = ({
  manifest,
  dir,
  targetPath,
  expectedName = null
}) => {
  if (!manifest || typeof manifest !== 'object') return null;
  if (!dir || !targetPath) return null;
  const resolvedRoot = path.resolve(dir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!relative || isRelativePathEscape(relative) || isAbsolutePathNative(relative)) return null;
  const relPath = toPosix(relative);
  const pieces = Array.isArray(manifest?.pieces) ? manifest.pieces : [];
  return pieces.find((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    if (typeof entry.path !== 'string' || entry.path !== relPath) return false;
    if (expectedName && entry.name !== expectedName) return false;
    return true;
  }) || null;
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

const isCompressedVariant = (entry) => {
  const value = typeof entry?.path === 'string' ? entry.path.toLowerCase() : '';
  return value.endsWith('.zst') || value.endsWith('.gz');
};

const resolveHotLayoutPreference = (entry, preferMmapHotLayout) => {
  if (!preferMmapHotLayout) return 1;
  const tier = resolveManifestEntryTier(entry, 'warm');
  if (tier !== 'hot') return 1;
  return isCompressedVariant(entry) ? 1 : 0;
};

const canResolveSingleVariantEntry = (entries) => {
  const basePaths = new Set(
    entries
      .map((entry) => stripCompressionSuffix(entry?.path || ''))
      .filter(Boolean)
  );
  return basePaths.size === 1;
};

const selectCanonicalVariantEntry = (entries, { preferMmapHotLayout = true } = {}) => (
  entries
    .slice()
    .sort((a, b) => {
      const hotLayoutDiff = resolveHotLayoutPreference(a, preferMmapHotLayout)
        - resolveHotLayoutPreference(b, preferMmapHotLayout);
      if (hotLayoutDiff !== 0) return hotLayoutDiff;
      const compressionDiff = resolveCompressionPreference(a) - resolveCompressionPreference(b);
      if (compressionDiff !== 0) return compressionDiff;
      const layoutDiff = resolveManifestEntryLayoutOrder(a) - resolveManifestEntryLayoutOrder(b);
      if (Number.isFinite(layoutDiff) && layoutDiff !== 0) return layoutDiff;
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

export const expandMetaPartPaths = (parts, baseDir) => {
  if (!baseDir || typeof baseDir !== 'string') return [];
  const entries = normalizeMetaParts(parts);
  if (!entries.length) return [];
  return entries.map((part) => path.join(baseDir, fromPosix(part)));
};

export const expandChunkMetaParts = (metaFields, baseDir) => (
  expandMetaPartPaths(metaFields?.parts, baseDir)
);

export const listShardFiles = (dir, prefix, extensions = ['.json', '.jsonl']) => {
  if (!dir || typeof dir !== 'string' || !fs.existsSync(dir)) return [];
  const allowed = Array.isArray(extensions) && extensions.length
    ? extensions
    : ['.json', '.jsonl'];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && allowed.some((ext) => name.endsWith(ext)))
    .sort()
    .map((name) => path.join(dir, name));
};

/**
 * Locate chunk-meta shard files using meta manifest first, directory scan fallback.
 *
 * @param {string} dir
 * @param {{metaPath?:string|null,partsDir?:string|null,metaFields?:object|null,maxBytes?:number}} [options]
 * @returns {{parts:string[],metaPath:string|null,partsDir:string|null,meta:object|null,missing:string[],source:'meta'|'directory'|null}}
 */
export const locateChunkMetaShards = (
  dir,
  {
    metaPath = null,
    partsDir = null,
    metaFields = null,
    maxBytes = MAX_JSON_BYTES
  } = {}
) => {
  if (!dir || typeof dir !== 'string') {
    return {
      parts: [],
      metaPath: null,
      partsDir: null,
      meta: null,
      missing: [],
      source: null
    };
  }
  const resolvedMetaPath = typeof metaPath === 'string' && metaPath
    ? metaPath
    : path.join(dir, 'chunk_meta.meta.json');
  const resolvedPartsDir = typeof partsDir === 'string' && partsDir
    ? partsDir
    : path.join(dir, CHUNK_META_PARTS_DIR);
  let meta = metaFields?.fields && typeof metaFields.fields === 'object'
    ? metaFields.fields
    : metaFields;
  if (!meta && fs.existsSync(resolvedMetaPath)) {
    const metaRaw = readJsonFile(resolvedMetaPath, { maxBytes });
    meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
  }
  const metaPartNames = normalizeMetaParts(meta?.parts);
  const metaParts = expandChunkMetaParts(meta, dir);
  if (metaParts.length) {
    const missing = metaParts
      .map((candidate, index) => ({ candidate, relPath: metaPartNames[index] || null }))
      .filter((entry) => !fs.existsSync(entry.candidate))
      .map((entry) => entry.relPath || entry.candidate);
    return {
      parts: metaParts,
      metaPath: fs.existsSync(resolvedMetaPath) ? resolvedMetaPath : null,
      partsDir: resolvedPartsDir,
      meta: meta || null,
      missing,
      source: 'meta'
    };
  }
  return {
    parts: listShardFiles(resolvedPartsDir, CHUNK_META_PART_PREFIX, CHUNK_META_PART_EXTENSIONS),
    metaPath: fs.existsSync(resolvedMetaPath) ? resolvedMetaPath : null,
    partsDir: resolvedPartsDir,
    meta: meta || null,
    missing: [],
    source: 'directory'
  };
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
  const metaEntry = resolveNamedManifestEntry({
    manifest,
    name: `${name}_meta`,
    strict
  });
  if (metaEntry) {
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
  let resolvedEntries = sortManifestEntries(entries);
  if (resolvedEntries.length > 1 && strict) {
    if (canResolveSingleVariantEntry(resolvedEntries)) {
      const selected = selectCanonicalVariantEntry(
        resolvedEntries,
        { preferMmapHotLayout: resolveManifestMmapHotLayoutPreference(manifest) }
      );
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
  const format = inferEntryFormat(resolvedEntries[0]);
  const binaryColumnar = format === 'binary-columnar'
    ? resolveBinaryColumnarSidecars({ dir, manifest, name, strict })
    : null;
  return {
    format,
    paths,
    entries: resolvedEntries,
    ...(binaryColumnar
      ? {
        binaryColumnar: {
          ...binaryColumnar,
          dataPath: paths[0],
          dataName: name
        },
        metaPath: binaryColumnar.metaPath
      }
      : {})
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
