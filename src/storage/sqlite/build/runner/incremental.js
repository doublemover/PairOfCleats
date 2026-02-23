import fsSync from 'node:fs';
import path from 'node:path';
import { resolveRecordsIncrementalCapability } from '../index.js';

const BUNDLE_INVENTORY_CACHE_LIMIT = 64;
const bundleInventoryCache = new Map();

const readBundleInventoryCache = (cacheKey) => {
  if (!cacheKey) return null;
  const cached = bundleInventoryCache.get(cacheKey);
  if (!cached) return null;
  bundleInventoryCache.delete(cacheKey);
  bundleInventoryCache.set(cacheKey, cached);
  return {
    count: cached.count,
    names: new Set(cached.names)
  };
};

const writeBundleInventoryCache = (cacheKey, names) => {
  if (!cacheKey || !(names instanceof Set)) return;
  if (bundleInventoryCache.has(cacheKey)) {
    bundleInventoryCache.delete(cacheKey);
  }
  bundleInventoryCache.set(cacheKey, {
    count: names.size,
    names: new Set(names)
  });
  while (bundleInventoryCache.size > BUNDLE_INVENTORY_CACHE_LIMIT) {
    const oldestKey = bundleInventoryCache.keys().next().value;
    bundleInventoryCache.delete(oldestKey);
  }
};

const resolveBundleInventoryCacheKey = (bundleDir) => {
  if (!bundleDir) return null;
  try {
    const stat = fsSync.statSync(bundleDir);
    return `${bundleDir}|${Math.floor(Number(stat?.mtimeMs) || 0)}|${Number(stat?.size) || 0}`;
  } catch {
    return null;
  }
};

/**
 * Build a directory inventory for incremental bundle files.
 * @param {string|null|undefined} bundleDir
 * @returns {{count:number,names:Set<string>}}
 */
export const listIncrementalBundleFiles = (bundleDir) => {
  if (!bundleDir || !fsSync.existsSync(bundleDir)) {
    return { count: 0, names: new Set() };
  }
  const cacheKey = resolveBundleInventoryCacheKey(bundleDir);
  const cached = readBundleInventoryCache(cacheKey);
  if (cached) return cached;
  const names = new Set(
    fsSync.readdirSync(bundleDir).filter((name) => typeof name === 'string' && !name.startsWith('.'))
  );
  writeBundleInventoryCache(cacheKey, names);
  return { count: names.size, names };
};

/**
 * Count missing bundle files declared in incremental manifest.
 * @param {object|null|undefined} incrementalData
 * @param {Set<string>|null} [bundleNames]
 * @returns {number}
 */
export const countMissingBundleFiles = (incrementalData, bundleNames = null) => {
  const bundleDir = incrementalData?.bundleDir;
  const files = incrementalData?.manifest?.files;
  if (!bundleDir || !files || typeof files !== 'object') return 0;
  const useNames = bundleNames instanceof Set ? bundleNames : null;
  let missing = 0;
  for (const entry of Object.values(files)) {
    const bundleName = entry?.bundle;
    if (!bundleName || typeof bundleName !== 'string') {
      missing += 1;
      continue;
    }
    if (useNames) {
      if (!useNames.has(bundleName)) missing += 1;
      continue;
    }
    const bundlePath = path.join(bundleDir, bundleName);
    if (!fsSync.existsSync(bundlePath)) {
      missing += 1;
    }
  }
  return missing;
};

/**
 * Resolve incremental-vs-artifact mode input plan.
 * @param {object} options
 * @returns {{
 *   bundleManifest: object|null,
 *   recordsIncrementalCapability: object,
 *   recordsIncrementalSupported: boolean,
 *   hasIncrementalBundles: boolean,
 *   bundleSkipReason: string|null,
 *   resolvedInput: {source:'incremental',bundleDir:string}|{source:'artifacts',indexDir:string|null}
 * }}
 */
export const resolveIncrementalInputPlan = ({
  mode,
  modeIndexDir,
  incrementalRequested,
  incrementalData,
  incrementalFileCount,
  incrementalBundleCount,
  missingBundleCount,
  denseArtifactsRequired
}) => {
  const bundleManifest = incrementalData?.manifest || null;
  const recordsIncrementalCapability = mode === 'records'
    ? resolveRecordsIncrementalCapability(bundleManifest)
    : { supported: true, explicit: false, reason: null };
  const recordsIncrementalSupported = recordsIncrementalCapability.supported === true;
  let hasIncrementalBundles = incrementalRequested && Boolean(
    bundleManifest
    && incrementalFileCount > 0
    && incrementalBundleCount > 0
    && missingBundleCount === 0
    && incrementalData?.bundleDir
  );
  let bundleSkipReason = null;
  if (!recordsIncrementalSupported) {
    bundleSkipReason = recordsIncrementalCapability.reason;
    hasIncrementalBundles = false;
  }
  if (hasIncrementalBundles
    && denseArtifactsRequired
    && bundleManifest?.bundleEmbeddings !== true) {
    const stageNote = bundleManifest.bundleEmbeddingStage
      ? ` (stage ${bundleManifest.bundleEmbeddingStage})`
      : '';
    bundleSkipReason = `bundles omit embeddings${stageNote}`;
    hasIncrementalBundles = false;
  }
  if (missingBundleCount > 0) {
    bundleSkipReason = `bundle file missing (${missingBundleCount})`;
    hasIncrementalBundles = false;
  }
  const resolvedInput = hasIncrementalBundles
    ? { source: 'incremental', bundleDir: incrementalData?.bundleDir || null }
    : { source: 'artifacts', indexDir: modeIndexDir || null };
  return {
    bundleManifest,
    recordsIncrementalCapability,
    recordsIncrementalSupported,
    hasIncrementalBundles,
    bundleSkipReason,
    resolvedInput
  };
};
