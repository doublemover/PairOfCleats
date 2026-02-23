import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson } from '../../../shared/io/atomic-write.js';
import {
  normalizeBundleFormat,
  resolveBundleFilename,
  writeBundleFile,
  writeBundlePatch
} from '../../../shared/bundle-io.js';
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
  resolveBundleRecord,
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

/**
 * Write bundle and return manifest entry.
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
  fileEncoding = null,
  fileEncodingFallback = null,
  fileEncodingConfidence = null
}) {
  if (!enabled) return null;
  const resolvedBundleFormat = normalizeBundleFormat(bundleFormat);
  const bundleName = resolveBundleFilename(relKey, resolvedBundleFormat);
  const bundlePath = path.join(bundleDir, bundleName);
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
    const writeResult = await writeBundleFile({
      bundlePath,
      bundle,
      format: resolvedBundleFormat
    });
    const checksum = writeResult.checksum;
    const checksumAlgo = writeResult.checksumAlgo;
    const bundleChecksum = checksum && checksumAlgo
      ? `${checksumAlgo}:${checksum}`
      : (checksum || null);
    return {
      hash: fileHash,
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      bundle: path.basename(bundlePath),
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
    if (entry?.bundle) {
      const bundlePath = path.join(bundleDir, entry.bundle);
      try {
        await fs.rm(bundlePath, { force: true });
      } catch {}
    }
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
      const bundleRecord = resolveBundleRecord({
        relKey: file,
        entry,
        bundleDir,
        fallbackFormat: resolvedBundleFormat
      });
      if (!bundleRecord) {
        rowsByFile.set(normalizedFile, null);
        continue;
      }
      if (!(await pathExists(bundleRecord.bundlePath))) {
        rowsByFile.set(normalizedFile, null);
        continue;
      }
      const existingBundle = await readBundleOrNull(bundleRecord);
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
    const bundleRecord = resolveBundleRecord({
      relKey: file,
      entry,
      bundleDir,
      fallbackFormat: resolvedBundleFormat
    });
    if (!bundleRecord) continue;
    pendingUpdates.push({
      file,
      normalizedFile,
      entry,
      bundleRecord,
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
  let bundlePatched = 0;
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
        bundleRecord,
        fileChunks,
        prefetchedHit = false,
        prefetchedRows = null
      } = prioritizedPendingUpdates[index];
      const relations = resolveFileRelations(normalizedFile, file);
      const bundlePath = bundleRecord.bundlePath;
      const bundleFormatLocal = bundleRecord.bundleFormat;
      let vfsManifestRows = null;
      let existingBundle = null;
      if (prefetchedHit) {
        vfsManifestRows = prefetchedRows;
      }
      if (!prefetchedHit || !skipFallbackReadForPrefetchMisses || bundleFormatLocal === 'json') {
        existingBundle = await readBundleOrNull(bundleRecord);
        if (!prefetchedHit) {
          vfsManifestRows = resolveBundleVfsManifestRows(existingBundle);
        }
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
      if (existingBundle && bundleFormatLocal === 'json') {
        try {
          const patchResult = await writeBundlePatch({
            bundlePath,
            previousBundle: existingBundle,
            nextBundle: bundle,
            format: bundleFormatLocal
          });
          if (patchResult?.applied) {
            bundleUpdates += 1;
            bundlePatched += 1;
            continue;
          }
          if (patchResult?.reason === 'no-changes') {
            bundleSkipped += 1;
            continue;
          }
        } catch {}
      }
      try {
        await writeBundleFile({
          bundlePath,
          bundle,
          format: bundleFormatLocal
        });
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
    const patchedText = bundlePatched > 0 ? `, patched ${bundlePatched}` : '';
    const skippedText = bundleSkipped > 0 ? `, reused ${bundleSkipped}` : '';
    log(
      `Cross-file inference updated ${bundleUpdates} incremental bundle(s)${patchedText}${skippedText}${failureText} `
      + `in ${durationMs}ms (workers=${workerCount}).`
    );
  }
}
