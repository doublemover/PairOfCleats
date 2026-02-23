import PQueue from 'p-queue';
import { getScmRuntimeConfig } from '../../runtime.js';
import { coercePositiveIntMinOne } from '../../../../shared/number-coerce.js';

const GIT_META_BATCH_SMALL_REPO_CHUNK_MAX = 2;
const GIT_META_PREFETCH_CACHE_MAX_ENTRIES_DEFAULT = 8;
const GIT_META_PREFETCH_CACHE_TTL_MS_DEFAULT = 10 * 60 * 1000;
const GIT_META_TIMEOUT_RETRY_MAX_ATTEMPTS_DEFAULT = 3;
const GIT_META_TIMEOUT_COOLDOWN_AFTER_TIMEOUTS_DEFAULT = 2;
const GIT_META_TIMEOUT_COOLDOWN_MS_DEFAULT = 3 * 60 * 1000;
const GIT_META_TIMEOUT_MAX_MS_DEFAULT = 45 * 1000;
const GIT_META_TIMEOUT_HEATMAP_MAX_ENTRIES_DEFAULT = 32;

let gitQueue = null;
let gitQueueConcurrency = null;

export const resolveGitConfig = ({ timeoutState = null } = {}) => {
  const config = getScmRuntimeConfig() || {};
  const runtimeConfig = config.runtime && typeof config.runtime === 'object'
    ? config.runtime
    : {};
  const runtimeThreadFloor = coercePositiveIntMinOne(runtimeConfig.cpuConcurrency)
    || coercePositiveIntMinOne(runtimeConfig.fileConcurrency)
    || 1;
  const explicitMaxConcurrentProcesses = coercePositiveIntMinOne(config.maxConcurrentProcesses);
  const maxConcurrentProcesses = explicitMaxConcurrentProcesses
    || (runtimeThreadFloor > 1 ? runtimeThreadFloor : 8);
  const gitMetaBatchConfig = config.gitMetaBatch && typeof config.gitMetaBatch === 'object'
    ? config.gitMetaBatch
    : {};
  const smallRepoChunkMax = Number.isFinite(Number(gitMetaBatchConfig.smallRepoChunkMax))
    ? Math.max(1, Math.floor(Number(gitMetaBatchConfig.smallRepoChunkMax)))
    : GIT_META_BATCH_SMALL_REPO_CHUNK_MAX;
  const minParallelChunks = Number.isFinite(Number(gitMetaBatchConfig.minParallelChunks))
    ? Math.max(1, Math.floor(Number(gitMetaBatchConfig.minParallelChunks)))
    : runtimeThreadFloor;
  const maxCommitsPerChunk = Number.isFinite(Number(gitMetaBatchConfig.maxCommitsPerChunk))
    ? Math.max(0, Math.floor(Number(gitMetaBatchConfig.maxCommitsPerChunk)))
    : null;
  const prefetchCacheMaxEntries = Number.isFinite(Number(gitMetaBatchConfig.prefetchCacheMaxEntries))
    ? Math.max(0, Math.floor(Number(gitMetaBatchConfig.prefetchCacheMaxEntries)))
    : GIT_META_PREFETCH_CACHE_MAX_ENTRIES_DEFAULT;
  const prefetchCacheTtlMs = Number.isFinite(Number(gitMetaBatchConfig.prefetchCacheTtlMs))
    ? Math.max(1000, Math.floor(Number(gitMetaBatchConfig.prefetchCacheTtlMs)))
    : GIT_META_PREFETCH_CACHE_TTL_MS_DEFAULT;
  const timeoutPolicyConfig = gitMetaBatchConfig.timeoutPolicy && typeof gitMetaBatchConfig.timeoutPolicy === 'object'
    ? gitMetaBatchConfig.timeoutPolicy
    : {};
  const timeoutPolicy = {
    retryMaxAttempts: Number.isFinite(Number(timeoutPolicyConfig.retryMaxAttempts))
      ? Math.max(1, Math.floor(Number(timeoutPolicyConfig.retryMaxAttempts)))
      : GIT_META_TIMEOUT_RETRY_MAX_ATTEMPTS_DEFAULT,
    cooldownAfterTimeouts: Number.isFinite(Number(timeoutPolicyConfig.cooldownAfterTimeouts))
      ? Math.max(1, Math.floor(Number(timeoutPolicyConfig.cooldownAfterTimeouts)))
      : GIT_META_TIMEOUT_COOLDOWN_AFTER_TIMEOUTS_DEFAULT,
    cooldownMs: Number.isFinite(Number(timeoutPolicyConfig.cooldownMs))
      ? Math.max(1000, Math.floor(Number(timeoutPolicyConfig.cooldownMs)))
      : GIT_META_TIMEOUT_COOLDOWN_MS_DEFAULT,
    minTimeoutMs: Number.isFinite(Number(timeoutPolicyConfig.minTimeoutMs))
      ? Math.max(250, Math.floor(Number(timeoutPolicyConfig.minTimeoutMs)))
      : 1500,
    maxTimeoutMs: Number.isFinite(Number(timeoutPolicyConfig.maxTimeoutMs))
      ? Math.max(1000, Math.floor(Number(timeoutPolicyConfig.maxTimeoutMs)))
      : GIT_META_TIMEOUT_MAX_MS_DEFAULT,
    heatmapMaxEntries: Number.isFinite(Number(timeoutPolicyConfig.heatmapMaxEntries))
      ? Math.max(1, Math.floor(Number(timeoutPolicyConfig.heatmapMaxEntries)))
      : GIT_META_TIMEOUT_HEATMAP_MAX_ENTRIES_DEFAULT
  };

  if (timeoutState instanceof Map) {
    const timeoutStateTtlMs = Math.max(timeoutPolicy.cooldownMs * 4, 60 * 1000);
    const now = Date.now();
    for (const [key, entry] of timeoutState) {
      const blockedUntil = Number(entry?.blockedUntil) || 0;
      const updatedAt = Number(entry?.updatedAt) || 0;
      if (blockedUntil > now) continue;
      if (updatedAt > 0 && now - updatedAt <= timeoutStateTtlMs) continue;
      timeoutState.delete(key);
    }
  }

  return {
    explicitMaxConcurrentProcesses,
    maxConcurrentProcesses,
    smallRepoChunkMax,
    minParallelChunks,
    maxCommitsPerChunk,
    prefetchCacheMaxEntries,
    prefetchCacheTtlMs,
    timeoutPolicy
  };
};

const getQueue = (concurrency) => {
  if (!Number.isFinite(concurrency) || concurrency <= 0) return null;
  if (gitQueue && gitQueueConcurrency === concurrency) return gitQueue;
  gitQueueConcurrency = concurrency;
  gitQueue = new PQueue({ concurrency });
  return gitQueue;
};

export const runGitTask = async (task, { useQueue = true, timeoutState = null } = {}) => {
  const config = resolveGitConfig({ timeoutState });
  const queue = useQueue ? getQueue(config.maxConcurrentProcesses) : null;
  return queue ? queue.add(task) : task();
};
