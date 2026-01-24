import path from 'node:path';
import os from 'node:os';

const resolveTestCacheRoot = (env) => {
  const testing = env?.PAIROFCLEATS_TESTING === '1' || env?.PAIROFCLEATS_TESTING === 'true';
  if (!testing) return '';
  const raw = typeof env.PAIROFCLEATS_CACHE_ROOT === 'string' ? env.PAIROFCLEATS_CACHE_ROOT.trim() : '';
  return raw || '';
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
  const testRoot = resolveTestCacheRoot(process.env);
  if (testRoot) return testRoot;
  return getDefaultCacheRoot();
}
