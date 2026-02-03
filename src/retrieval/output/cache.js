import {
  createCacheReporter,
  createLruCache,
  DEFAULT_CACHE_MB,
  DEFAULT_CACHE_TTL_MS,
  estimateStringBytes
} from '../../shared/cache.js';
import { getEnvConfig } from '../../shared/env.js';

const resolveEntryLimit = (raw) => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
};

let outputCacheReporter = createCacheReporter({ enabled: false, log: null });
let fileTextCache = createLruCache({
  name: 'fileText',
  maxMb: DEFAULT_CACHE_MB.fileText,
  ttlMs: DEFAULT_CACHE_TTL_MS.fileText,
  sizeCalculation: estimateStringBytes,
  reporter: outputCacheReporter
});
let summaryCache = createLruCache({
  name: 'summary',
  maxMb: DEFAULT_CACHE_MB.summary,
  ttlMs: DEFAULT_CACHE_TTL_MS.summary,
  sizeCalculation: estimateStringBytes,
  reporter: outputCacheReporter
});
let formatFullCache = createLruCache({
  name: 'formatFull',
  maxMb: DEFAULT_CACHE_MB.formatFull,
  ttlMs: DEFAULT_CACHE_TTL_MS.formatFull,
  sizeCalculation: estimateStringBytes,
  reporter: outputCacheReporter
});
let formatShortCache = createLruCache({
  name: 'formatShort',
  maxMb: DEFAULT_CACHE_MB.formatShort,
  ttlMs: DEFAULT_CACHE_TTL_MS.formatShort,
  sizeCalculation: estimateStringBytes,
  reporter: outputCacheReporter
});

export function configureOutputCaches({ cacheConfig = null, verbose = false, log = null } = {}) {
  const envConfig = getEnvConfig();
  const entryLimits = {
    fileText: resolveEntryLimit(envConfig.fileCacheMax),
    summary: resolveEntryLimit(envConfig.summaryCacheMax)
  };
  outputCacheReporter = createCacheReporter({ enabled: verbose, log });
  const fileTextConfig = cacheConfig?.fileText || {};
  const summaryConfig = cacheConfig?.summary || {};
  const formatFullConfig = cacheConfig?.formatFull || {};
  const formatShortConfig = cacheConfig?.formatShort || {};
  fileTextCache = createLruCache({
    name: 'fileText',
    maxMb: Number.isFinite(Number(fileTextConfig.maxMb))
      ? Number(fileTextConfig.maxMb)
      : DEFAULT_CACHE_MB.fileText,
    ttlMs: Number.isFinite(Number(fileTextConfig.ttlMs))
      ? Number(fileTextConfig.ttlMs)
      : DEFAULT_CACHE_TTL_MS.fileText,
    maxEntries: entryLimits.fileText,
    sizeCalculation: estimateStringBytes,
    reporter: outputCacheReporter
  });
  summaryCache = createLruCache({
    name: 'summary',
    maxMb: Number.isFinite(Number(summaryConfig.maxMb))
      ? Number(summaryConfig.maxMb)
      : DEFAULT_CACHE_MB.summary,
    ttlMs: Number.isFinite(Number(summaryConfig.ttlMs))
      ? Number(summaryConfig.ttlMs)
      : DEFAULT_CACHE_TTL_MS.summary,
    maxEntries: entryLimits.summary,
    sizeCalculation: estimateStringBytes,
    reporter: outputCacheReporter
  });
  formatFullCache = createLruCache({
    name: 'formatFull',
    maxMb: Number.isFinite(Number(formatFullConfig.maxMb))
      ? Number(formatFullConfig.maxMb)
      : DEFAULT_CACHE_MB.formatFull,
    ttlMs: Number.isFinite(Number(formatFullConfig.ttlMs))
      ? Number(formatFullConfig.ttlMs)
      : DEFAULT_CACHE_TTL_MS.formatFull,
    sizeCalculation: estimateStringBytes,
    reporter: outputCacheReporter
  });
  formatShortCache = createLruCache({
    name: 'formatShort',
    maxMb: Number.isFinite(Number(formatShortConfig.maxMb))
      ? Number(formatShortConfig.maxMb)
      : DEFAULT_CACHE_MB.formatShort,
    ttlMs: Number.isFinite(Number(formatShortConfig.ttlMs))
      ? Number(formatShortConfig.ttlMs)
      : DEFAULT_CACHE_TTL_MS.formatShort,
    sizeCalculation: estimateStringBytes,
    reporter: outputCacheReporter
  });
  return outputCacheReporter;
}

export function getOutputCacheReporter() {
  return outputCacheReporter;
}

export function getFileTextCache() {
  return fileTextCache;
}

export function getSummaryCache() {
  return summaryCache;
}

export function getFormatFullCache() {
  return formatFullCache;
}

export function getFormatShortCache() {
  return formatShortCache;
}
