import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson } from '../../../shared/io/atomic-write.js';
import {
  normalizeBundleFormat,
  resolveBundleShardFilename,
  resolveManifestBundleNames,
  writeBundleFile
} from '../../../shared/bundle-io.js';
import { estimateJsonBytes } from '../../../shared/cache.js';
import {
  prioritizePendingCrossFileBundleUpdates,
  resolveIncrementalBundleUpdateConcurrency,
  sampleCpuIdleRatio
} from './autotune.js';
import { shouldReuseExistingBundle } from './bundle-compare.js';
import { normalizeIncrementalRelPath, resolvePrefetchedVfsRows } from './paths.js';
import {
  pathExists,
  readBundleOrNull,
  resolveBundleRecords,
  resolveBundleVfsManifestRows
} from './shared.js';

/**
 * Normalize file-relations input into a lookup function.
 *
 * @param {Map<string, object>|Record<string, object>|null} fileRelations
 * @returns {(normalizedFile:string,file:string)=>object|null}
 */
const createFileRelationsResolver = (fileRelations) => {
  if (!fileRelations) return () => null;
  if (typeof fileRelations.get === 'function') {
    return (normalizedFile, file) => (
      fileRelations.get(normalizedFile) || fileRelations.get(file) || null
    );
  }
  if (typeof fileRelations === 'object') {
    return (normalizedFile, file) => (
      fileRelations[normalizedFile] || fileRelations[file] || null
    );
  }
  return () => null;
};

const INCREMENTAL_BUNDLE_SHARD_TARGET_BYTES = 16 * 1024 * 1024;
const INCREMENTAL_BUNDLE_SHARD_HARD_TARGET_BYTES = 32 * 1024 * 1024;

const estimateBundleBytes = (value) => {
  const estimated = estimateJsonBytes(value);
  if (!Number.isFinite(estimated) || estimated <= 0) return 0;
  return Math.floor(estimated);
};

const splitBundleChunksBySize = (bundle) => {
  const chunks = Array.isArray(bundle?.chunks) ? bundle.chunks : [];
  if (!chunks.length) return [[]];
  const baseBundle = {
    ...bundle,
    chunks: []
  };
  const baseBytes = Math.max(1, estimateBundleBytes(baseBundle));
  const targetBytes = Math.max(baseBytes + 1024, INCREMENTAL_BUNDLE_SHARD_TARGET_BYTES);
  const hardTargetBytes = Math.max(targetBytes, INCREMENTAL_BUNDLE_SHARD_HARD_TARGET_BYTES);
  const shardChunks = [];
  let currentChunks = [];
  let currentBytes = baseBytes;
  for (const chunk of chunks) {
    const chunkBytes = Math.max(1, estimateBundleBytes(chunk));
    if (currentChunks.length && (currentBytes + chunkBytes) > targetBytes) {
      shardChunks.push(currentChunks);
      currentChunks = [];
      currentBytes = baseBytes;
    }
    currentChunks.push(chunk);
    currentBytes += chunkBytes;
    if ((currentBytes > hardTargetBytes) && currentChunks.length > 1) {
      const spillChunk = currentChunks.pop();
      shardChunks.push(currentChunks);
      currentChunks = spillChunk ? [spillChunk] : [];
      currentBytes = spillChunk ? (baseBytes + chunkBytes) : baseBytes;
    }
  }
  if (currentChunks.length) {
    shardChunks.push(currentChunks);
  }
  return shardChunks.length ? shardChunks : [[]];
};

const buildBundleShards = ({ relKey, bundleFormat, bundle }) => {
  const shardChunks = splitBundleChunksBySize(bundle);
  const shardCount = shardChunks.length;
  const bundles = shardChunks.map((chunks, index) => ({
    ...bundle,
    chunks,
    bundleShardIndex: index,
    bundleShardCount: shardCount
  }));
  const names = bundles.map((_, index) => resolveBundleShardFilename(relKey, bundleFormat, index));
  return { names, bundles };
};

const removeManifestBundleFiles = async ({ bundleDir, entry, keep = null }) => {
  const names = resolveManifestBundleNames(entry);
  if (!names.length) return;
  const keepSet = keep instanceof Set ? keep : null;
  for (const name of names) {
    if (keepSet && keepSet.has(name)) continue;
    try {
      await fs.rm(path.join(bundleDir, name), { force: true });
    } catch {}
  }
};

/**
 * Write bundle shard(s) and return manifest entry.
 *
 * @param {{
 *   enabled:boolean,
 *   bundleDir:string,
 *   relKey:string,
 *   fileStat:import('node:fs').Stats,
 *   fileHash:string,
 *   fileChunks:object[],
 *   fileRelations:object|null,
 *   vfsManifestRows?:Array<object>|null,
 *   bundleFormat?:string|null,
 *   previousManifestEntry?:object|null,
 *   fileEncoding?:string|null,
 *   fileEncodingFallback?:boolean|null,
 *   fileEncodingConfidence?:number|null
 * }} input
 * @returns {Promise<object|null>}
 */
export async function writeIncrementalBundle({
  enabled,
  bundleDir,
  relKey,
  fileStat,
  fileHash,
  fileChunks,
  fileRelations,
  vfsManifestRows,
  bundleFormat = null,
  previousManifestEntry = null,
  fileEncoding = null,
  fileEncodingFallback = null,
  fileEncodingConfidence = null
}) {
  if (!enabled) return null;
  const resolvedBundleFormat = normalizeBundleFormat(bundleFormat);
  const bundle = {
    file: relKey,
    hash: fileHash,
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    chunks: fileChunks,
    fileRelations,
    vfsManifestRows: Array.isArray(vfsManifestRows) ? vfsManifestRows : null,
    encoding: fileEncoding,
    encodingFallback: typeof fileEncodingFallback === 'boolean' ? fileEncodingFallback : null,
    encodingConfidence: Number.isFinite(fileEncodingConfidence) ? fileEncodingConfidence : null
  };
  try {
    const { names: bundleNames, bundles } = buildBundleShards({
      relKey,
      bundleFormat: resolvedBundleFormat,
      bundle
    });
    if (!bundleNames.length || !bundles.length || bundleNames.length !== bundles.length) {
      return null;
    }
    let checksum = null;
    let checksumAlgo = null;
    for (let i = 0; i < bundleNames.length; i += 1) {
      const bundleName = bundleNames[i];
      const bundlePath = path.join(bundleDir, bundleName);
      const writeResult = await writeBundleFile({
        bundlePath,
        bundle: bundles[i],
        format: resolvedBundleFormat
      });
      if (i === 0) {
        checksum = writeResult?.checksum || null;
        checksumAlgo = writeResult?.checksumAlgo || null;
      }
    }
    const keepSet = new Set(bundleNames);
    await removeManifestBundleFiles({
      bundleDir,
      entry: previousManifestEntry,
      keep: keepSet
    });
    const bundleChecksum = checksum && checksumAlgo
      ? `${checksumAlgo}:${checksum}`
      : (checksum || null);
    return {
      hash: fileHash,
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      bundles: bundleNames,
      bundleFormat: resolvedBundleFormat,
      bundleChecksum,
      encoding: fileEncoding,
      encodingFallback: typeof fileEncodingFallback === 'boolean' ? fileEncodingFallback : null,
      encodingConfidence: Number.isFinite(fileEncodingConfidence) ? fileEncodingConfidence : null
    };
  } catch {
    return null;
  }
}

/**
 * Remove incremental entries for deleted files and persist manifest.
 *
 * @param {{enabled:boolean,manifest:object,manifestPath:string,bundleDir:string,seenFiles:Set<string>}} input
 */
export async function pruneIncrementalManifest({ enabled, manifest, manifestPath, bundleDir, seenFiles }) {
  if (!enabled) return;
  const seenNormalized = new Set(
    Array.from(seenFiles || [])
      .map((entry) => normalizeIncrementalRelPath(entry))
      .filter(Boolean)
  );
  for (const relKey of Object.keys(manifest.files)) {
    const normalizedRelKey = normalizeIncrementalRelPath(relKey);
    if (seenNormalized.has(normalizedRelKey)) continue;
    const entry = manifest.files[relKey];
    await removeManifestBundleFiles({ bundleDir, entry });
    delete manifest.files[relKey];
  }
  try {
    await atomicWriteJson(manifestPath, manifest, { spaces: 2 });
  } catch {}
}

/**
 * Prefetch existing bundle VFS manifest rows so cross-file bundle rewrites can
 * preserve them without paying a serialized read phase after inference.
 *
 * @param {{
 *   enabled:boolean,
 *   manifest:object,
 *   bundleDir:string,
 *   bundleFormat?:string|null,
 *   concurrency?:number
 * }} input
 * @returns {Promise<Map<string,Array<object>|null>|null>}
 */
export async function preloadIncrementalBundleVfsRows({
  enabled,
  manifest,
  bundleDir,
  bundleFormat = null,
  concurrency = 8
}) {
  if (!enabled) return null;
  const entries = Object.entries(manifest?.files || {});
  if (!entries.length) return new Map();
  const resolvedBundleFormat = normalizeBundleFormat(bundleFormat || manifest?.bundleFormat);
  const rowsByFile = new Map();
  const normalizedConcurrency = Number.isFinite(Number(concurrency)) && Number(concurrency) > 0
    ? Math.max(1, Math.floor(Number(concurrency)))
    : 8;
  const workerCount = Math.min(entries.length, normalizedConcurrency);
  let cursor = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= entries.length) break;
      const [file, entry] = entries[index];
      const normalizedFile = normalizeIncrementalRelPath(file);
      const bundleRecords = resolveBundleRecords({
        relKey: file,
        entry,
        bundleDir,
        fallbackFormat: resolvedBundleFormat
      });
      if (!bundleRecords?.length) {
        rowsByFile.set(normalizedFile, null);
        continue;
      }
      let missing = false;
      for (const record of bundleRecords) {
        if (!(await pathExists(record.bundlePath))) {
          missing = true;
          break;
        }
      }
      if (missing) {
        rowsByFile.set(normalizedFile, null);
        continue;
      }
      const existingBundle = await readBundleOrNull({ bundleRecords });
      rowsByFile.set(normalizedFile, resolveBundleVfsManifestRows(existingBundle));
    }
  });
  await Promise.all(workers);
  return rowsByFile;
}

/**
 * Update incremental bundles after cross-file inference.
 *
 * @param {{
 *   enabled:boolean,
 *   manifest:object,
 *   bundleDir:string,
 *   chunks:object[],
 *   fileRelations:Map<string,object>|object|null,
 *   bundleFormat?:string|null,
 *   existingVfsManifestRowsByFile?:Map<string,Array<object>|null>|object|null,
 *   log:(msg:string)=>void
 * }} input
 */
export async function updateBundlesWithChunks({
  enabled,
  manifest,
  bundleDir,
  chunks,
  fileRelations,
  bundleFormat = null,
  existingVfsManifestRowsByFile = null,
  log
}) {
  if (!enabled) return;
  const startedAt = Date.now();
  const chunkMap = new Map();
  for (const chunk of chunks) {
    if (!chunk?.file) continue;
    const fileKey = normalizeIncrementalRelPath(chunk.file);
    const list = chunkMap.get(fileKey) || [];
    list.push(chunk);
    chunkMap.set(fileKey, list);
  }
  const resolvedBundleFormat = normalizeBundleFormat(bundleFormat || manifest?.bundleFormat);
  const pendingUpdates = [];
  for (const [file, entry] of Object.entries(manifest.files || {})) {
    const normalizedFile = normalizeIncrementalRelPath(file);
    const fileChunks = chunkMap.get(normalizedFile);
    if (!fileChunks) continue;
    const bundleRecords = resolveBundleRecords({
      relKey: file,
      entry,
      bundleDir,
      fallbackFormat: resolvedBundleFormat
    });
    if (!bundleRecords?.length) continue;
    pendingUpdates.push({
      file,
      normalizedFile,
      entry,
      bundleRecords,
      bundleFormatLocal: bundleRecords[0].bundleFormat || resolvedBundleFormat,
      fileChunks
    });
  }
  if (!pendingUpdates.length) return;
  const prioritizedPendingUpdates = prioritizePendingCrossFileBundleUpdates(pendingUpdates, { nowMs: startedAt });
  const resolveFileRelations = createFileRelationsResolver(fileRelations);
  const hasPrefetchedRowsStore = !!(
    existingVfsManifestRowsByFile
    && (
      typeof existingVfsManifestRowsByFile.get === 'function'
      || typeof existingVfsManifestRowsByFile === 'object'
    )
  );
  let prefetchHits = 0;
  if (hasPrefetchedRowsStore) {
    for (const pending of prioritizedPendingUpdates) {
      const prefetched = resolvePrefetchedVfsRows(
        existingVfsManifestRowsByFile,
        pending.normalizedFile,
        pending.file
      );
      pending.prefetchedHit = prefetched.hit;
      pending.prefetchedRows = prefetched.rows;
      if (prefetched.hit) {
        prefetchHits += 1;
      }
    }
  }
  const prefetchCoverage = prioritizedPendingUpdates.length
    ? (prefetchHits / prioritizedPendingUpdates.length)
    : 0;
  const skipFallbackReadForPrefetchMisses = hasPrefetchedRowsStore && prefetchCoverage >= 0.95;
  if (
    hasPrefetchedRowsStore
    && !skipFallbackReadForPrefetchMisses
    && typeof log === 'function'
  ) {
    log(
      `[incremental] bundle VFS prefetch coverage ${(prefetchCoverage * 100).toFixed(1)}%; ` +
      'reading misses from existing bundles.'
    );
  }
  let bundleUpdates = 0;
  let bundleSkipped = 0;
  let bundleFailures = 0;
  let nextProgressUpdate = 500;
  const updateTotal = prioritizedPendingUpdates.length;
  const cpuIdleRatio = await sampleCpuIdleRatio();
  const workerCount = resolveIncrementalBundleUpdateConcurrency({
    totalUpdates: updateTotal,
    cpuIdleRatio
  });
  let cursor = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= prioritizedPendingUpdates.length) break;
      const {
        file,
        normalizedFile,
        entry,
        bundleRecords,
        bundleFormatLocal,
        fileChunks,
        prefetchedHit = false,
        prefetchedRows = null
      } = prioritizedPendingUpdates[index];
      const relations = resolveFileRelations(normalizedFile, file);
      let vfsManifestRows = null;
      let existingBundle = await readBundleOrNull({ bundleRecords });
      if (prefetchedHit) {
        vfsManifestRows = prefetchedRows;
      }
      if (!prefetchedHit || !Array.isArray(vfsManifestRows)) {
        vfsManifestRows = resolveBundleVfsManifestRows(existingBundle);
      }
      const bundle = {
        file,
        hash: entry.hash,
        mtimeMs: entry.mtimeMs,
        size: entry.size,
        chunks: fileChunks,
        fileRelations: relations,
        vfsManifestRows,
        encoding: entry.encoding || null,
        encodingFallback: typeof entry.encodingFallback === 'boolean' ? entry.encodingFallback : null,
        encodingConfidence: Number.isFinite(entry.encodingConfidence) ? entry.encodingConfidence : null
      };
      if (shouldReuseExistingBundle(existingBundle, bundle)) {
        bundleSkipped += 1;
        continue;
      }
      try {
        const { names: bundleNames, bundles } = buildBundleShards({
          relKey: file,
          bundleFormat: bundleFormatLocal,
          bundle
        });
        if (!bundleNames.length || !bundles.length || bundleNames.length !== bundles.length) {
          bundleFailures += 1;
          continue;
        }
        let checksum = null;
        let checksumAlgo = null;
        for (let shardIndex = 0; shardIndex < bundleNames.length; shardIndex += 1) {
          const shardName = bundleNames[shardIndex];
          const shardPath = path.join(bundleDir, shardName);
          const writeResult = await writeBundleFile({
            bundlePath: shardPath,
            bundle: bundles[shardIndex],
            format: bundleFormatLocal
          });
          if (shardIndex === 0) {
            checksum = writeResult?.checksum || null;
            checksumAlgo = writeResult?.checksumAlgo || null;
          }
        }
        const keepSet = new Set(bundleNames);
        await removeManifestBundleFiles({
          bundleDir,
          entry,
          keep: keepSet
        });
        entry.bundles = bundleNames;
        if (checksum && checksumAlgo) {
          entry.bundleChecksum = `${checksumAlgo}:${checksum}`;
        } else {
          entry.bundleChecksum = checksum || null;
        }
        entry.bundleFormat = bundleFormatLocal;
        bundleUpdates += 1;
      } catch {
        bundleFailures += 1;
      }
      const completed = bundleUpdates + bundleFailures;
      if (typeof log === 'function' && completed >= nextProgressUpdate && completed < updateTotal) {
        log(`[incremental] cross-file bundle updates: ${completed}/${updateTotal}`);
        nextProgressUpdate += 500;
      }
    }
  });
  await Promise.all(workers);
  if (bundleUpdates || bundleSkipped || bundleFailures) {
    const durationMs = Math.max(0, Date.now() - startedAt);
    const failureText = bundleFailures > 0 ? `, failed ${bundleFailures}` : '';
    const skippedText = bundleSkipped > 0 ? `, reused ${bundleSkipped}` : '';
    log(
      `Cross-file inference updated ${bundleUpdates} incremental bundle(s)${skippedText}${failureText} `
      + `in ${durationMs}ms (workers=${workerCount}).`
    );
  }
}
