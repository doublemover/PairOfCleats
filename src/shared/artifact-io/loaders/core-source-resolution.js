import fs from 'node:fs';
import path from 'node:path';
import { MAX_JSON_BYTES } from '../constants.js';
import { getBakPath } from '../cache.js';
import {
  resolveManifestArtifactSources,
  resolveManifestMmapHotLayoutPreference
} from '../manifest.js';
import {
  createLoaderError,
  assertNoShardIndexGaps
} from './shared.js';

const SINGLE_SOURCE_FORMATS = new Set(['json', 'columnar', 'binary-columnar']);

/**
 * Resolve the max bytes budget used when reading manifest metadata.
 *
 * @param {unknown} maxBytes
 * @returns {number}
 */
const resolveManifestMaxBytes = (maxBytes) => (
  Number.isFinite(Number(maxBytes)) ? Number(maxBytes) : MAX_JSON_BYTES
);

/**
 * Summarize source layout hints used by higher-level mmap/hot-path decisions.
 *
 * @param {{manifest:any,sources:any}} input
 * @returns {{preferMmapHotLayout:boolean,hotCount:number,hotContiguousCount:number}|null}
 */
const resolveSourceLayoutSummary = ({ manifest, sources }) => {
  const entries = Array.isArray(sources?.entries) ? sources.entries : [];
  if (!entries.length) return null;
  const preferMmapHotLayout = resolveManifestMmapHotLayoutPreference(manifest);
  let hotCount = 0;
  let hotContiguousCount = 0;
  for (const entry of entries) {
    const tier = typeof entry?.tier === 'string' ? entry.tier.trim().toLowerCase() : '';
    const layout = entry?.layout && typeof entry.layout === 'object' ? entry.layout : null;
    const contiguous = layout?.contiguous === true;
    if (tier === 'hot') {
      hotCount += 1;
      if (contiguous) hotContiguousCount += 1;
    }
  }
  return {
    preferMmapHotLayout,
    hotCount,
    hotContiguousCount
  };
};

/**
 * Resolve an artifact path to the readable target, preferring the primary file
 * and falling back to `.bak` when present.
 *
 * @param {string} targetPath
 * @returns {{path:string,exists:boolean}}
 */
const resolveReadableArtifactPathState = (targetPath) => {
  if (typeof targetPath !== 'string' || !targetPath.length) {
    return {
      path: targetPath,
      exists: false
    };
  }
  if (fs.existsSync(targetPath)) {
    return {
      path: targetPath,
      exists: true
    };
  }
  const backupPath = getBakPath(targetPath);
  if (fs.existsSync(backupPath)) {
    return {
      path: backupPath,
      exists: true
    };
  }
  return {
    path: targetPath,
    exists: false
  };
};

/**
 * Convenience wrapper returning only the resolved readable path.
 *
 * @param {string} targetPath
 * @returns {string}
 */
const resolveReadableArtifactPath = (targetPath) => resolveReadableArtifactPathState(targetPath).path;

/**
 * Resolve and validate manifest-declared sources for a required artifact.
 *
 * This enforces strict presence checks (including binary-columnar sidecars),
 * normalizes backup-path fallbacks, and optionally collapses ambiguous
 * single-source formats when strict mode is disabled.
 *
 * Invariants:
 * - Every returned `paths` entry exists (primary or backup).
 * - Binary-columnar sidecars are required when the selected format is
 *   `binary-columnar`.
 * - Strict mode forbids ambiguous single-source declarations.
 *
 * @param {{
 *   dir:string,
 *   manifest:any,
 *   name:string,
 *   maxBytes:number,
 *   strict:boolean
 * }} input
 * @returns {object}
 */
const resolveRequiredSources = ({
  dir,
  manifest,
  name,
  maxBytes,
  strict
}) => {
  if (!manifest) {
    const manifestPath = path.join(dir, 'pieces', 'manifest.json');
    throw createLoaderError('ERR_MANIFEST_MISSING', `Missing pieces manifest: ${manifestPath}`);
  }
  const sources = resolveManifestArtifactSources({
    dir,
    manifest,
    name,
    strict,
    maxBytes
  });
  const paths = Array.isArray(sources?.paths) ? sources.paths : [];
  if (!paths.length) {
    throw createLoaderError('ERR_MANIFEST_ENTRY_MISSING', `Missing manifest entry for ${name}`);
  }

  const resolvedPathStates = new Array(paths.length);
  const missingPaths = [];
  for (let i = 0; i < paths.length; i += 1) {
    const state = resolveReadableArtifactPathState(paths[i]);
    resolvedPathStates[i] = state;
    if (!state.exists) {
      missingPaths.push(paths[i]);
    }
  }
  if (missingPaths.length) {
    throw createLoaderError(
      'ERR_ARTIFACT_PARTS_MISSING',
      `Missing manifest parts for ${name}: ${missingPaths.join(', ')}`
    );
  }

  const isSingleSourceFormat = SINGLE_SOURCE_FORMATS.has(sources.format);
  if (strict && isSingleSourceFormat && paths.length > 1 && sources.format !== 'binary-columnar') {
    throw createLoaderError(
      'ERR_MANIFEST_SOURCE_AMBIGUOUS',
      `Ambiguous ${sources.format.toUpperCase()} sources for ${name}`
    );
  }

  const sidecars = sources.binaryColumnar && typeof sources.binaryColumnar === 'object'
    ? sources.binaryColumnar
    : null;
  let resolvedBinaryMetaPath = null;
  let resolvedBinaryOffsetsPath = null;
  let resolvedBinaryLengthsPath = null;
  let resolvedBinaryDataPath = null;
  const missingSidecars = [];
  if (sidecars) {
    if (sidecars.metaPath) {
      const state = resolveReadableArtifactPathState(sidecars.metaPath);
      resolvedBinaryMetaPath = state.path;
      if (sources.format === 'binary-columnar' && !state.exists) {
        missingSidecars.push(sidecars.metaPath);
      }
    }
    if (sidecars.offsetsPath) {
      const state = resolveReadableArtifactPathState(sidecars.offsetsPath);
      resolvedBinaryOffsetsPath = state.path;
      if (sources.format === 'binary-columnar' && !state.exists) {
        missingSidecars.push(sidecars.offsetsPath);
      }
    }
    if (sidecars.lengthsPath) {
      const state = resolveReadableArtifactPathState(sidecars.lengthsPath);
      resolvedBinaryLengthsPath = state.path;
      if (sources.format === 'binary-columnar' && !state.exists) {
        missingSidecars.push(sidecars.lengthsPath);
      }
    }
    if (sidecars.dataPath) {
      resolvedBinaryDataPath = resolveReadableArtifactPath(sidecars.dataPath);
    }
    if (missingSidecars.length) {
      throw createLoaderError(
        'ERR_ARTIFACT_PARTS_MISSING',
        `Missing binary-columnar sidecars for ${name}: ${missingSidecars.join(', ')}`
      );
    }
  }
  const resolvedPaths = resolvedPathStates.map((entry) => entry.path);
  const resolvedOffsets = Array.isArray(sources.offsets)
    ? sources.offsets.map((targetPath) => resolveReadableArtifactPath(targetPath))
    : null;
  const resolvedBinaryColumnar = sidecars
    ? {
      ...sidecars,
      dataPath: resolvedBinaryDataPath || resolvedPaths[0],
      metaPath: resolvedBinaryMetaPath,
      offsetsPath: resolvedBinaryOffsetsPath,
      lengthsPath: resolvedBinaryLengthsPath
    }
    : null;
  const layout = resolveSourceLayoutSummary({ manifest, sources });

  if (!isSingleSourceFormat) {
    assertNoShardIndexGaps(resolvedPaths, name);
    return {
      ...sources,
      paths: resolvedPaths,
      offsets: resolvedOffsets,
      layout
    };
  }
  return {
    ...sources,
    paths: resolvedPaths,
    offsets: resolvedOffsets,
    binaryColumnar: resolvedBinaryColumnar,
    layout
  };
};

/**
 * Infer default binary-columnar sidecar names from a data-path convention.
 *
 * @param {string|null} dataPath
 * @returns {{metaPath:string|null,offsetsPath:string|null,lengthsPath:string|null}}
 */
const resolveBinaryColumnarDefaultPaths = (dataPath) => {
  if (!dataPath || typeof dataPath !== 'string') {
    return {
      metaPath: null,
      offsetsPath: null,
      lengthsPath: null
    };
  }
  const withoutBin = dataPath.replace(/\.bin$/i, '');
  return {
    metaPath: `${withoutBin}.meta.json`,
    offsetsPath: `${withoutBin}.offsets.bin`,
    lengthsPath: `${withoutBin}.lengths.varint`
  };
};

/**
 * Select one shard from a binary-columnar source declaration, rebuilding
 * sidecar paths for non-primary shards so part-local sidecars are addressed.
 *
 * @param {object} sources
 * @param {number} [partIndex=0]
 * @returns {object}
 */
const resolveBinaryColumnarSourcePart = (sources, partIndex = 0) => {
  const paths = Array.isArray(sources?.paths) ? sources.paths : [];
  if (!paths.length) return { ...sources, paths: [] };
  const normalizedIndex = Math.max(0, Math.min(paths.length - 1, Math.floor(Number(partIndex) || 0)));
  const dataPath = paths[normalizedIndex];
  const binaryColumnar = sources?.binaryColumnar && typeof sources.binaryColumnar === 'object'
    ? sources.binaryColumnar
    : null;
  const primaryDataPath = binaryColumnar?.dataPath || paths[0] || null;
  let isPrimaryPath = false;
  if (typeof primaryDataPath === 'string' && primaryDataPath) {
    if (primaryDataPath === dataPath) {
      isPrimaryPath = true;
    } else {
      try {
        isPrimaryPath = path.resolve(primaryDataPath) === path.resolve(dataPath);
      } catch {
        isPrimaryPath = false;
      }
    }
  }
  const defaults = resolveBinaryColumnarDefaultPaths(dataPath);
  return {
    ...sources,
    paths: [dataPath],
    offsets: Array.isArray(sources?.offsets) && sources.offsets[normalizedIndex]
      ? [sources.offsets[normalizedIndex]]
      : null,
    binaryColumnar: {
      ...(binaryColumnar || {}),
      dataPath,
      dataName: binaryColumnar?.dataName || null,
      metaPath: isPrimaryPath ? (binaryColumnar?.metaPath || defaults.metaPath) : defaults.metaPath,
      offsetsPath: isPrimaryPath ? (binaryColumnar?.offsetsPath || defaults.offsetsPath) : defaults.offsetsPath,
      lengthsPath: isPrimaryPath ? (binaryColumnar?.lengthsPath || defaults.lengthsPath) : defaults.lengthsPath
    }
  };
};

export {
  resolveManifestMaxBytes,
  resolveReadableArtifactPath,
  resolveReadableArtifactPathState,
  resolveRequiredSources,
  resolveBinaryColumnarDefaultPaths,
  resolveBinaryColumnarSourcePart
};
