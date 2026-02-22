import { log, logError } from '../../../src/shared/progress.js';

const ENV_METADATA_KEYS = Object.freeze([
  'NODE_OPTIONS',
  'PAIROFCLEATS_TESTING',
  'PAIROFCLEATS_TEST_CONFIG',
  'PAIROFCLEATS_CACHE_ROOT',
  'PAIROFCLEATS_CRASH_LOG_ANNOUNCE'
]);

export const buildBenchEnvironmentMetadata = (env = process.env) => {
  const selected = {};
  for (const key of ENV_METADATA_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(env, key)) continue;
    const value = env[key];
    if (value == null || value === '') continue;
    selected[key] = String(value);
  }
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    selected
  };
};

export const emitBenchLog = (onLog, message, level = 'info') => {
  if (typeof onLog === 'function') {
    onLog(message, level);
    return;
  }
  if (level === 'error') {
    logError(message);
    return;
  }
  if (level === 'warn') {
    log(`[warn] ${message}`);
    return;
  }
  log(message);
};
