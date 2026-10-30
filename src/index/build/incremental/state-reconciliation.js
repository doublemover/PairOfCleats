import { relocateEmbeddedSemanticCacheEntries } from '../../semantic/embedded-cache.js';
import { assertCurrentIndexFormat } from '../../../contracts/index-format.js';
import { createHash } from 'node:crypto';
import { relocateSemanticCacheEntry } from './semantic-cache.js';
import { normalizeBundleFormat } from '../../../shared/bundle-io-paths.js';
import { requiresSourceHashVerification } from './source-freshness.js';
import { readIncrementalSourceSnapshot, isIncrementalSourceMiss } from './source-snapshot.js';
import { composeAbortSignals, throwIfAborted } from '../../../shared/abort.js';
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

/**
 * Decide whether incremental reuse should verify file hash despite stat match.
 *
 * @param {{mtimeMs:number}|null} fileStat
 * @param {{hash?:string}|null} cachedEntry
 * @returns {boolean}
 */
const shouldVerifyHash = fileStat => requiresSourceHashVerification(fileStat);

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
  semanticContext = null,
  signal = null
}) {
  const sourceSignal = composeAbortSignals(signal, semanticContext?.signal);
  throwIfAborted(sourceSignal);
  if (semanticContext) semanticContext = { ...semanticContext, signal: sourceSignal };
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
    throwIfAborted(sourceSignal);
    if (!cachedBundle) return { cachedBundle, fileHash, buffer };
    if (cachedEntry.semanticCache) cachedBundle.semanticCache = cachedEntry.semanticCache;
    if (!semanticContext) return { cachedBundle, fileHash, buffer };
    if (!cachedEntry.semanticCache) return { cachedBundle: null, fileHash, buffer };
    // Exact source hash is mandatory even when a fine-grained stat timestamp matches.
    const currentBytes = buffer || (await readIncrementalSourceSnapshot({ repoRoot, absPath, fileStat, relKey,
      sharedReadState, signal: sourceSignal })).buffer;
    semanticContext.replayVerification?.recordSourceRead(currentBytes.length);
    const sourceHash = createHash('sha256').update(currentBytes).digest('hex');
    try {
      const verification = await semanticContext.replayVerification?.verify({ repoRoot: semanticContext.repoRoot || repoRoot,
        locator: cachedEntry.semanticCache, dependencySignatures: semanticContext.dependencySignatures,
        sourceHash, sourcePath: relKey.split('\\').join('/'), repositoryNamespace: semanticContext.repositoryNamespace,
        signal: semanticContext.signal });
      const semanticFactsRef = await relocateSemanticCacheEntry({
        repoRoot: semanticContext.repoRoot || repoRoot,
        bundleDir, locator: cachedEntry.semanticCache,
        dependencySignatures: semanticContext.dependencySignatures,
        sourceHash, sourcePath: relKey.split('\\').join('/'), repositoryNamespace: semanticContext.repositoryNamespace,
        targetBuildRoot: semanticContext.buildRoot, storage: semanticContext.storage,
        diskAccount: semanticContext.diskAccount, signal: semanticContext.signal, verificationToken: verification?.token,
        replayMetrics: semanticContext.replayVerification?.metrics
      });
      manifest.semanticEnabled = true;
      manifest.semanticGeneration = semanticFactsRef.storage.generation;
      manifest.semanticDependencySignatures = semanticContext.dependencySignatures;
      const embedded = await relocateEmbeddedSemanticCacheEntries({ entries: cachedEntry.semanticSegmentCaches || [], parentFacts: semanticFactsRef, parentBytes: currentBytes,
        repoRoot: semanticContext.repoRoot || repoRoot, bundleDir, dependencySignatures: semanticContext.dependencySignatures, targetBuildRoot: semanticContext.buildRoot,
        storage: semanticContext.storage, diskAccount: semanticContext.diskAccount, signal: semanticContext.signal });
      return { cachedBundle, fileHash, buffer: currentBytes, semanticFactsRef, semanticReplayToken: verification?.token,
        semanticReplayVerificationReceipt: verification?.verificationReceipt, ...embedded };
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
        const sharedRead = await readIncrementalSourceSnapshot({
          repoRoot,
          signal: sourceSignal,
          absPath,
          relKey,
          fileStat,
          sharedReadState
        });
        buffer = sharedRead.buffer;
        fileHash = sharedRead.hash;
        if (fileHash !== cachedEntry.hash) {
          return { cachedBundle, fileHash, buffer };
        }
      }
      cachedBundle = await readBundleOrNull({ bundleRecords, repoRoot });
    } catch (error) {
      if (!isIncrementalSourceMiss(error)) throw error;
      cachedBundle = null;
    }
    return finish();
  }

  try {
    const sharedRead = await readIncrementalSourceSnapshot({
      repoRoot,
      signal: sourceSignal,
      absPath,
      relKey,
      fileStat,
      sharedReadState
    });
    buffer = sharedRead.buffer;
    fileHash = sharedRead.hash;
    if (fileHash === cachedEntry.hash) {
      cachedBundle = await readBundleOrNull({ bundleRecords, repoRoot });
    }
  } catch (error) {
    if (!isIncrementalSourceMiss(error)) throw error;
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
  expectedImportScanFingerprint = null,
  signal = null
}) {
  throwIfAborted(signal);
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
      const sharedRead = await readIncrementalSourceSnapshot({
        repoRoot,
        signal,
        absPath,
        relKey,
        fileStat,
        sharedReadState
      });
      const fileHash = sharedRead.hash;
      if (fileHash !== cachedEntry.hash) return null;
      const bundle = await readBundleOrNull({ bundleRecords, repoRoot });
      throwIfAborted(signal);
      return resolveBundleImports(
        bundle,
        { expectedImportScanFingerprint }
      );
    } catch (error) {
      if (!isIncrementalSourceMiss(error)) throw error;
      return null;
    }
  }
  if (shouldVerifyHash(fileStat, cachedEntry)) {
    try {
      const sharedRead = await readIncrementalSourceSnapshot({
        repoRoot,
        signal,
        absPath,
        relKey,
        fileStat,
        sharedReadState
      });
      const fileHash = sharedRead.hash;
      if (fileHash !== cachedEntry.hash) return null;
    } catch (error) {
      if (!isIncrementalSourceMiss(error)) throw error;
      return null;
    }
  }
  for (const record of bundleRecords) {
    if (!(await pathExists(record.bundlePath))) return null;
  }
  const bundle = await readBundleOrNull({ bundleRecords, repoRoot });
  throwIfAborted(signal);
  return resolveBundleImports(
    bundle,
    { expectedImportScanFingerprint }
  );
}
