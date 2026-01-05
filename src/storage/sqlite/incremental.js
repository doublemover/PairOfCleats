import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve incremental cache paths for a repo/mode.
 * @param {string} repoCacheRoot
 * @param {'code'|'prose'} mode
 * @returns {{incrementalDir:string,bundleDir:string,manifestPath:string}}
 */
export function getIncrementalPaths(repoCacheRoot, mode) {
  const incrementalDir = path.join(repoCacheRoot, 'incremental', mode);
  return {
    incrementalDir,
    bundleDir: path.join(incrementalDir, 'files'),
    manifestPath: path.join(incrementalDir, 'manifest.json')
  };
}

/**
 * Load the incremental manifest if present.
 * @param {string} repoCacheRoot
 * @param {'code'|'prose'} mode
 * @returns {{manifest:object,incrementalDir:string,bundleDir:string,manifestPath:string}|null}
 */
export function loadIncrementalManifest(repoCacheRoot, mode) {
  const paths = getIncrementalPaths(repoCacheRoot, mode);
  if (!fs.existsSync(paths.manifestPath)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(paths.manifestPath, 'utf8'));
    if (!manifest || typeof manifest !== 'object') return null;
    return { manifest, ...paths };
  } catch {
    return null;
  }
}
