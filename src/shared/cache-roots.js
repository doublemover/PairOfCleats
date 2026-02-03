import os from 'node:os';
import path from 'node:path';
import { getEnvConfig } from './env.js';

/**
 * Resolve the default cache root directory (ignores test overrides).
 *
 * Deterministic: derived from OS/env only.
 * Path handling: returns absolute OS path.
 *
 * @returns {string}
 */
export function getDefaultCacheRoot() {
  if (process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'PairOfCleats');
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, 'pairofcleats');
  return path.join(os.homedir(), '.cache', 'pairofcleats');
}

/**
 * Resolve the cache root directory.
 *
 * Cache rules: respects config overrides (`cache.root`) when provided.
 * Path handling: returns absolute OS path.
 *
 * @returns {string}
 */
export function getCacheRoot() {
  const envConfig = getEnvConfig();
  const envRoot = envConfig.cacheRoot || envConfig.homeRoot || '';
  if (envRoot) return envRoot;
  return getDefaultCacheRoot();
}
