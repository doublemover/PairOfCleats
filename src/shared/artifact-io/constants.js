import { getHeapStatistics } from 'node:v8';
import { getTestEnvConfig } from '../env.js';

const DEFAULT_MAX_JSON_BYTES = (() => {
  const fallback = 128 * 1024 * 1024;
  try {
    const heapLimit = Number(getHeapStatistics()?.heap_size_limit);
    if (!Number.isFinite(heapLimit) || heapLimit <= 0) return fallback;
    const scaled = Math.floor(heapLimit * 0.1);
    const bounded = Math.min(fallback, scaled);
    return Math.max(32 * 1024 * 1024, bounded);
  } catch {
    return fallback;
  }
})();

const testEnv = getTestEnvConfig();
const MAX_JSON_BYTES_TEST_ENV = Number(testEnv?.maxJsonBytes);

export const MAX_JSON_BYTES = Number.isFinite(MAX_JSON_BYTES_TEST_ENV) && MAX_JSON_BYTES_TEST_ENV > 0
  ? Math.floor(MAX_JSON_BYTES_TEST_ENV)
  : DEFAULT_MAX_JSON_BYTES;
