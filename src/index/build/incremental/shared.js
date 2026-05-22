import fs from 'node:fs/promises';
import path from 'node:path';
import {
  resolveBundleFormatFromName,
  resolveManifestBundleNames
} from '../../../shared/bundle-io-paths.js';
import { readBundleFile } from '../../../shared/bundle-io.js';

/**
 * Check whether a filesystem path is accessible.
 *
 * @param {string} targetPath
 * @returns {Promise<boolean>}
 */
export const pathExists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Validate manifest stat cache entry against current file stat.
 *
 * @param {{size:number,mtimeMs:number}|null} cachedEntry
 * @param {{size:number,mtimeMs:number}|null} fileStat
 * @returns {boolean}
 */
export const entryStatsMatch = (cachedEntry, fileStat) => (
  !!cachedEntry
  && cachedEntry.size === fileStat?.size
  && cachedEntry.mtimeMs === fileStat?.mtimeMs
);

const normalizeNonNegativeInt = (value) => Math.max(0, Number(value) || 0);

/**
 * Backfill embedding coverage fields on manifests that do not carry bundled
 * embeddings. Older manifests omitted these counters, while downstream SQLite
 * and records gates expect explicit incomplete-coverage metadata.
 *
 * @param {object|null} manifest
 * @returns {object|null}
 */
export const normalizeIncrementalEmbeddingCoverageManifest = (manifest) => {
  if (!manifest || typeof manifest !== 'object') return manifest || null;
  if (manifest.bundleEmbeddings === true) return manifest;
  manifest.bundleEmbeddings = false;
  manifest.bundleEmbeddingCoverageComplete = false;
  manifest.bundleEmbeddingCoverageEligible = normalizeNonNegativeInt(
    manifest.bundleEmbeddingCoverageEligible
  );
  manifest.bundleEmbeddingCoverageCovered = normalizeNonNegativeInt(
    manifest.bundleEmbeddingCoverageCovered
  );
  manifest.bundleEmbeddingCoverageMissingFiles = normalizeNonNegativeInt(
    manifest.bundleEmbeddingCoverageMissingFiles
  );
  manifest.bundleEmbeddingCoverageMissingChunks = normalizeNonNegativeInt(
    manifest.bundleEmbeddingCoverageMissingChunks
  );
  return manifest;
};

/**
 * Resolve bundle shard path/format records from manifest entry.
 *
 * @param {{relKey:string,entry?:object|null,bundleDir:string,fallbackFormat:string}} input
 * @returns {Array<{bundleName:string,bundlePath:string,bundleFormat:string}>|null}
 */
export const resolveBundleRecords = ({
  relKey,
  entry,
  bundleDir,
  fallbackFormat
}) => {
  if (!relKey || !bundleDir) return null;
  const bundleNames = resolveManifestBundleNames(entry);
  if (!bundleNames.length) return null;
  return bundleNames.map((bundleName) => ({
    bundleName,
    bundlePath: path.join(bundleDir, bundleName),
    bundleFormat: resolveBundleFormatFromName(bundleName, fallbackFormat)
  }));
};

/**
 * Resolve first bundle record.
 *
 * @param {{relKey:string,entry?:object|null,bundleDir:string,fallbackFormat:string}} input
 * @returns {{bundleName:string,bundlePath:string,bundleFormat:string}|null}
 */
export const resolveBundleRecord = (input) => {
  const records = resolveBundleRecords(input);
  return Array.isArray(records) && records.length ? records[0] : null;
};

const mergeBundleShards = (shards) => {
  if (!Array.isArray(shards) || !shards.length) return null;
  let merged = null;
  for (const bundle of shards) {
    if (!bundle || typeof bundle !== 'object') return null;
    const chunkList = Array.isArray(bundle.chunks) ? bundle.chunks : null;
    if (!chunkList) return null;
    if (!merged) {
      merged = {
        ...bundle,
        chunks: [...chunkList]
      };
      continue;
    }
    merged.chunks.push(...chunkList);
    if (!merged.fileRelations && bundle.fileRelations) {
      merged.fileRelations = bundle.fileRelations;
    }
    if (!Array.isArray(merged.vfsManifestRows) && Array.isArray(bundle.vfsManifestRows)) {
      merged.vfsManifestRows = bundle.vfsManifestRows;
    }
  }
  return merged;
};

/**
 * Read bundle shard payload(s) and normalize read failures to null.
 *
 * @param {{bundlePath:string,bundleFormat:string}|{bundleRecords:Array<{bundlePath:string,bundleFormat:string}>}|Array<{bundlePath:string,bundleFormat:string}>} input
 * @returns {Promise<object|null>}
 */
export const readBundleOrNull = async (input) => {
  const records = Array.isArray(input)
    ? input
    : (Array.isArray(input?.bundleRecords) ? input.bundleRecords : (input ? [input] : []));
  if (!records.length) return null;
  const loadedShards = [];
  try {
    for (const record of records) {
      const result = await readBundleFile(record.bundlePath, { format: record.bundleFormat });
      if (!result.ok) return null;
      loadedShards.push(result.bundle);
    }
    return mergeBundleShards(loadedShards);
  } catch {
    return null;
  }
};

/**
 * Read normalized imports list from bundle payload.
 *
 * @param {object|null} bundle
 * @returns {Array<object>|null}
 */
export const resolveBundleImports = (bundle, { expectedImportScanFingerprint = null } = {}) => {
  if (expectedImportScanFingerprint != null) {
    const cachedFingerprint = typeof bundle?.fileRelations?.importScanFingerprint === 'string'
      ? bundle.fileRelations.importScanFingerprint
      : null;
    if (!cachedFingerprint || cachedFingerprint !== expectedImportScanFingerprint) {
      return null;
    }
  }
  const imports = bundle?.fileRelations?.imports;
  return Array.isArray(imports) ? imports : null;
};

/**
 * Read optional VFS manifest rows from bundle payload.
 *
 * @param {object|null} bundle
 * @returns {Array<object>|null}
 */
export const resolveBundleVfsManifestRows = (bundle) => (
  Array.isArray(bundle?.vfsManifestRows) ? bundle.vfsManifestRows : null
);
