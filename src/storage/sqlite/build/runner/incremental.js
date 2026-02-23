import fsSync from 'node:fs';
import path from 'node:path';
import { resolveRecordsIncrementalCapability } from '../index.js';

const BUNDLE_INVENTORY_CACHE_LIMIT = 64;
const bundleInventoryCache = new Map();
const FNV64_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const FNV64_MASK = 0xffffffffffffffffn;

/**
 * Read a cached directory inventory snapshot.
 *
 * Access updates recency (LRU behavior).
 *
 * @param {string|null} cacheKey
 * @returns {{count:number,names:Set<string>}|null}
 */
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

/**
 * Write an inventory snapshot into the bounded LRU cache.
 *
 * @param {string|null} cacheKey
 * @param {Set<string>} names
 * @returns {void}
 */
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

/**
 * Hash one inventory file name using 64-bit FNV-1a.
 *
 * @param {string} name
 * @returns {bigint}
 */
const hashInventoryName = (name) => {
  let hash = FNV64_OFFSET_BASIS;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= BigInt(name.charCodeAt(i));
    hash = (hash * FNV64_PRIME) & FNV64_MASK;
  }
  return hash;
};

/**
 * Build a cheap change-sensitive snapshot key for a bundle directory.
 *
 * The key combines entry count with xor/sum over hashed names so in-memory
 * inventory cache invalidates when directory contents change.
 *
 * @param {string|null|undefined} bundleDir
 * @returns {{cacheKey:string,names:string[]} | null}
 */
const resolveBundleInventorySnapshot = (bundleDir) => {
  if (!bundleDir) return null;
  try {
    const names = [];
    let hashXor = 0n;
    let hashSum = 0n;
    for (const name of fsSync.readdirSync(bundleDir)) {
      if (typeof name !== 'string' || name.startsWith('.')) continue;
      names.push(name);
      const entryHash = hashInventoryName(name);
      hashXor ^= entryHash;
      hashSum = (hashSum + entryHash) & FNV64_MASK;
    }
    return {
      cacheKey: `${bundleDir}|${names.length}|${hashXor.toString(16)}|${hashSum.toString(16)}`,
      names
    };
  } catch {
    return null;
  }
};

/**
 * Build a directory inventory for incremental bundle files.
 * Uses an in-memory LRU cache keyed by directory snapshot.
 *
 * @param {string|null|undefined} bundleDir
 * @returns {{count:number,names:Set<string>}}
 */
export const listIncrementalBundleFiles = (bundleDir) => {
  const snapshot = resolveBundleInventorySnapshot(bundleDir);
  if (!snapshot) {
    return { count: 0, names: new Set() };
  }
  const cached = readBundleInventoryCache(snapshot.cacheKey);
  if (cached) return cached;
  const names = new Set(snapshot.names);
  writeBundleInventoryCache(snapshot.cacheKey, names);
  return { count: names.size, names };
};

/**
 * Count missing bundle files declared in incremental manifest.
 * Supports precomputed bundle-name inventory to avoid repeated fs exists checks.
 *
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
 *
 * Invariants:
 * - Records mode must advertise incremental support from manifest capabilities.
 * - Dense-required modes cannot use incremental bundles unless embeddings are
 *   present in bundle manifest metadata.
 * - Missing bundle files always force artifact fallback.
 *
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
