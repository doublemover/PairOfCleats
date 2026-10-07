import path from 'node:path';
import { resolveManifestEntryLayoutOrder, resolveManifestEntryTier } from './fs.js';
import { resolveManifestPath } from './manifest-paths.js';
import { isAbsolutePathNative, isRelativePathEscape, toPosix } from '../file-paths.js';

const manifestPieceIndexCache = new WeakMap();

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

export const resolveManifestEntries = (manifest, name) => {
  const map = indexManifestPieces(manifest);
  return map.get(name) || [];
};

export const sortManifestEntries = (entries) => (
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

export const resolveNamedManifestEntry = ({
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

export const resolveNamedManifestPath = ({
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

export const resolveBinaryColumnarSidecars = ({ dir, manifest, name, strict }) => {
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

export const inferEntryFormat = (entry) => {
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

export const canResolveSingleVariantEntry = (entries) => {
  const basePaths = new Set(
    entries
      .map((entry) => stripCompressionSuffix(entry?.path || ''))
      .filter(Boolean)
  );
  return basePaths.size === 1;
};

export const selectCanonicalVariantEntry = (entries, { preferMmapHotLayout = true } = {}) => (
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
