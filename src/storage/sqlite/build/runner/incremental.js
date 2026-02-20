import fsSync from 'node:fs';
import path from 'node:path';

/**
 * Build a directory inventory for incremental bundle files.
 * @param {string|null|undefined} bundleDir
 * @returns {{count:number,names:Set<string>}}
 */
export const listIncrementalBundleFiles = (bundleDir) => {
  if (!bundleDir || !fsSync.existsSync(bundleDir)) {
    return { count: 0, names: new Set() };
  }
  const names = new Set(
    fsSync.readdirSync(bundleDir).filter((name) => typeof name === 'string' && !name.startsWith('.'))
  );
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
