import { relocateEmbeddedSemanticCacheEntries } from '../../semantic/embedded-cache.js';
import { assertCurrentIndexFormat } from '../../../contracts/index-format.js';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { relocateSemanticCacheEntry } from './semantic-cache.js';
import { sha1 } from '../../../shared/hash.js';
import { normalizeBundleFormat } from '../../../shared/bundle-io-paths.js';
import {
  entryStatsMatch,
  pathExists,
  readBundleOrNull,
  resolveBundleImports,
  resolveBundleRecords
} from './shared.js';

/**
 * Detect coarse timestamp resolution where hash verification is safer.
 *
 * @param {number} mtimeMs
 * @returns {boolean}
 */
const isCoarseMtime = (mtimeMs) => (
  Number.isFinite(mtimeMs) && Math.trunc(mtimeMs) % 1000 === 0
);

/**
 * Decide whether incremental reuse should verify file hash despite stat match.
 *
 * @param {{mtimeMs:number}|null} fileStat
 * @param {{hash?:string}|null} cachedEntry
 * @returns {boolean}
 */
const shouldVerifyHash = (fileStat, cachedEntry) => (
  isCoarseMtime(fileStat?.mtimeMs) && !!cachedEntry?.hash
);

const MAX_SHARED_HASH_READ_ENTRIES = 256;

/**
 * Normalize optional shared read-state cache to a Map.
 *
 * @param {unknown} sharedReadState
 * @returns {Map<string, object>|null}
 */
const resolveSharedReadCache = (sharedReadState) => (
  sharedReadState instanceof Map ? sharedReadState : null
);

/**
 * Lookup a shared file hash/buffer cache entry when size+mtime still match.
 *
 * @param {Map<string, object>|null} sharedReadState
 * @param {string} relKey
 * @param {{size:number,mtimeMs:number}} fileStat
 * @returns {{size:number,mtimeMs:number,hash:string,buffer:Buffer|null}|null}
 */
const getSharedReadEntry = (sharedReadState, relKey, fileStat) => {
  const cache = resolveSharedReadCache(sharedReadState);
  if (!cache || !relKey) return null;
  const entry = cache.get(relKey);
  if (!entry || typeof entry !== 'object') return null;
  if (entry.size !== fileStat?.size || entry.mtimeMs !== fileStat?.mtimeMs) {
    cache.delete(relKey);
    return null;
  }
  return entry;
};

/**
 * Store a shared hash/buffer entry and evict oldest entries above cap.
 *
 * @param {object} input
 */
const setSharedReadEntry = ({
  sharedReadState,
  relKey,
  fileStat,
  hash,
  buffer = null
}) => {
  const cache = resolveSharedReadCache(sharedReadState);
  if (!cache || !relKey || !fileStat || !hash) return;
  cache.set(relKey, {
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
    hash,
    buffer: Buffer.isBuffer(buffer) ? buffer : null
  });
  if (cache.size > MAX_SHARED_HASH_READ_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
};

/**
 * Read file bytes and hash with optional shared-cache reuse.
 * Buffers are retained only when `requireBuffer` is true.
 *
 * @param {object} input
 * @returns {Promise<{hash:string,buffer:Buffer|null}>}
 */
const readFileBufferAndHash = async ({
  absPath,
  relKey,
  fileStat,
  sharedReadState = null,
  requireBuffer = false
}) => {
  const shared = getSharedReadEntry(sharedReadState, relKey, fileStat);
  if (shared) {
    if (!requireBuffer || Buffer.isBuffer(shared.buffer)) {
      return {
        hash: shared.hash,
        buffer: Buffer.isBuffer(shared.buffer) ? shared.buffer : null
      };
    }
  }
  const buffer = await fs.readFile(absPath);
  const hash = sha1(buffer);
  setSharedReadEntry({
    sharedReadState,
    relKey,
    fileStat,
    hash,
    buffer: requireBuffer ? buffer : null
  });
  return {
    hash,
    buffer: requireBuffer ? buffer : null
  };
};

/**
 * Attempt to load a cached bundle for a file.
 *
 * @param {{enabled:boolean,absPath:string,relKey:string,fileStat:import('node:fs').Stats,manifest:object,bundleDir:string,bundleFormat?:string|null,sharedReadState?:Map<string,object>|null}} input
 * @returns {Promise<{cachedBundle:object|null,fileHash:string|null,buffer:Buffer|null}>}
 */
export async function readCachedBundle({
  repoRoot = process.cwd(),
  enabled,
  absPath,
  relKey,
  fileStat,
  manifest,
  bundleDir,
  bundleFormat = null,
  sharedReadState = null,
  semanticContext = null
}) {
  let cachedBundle = null;
  let fileHash = null;
  let buffer = null;
  if (!enabled) return { cachedBundle, fileHash, buffer };
  assertCurrentIndexFormat({ operation: 'resume', component: 'incremental manifest',
    foundVersion: manifest?.artifactSurfaceVersion, repoRoot, indexPath: bundleDir });

  const resolvedBundleFormat = normalizeBundleFormat(bundleFormat || manifest?.bundleFormat);
  const cachedEntry = manifest?.files?.[relKey];
  if (!cachedEntry) return { cachedBundle, fileHash, buffer };
  const finish = async () => {
    if (!cachedBundle) return { cachedBundle, fileHash, buffer };
    if (cachedEntry.semanticCache) cachedBundle.semanticCache = cachedEntry.semanticCache;
    if (!semanticContext) return { cachedBundle, fileHash, buffer };
    if (!cachedEntry.semanticCache) return { cachedBundle: null, fileHash, buffer };
    // Exact source hash is mandatory even when a fine-grained stat timestamp matches.
    const currentBytes = await fs.readFile(absPath);
    const sourceHash = createHash('sha256').update(currentBytes).digest('hex');
    try {
      const semanticFactsRef = await relocateSemanticCacheEntry({
        repoRoot: semanticContext.repoRoot || repoRoot,
        bundleDir, locator: cachedEntry.semanticCache,
        dependencySignatures: semanticContext.dependencySignatures,
        sourceHash, sourcePath: relKey.split('\\').join('/'), repositoryNamespace: semanticContext.repositoryNamespace,
        targetBuildRoot: semanticContext.buildRoot, storage: semanticContext.storage,
        diskAccount: semanticContext.diskAccount, signal: semanticContext.signal
      });
      manifest.semanticEnabled = true;
      manifest.semanticGeneration = semanticFactsRef.storage.generation;
      manifest.semanticDependencySignatures = semanticContext.dependencySignatures;
      const embedded = await relocateEmbeddedSemanticCacheEntries({ entries: cachedEntry.semanticSegmentCaches || [], parentFacts: semanticFactsRef, parentBytes: currentBytes,
        repoRoot: semanticContext.repoRoot || repoRoot, bundleDir, dependencySignatures: semanticContext.dependencySignatures, targetBuildRoot: semanticContext.buildRoot,
        storage: semanticContext.storage, diskAccount: semanticContext.diskAccount, signal: semanticContext.signal });
      return { cachedBundle, fileHash, buffer: currentBytes, semanticFactsRef, ...embedded };
    } catch (error) {
      if (!['ERR_SEMANTIC_CACHE_MISMATCH', 'ERR_SEMANTIC_CACHE_INTEGRITY',
        'ERR_SEMANTIC_INTEGRITY', 'ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      return { cachedBundle: null, fileHash, buffer: currentBytes };
    }
  };

  const matchesStat = entryStatsMatch(cachedEntry, fileStat);
  if (!matchesStat && !cachedEntry.hash) return { cachedBundle, fileHash, buffer };

  const bundleRecords = resolveBundleRecords({
    relKey,
    entry: cachedEntry,
    bundleDir,
    fallbackFormat: resolvedBundleFormat
  });
  if (!bundleRecords?.length) {
    return { cachedBundle, fileHash, buffer };
  }
  for (const record of bundleRecords) {
    if (!(await pathExists(record.bundlePath))) {
      return { cachedBundle, fileHash, buffer };
    }
  }

  if (matchesStat) {
    try {
      if (shouldVerifyHash(fileStat, cachedEntry)) {
        const sharedRead = await readFileBufferAndHash({
          absPath,
          relKey,
          fileStat,
          sharedReadState,
          requireBuffer: true
        });
        buffer = sharedRead.buffer;
        fileHash = sharedRead.hash;
        if (fileHash !== cachedEntry.hash) {
          return { cachedBundle, fileHash, buffer };
        }
      }
      cachedBundle = await readBundleOrNull({ bundleRecords, repoRoot });
    } catch (error) {
      if (error?.code === 'ERR_INDEX_FORMAT_UNSUPPORTED') throw error;
      cachedBundle = null;
    }
    return finish();
  }

  try {
    const sharedRead = await readFileBufferAndHash({
      absPath,
      relKey,
      fileStat,
      sharedReadState,
      requireBuffer: true
    });
    buffer = sharedRead.buffer;
    fileHash = sharedRead.hash;
    if (fileHash === cachedEntry.hash) {
      cachedBundle = await readBundleOrNull({ bundleRecords, repoRoot });
    }
  } catch (error) {
    if (error?.code === 'ERR_INDEX_FORMAT_UNSUPPORTED') throw error;
    cachedBundle = null;
  }
  return finish();
}

/**
 * Attempt to load cached imports for a file when size/mtime match.
 *
 * @param {{enabled:boolean,absPath:string,relKey:string,fileStat:import('node:fs').Stats,manifest:object,bundleDir:string,bundleFormat?:string|null,sharedReadState?:Map<string,object>|null}} input
 * @returns {Promise<Array<string|{specifier:string,collectorHint?:object}>|null>}
 */
export async function readCachedImports({
  repoRoot = process.cwd(),
  enabled,
  absPath,
  relKey,
  fileStat,
  manifest,
  bundleDir,
  bundleFormat = null,
  sharedReadState = null,
  expectedImportScanFingerprint = null
}) {
  if (!enabled) return null;
  assertCurrentIndexFormat({ operation: 'resume', component: 'incremental manifest',
    foundVersion: manifest?.artifactSurfaceVersion, repoRoot, indexPath: bundleDir });
  const resolvedBundleFormat = normalizeBundleFormat(bundleFormat || manifest?.bundleFormat);
  const cachedEntry = manifest.files?.[relKey];
  if (!cachedEntry) return null;
  const matchesStat = entryStatsMatch(cachedEntry, fileStat);
  if (!matchesStat && !cachedEntry.hash) return null;
  const bundleRecords = resolveBundleRecords({
    relKey,
    entry: cachedEntry,
    bundleDir,
    fallbackFormat: resolvedBundleFormat
  });
  if (!bundleRecords?.length) return null;

  if (!matchesStat) {
    for (const record of bundleRecords) {
      if (!(await pathExists(record.bundlePath))) return null;
    }
    try {
      const sharedRead = await readFileBufferAndHash({
        absPath,
        relKey,
        fileStat,
        sharedReadState,
        requireBuffer: false
      });
      const fileHash = sharedRead.hash;
      if (fileHash !== cachedEntry.hash) return null;
      return resolveBundleImports(
        await readBundleOrNull({ bundleRecords, repoRoot }),
        { expectedImportScanFingerprint }
      );
    } catch {
      return null;
    }
  }
  if (shouldVerifyHash(fileStat, cachedEntry)) {
    try {
      const sharedRead = await readFileBufferAndHash({
        absPath,
        relKey,
        fileStat,
        sharedReadState,
        requireBuffer: false
      });
      const fileHash = sharedRead.hash;
      if (fileHash !== cachedEntry.hash) return null;
    } catch {
      return null;
    }
  }
  for (const record of bundleRecords) {
    if (!(await pathExists(record.bundlePath))) return null;
  }
  return resolveBundleImports(
    await readBundleOrNull({ bundleRecords, repoRoot }),
    { expectedImportScanFingerprint }
  );
}
