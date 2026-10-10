import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { assertCurrentIndexFormat } from '../../contracts/index-format.js';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import { logLine } from '../../shared/progress-runtime.js';

const INCREMENTAL_MANIFEST_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Resolve incremental cache paths for a repo/mode.
 * @param {string} repoCacheRoot
 * @param {'code'|'prose'} mode
 * @returns {{incrementalDir:string,bundleDir:string,manifestPath:string}}
 */
export function getIncrementalPaths(repoCacheRoot, mode) {
  const incrementalDir = path.join(repoCacheRoot, 'incremental', 'format-' + ARTIFACT_SURFACE_VERSION, mode);
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
export function loadIncrementalManifest(repoCacheRoot, mode, { repoRoot = process.cwd() } = {}) {
  const paths = getIncrementalPaths(repoCacheRoot, mode);
  if (!fs.existsSync(paths.manifestPath)) return null;
  try {
    const stat = fs.statSync(paths.manifestPath);
    if (Number.isFinite(stat?.size) && stat.size > INCREMENTAL_MANIFEST_MAX_BYTES) {
      logLine(
        `[sqlite] incremental manifest too large; skipping (${stat.size} bytes > ${INCREMENTAL_MANIFEST_MAX_BYTES} bytes).`,
        { kind: 'warning' }
      );
      return null;
    }
    const manifest = JSON.parse(fs.readFileSync(paths.manifestPath, 'utf8'));
    assertCurrentIndexFormat({ operation: 'import', component: 'incremental manifest',
      foundVersion: manifest?.artifactSurfaceVersion, repoRoot, indexPath: paths.manifestPath });
    if (!manifest || typeof manifest !== 'object') return null;
    return { manifest, ...paths };
  } catch (error) {
    if (error?.code === 'ERR_INDEX_FORMAT_UNSUPPORTED') throw error;
    return null;
  }
}

/**
 * Persist an incremental manifest atomically.
 * @param {string} manifestPath
 * @param {object} manifest
 * @returns {Promise<boolean>}
 */
export async function writeIncrementalManifest(manifestPath, manifest) {
  if (!manifestPath || !manifest || typeof manifest !== 'object') return false;
  try {
    await atomicWriteJson(manifestPath, manifest, { spaces: 2 });
    return true;
  } catch {
    return false;
  }
}
