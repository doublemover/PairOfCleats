import fs from 'node:fs/promises';
import path from 'node:path';
import {
  readBundleFile,
  resolveBundleFilename,
  resolveBundleFormatFromName
} from '../../../shared/bundle-io.js';

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

/**
 * Resolve bundle path/format from manifest entry and fallback format.
 *
 * @param {{relKey:string,entry?:object|null,bundleDir:string,fallbackFormat:string}} input
 * @returns {{bundleName:string,bundlePath:string,bundleFormat:string}|null}
 */
export const resolveBundleRecord = ({
  relKey,
  entry,
  bundleDir,
  fallbackFormat
}) => {
  const bundleName = entry?.bundle || resolveBundleFilename(relKey, fallbackFormat);
  if (!bundleName) return null;
  return {
    bundleName,
    bundlePath: path.join(bundleDir, bundleName),
    bundleFormat: resolveBundleFormatFromName(bundleName, fallbackFormat)
  };
};

/**
 * Read a bundle payload and normalize read failures to null.
 *
 * @param {{bundlePath:string,bundleFormat:string}} input
 * @returns {Promise<object|null>}
 */
export const readBundleOrNull = async ({ bundlePath, bundleFormat }) => {
  try {
    const result = await readBundleFile(bundlePath, { format: bundleFormat });
    return result.ok ? result.bundle : null;
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
export const resolveBundleImports = (bundle) => {
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
