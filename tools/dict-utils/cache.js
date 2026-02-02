import path from 'node:path';
import os from 'node:os';

const resolveEnvCacheRoot = (env) => {
  const cacheRoot = typeof env.PAIROFCLEATS_CACHE_ROOT === 'string' ? env.PAIROFCLEATS_CACHE_ROOT.trim() : '';
  if (cacheRoot) return cacheRoot;
  const homeRoot = typeof env.PAIROFCLEATS_HOME === 'string' ? env.PAIROFCLEATS_HOME.trim() : '';
  return homeRoot || '';
};

/**
 * Resolve the default cache root directory (ignores test overrides).
 * @returns {string}
 */
export function getDefaultCacheRoot() {
  if (process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'PairOfCleats');
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, 'pairofcleats');
  return path.join(os.homedir(), '.cache', 'pairofcleats');
}

/**
 * Resolve the cache root directory.
 * @returns {string}
 */
export function getCacheRoot() {
  const envRoot = resolveEnvCacheRoot(process.env);
  if (envRoot) return envRoot;
  return getDefaultCacheRoot();
}
