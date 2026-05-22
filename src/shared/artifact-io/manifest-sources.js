import fs from 'node:fs';
import { MAX_JSON_BYTES } from './constants.js';
import { existsOrBak } from './fs.js';
import { readJsonFile } from './json.js';
import { readCache, writeCache } from './cache.js';
import {
  CHUNK_META_PART_EXTENSIONS,
  CHUNK_META_PART_PREFIX,
  CHUNK_META_PARTS_DIR,
  TOKEN_POSTINGS_PART_EXTENSIONS,
  TOKEN_POSTINGS_PART_PREFIX,
  TOKEN_POSTINGS_SHARDS_DIR,
  expandChunkMetaParts,
  listShardFiles,
  normalizeMetaParts,
  resolveManifestPath
} from './manifest-paths.js';
import { loadPiecesManifest } from './manifest-read.js';
import {
  canResolveSingleVariantEntry,
  inferEntryFormat,
  resolveBinaryColumnarSidecars,
  resolveManifestEntries,
  resolveManifestPieceByPath,
  resolveNamedManifestEntry,
  selectCanonicalVariantEntry,
  sortManifestEntries
} from './manifest-entry-selection.js';
import { logLine } from '../progress-runtime.js';

const warnedNonStrictFallback = new Set();

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

export { resolveManifestPieceByPath };

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

const resolveSingleArtifactPath = ({
  dir,
  name,
  manifest,
  maxBytes,
  strict,
  fallbackPath,
  fallbackDirEntry = false
}) => {
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
  const fallback = resolveFallbackPath(fallbackPath, { dirEntry: fallbackDirEntry });
  if (fallback) warnNonStrictFallback(dir, name);
  return fallback;
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
  return resolveSingleArtifactPath({
    dir,
    name,
    manifest,
    maxBytes,
    strict,
    fallbackPath
  });
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
  return resolveSingleArtifactPath({
    dir,
    name,
    manifest,
    maxBytes,
    strict,
    fallbackPath,
    fallbackDirEntry: true
  });
};

export {
  CHUNK_META_PARTS_DIR,
  CHUNK_META_PART_PREFIX,
  CHUNK_META_PART_EXTENSIONS,
  TOKEN_POSTINGS_SHARDS_DIR,
  TOKEN_POSTINGS_PART_PREFIX,
  TOKEN_POSTINGS_PART_EXTENSIONS,
  expandChunkMetaParts,
  listShardFiles
};
