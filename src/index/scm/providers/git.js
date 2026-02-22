import fsSync from 'node:fs';
import path from 'node:path';
import PQueue from 'p-queue';
import {
  getGitLineAuthorsForFile,
  getGitMetaForFile,
  getRepoProvenance
} from '../../git.js';
import { toPosix } from '../../../shared/files.js';
import { findUpwards } from '../../../shared/fs/find-upwards.js';
import { runScmCommand } from '../runner.js';
import { toRepoPosixPath } from '../paths.js';
import { buildScmFreshnessGuard, getScmRuntimeConfig } from '../runtime.js';
import { showProgress } from '../../../shared/progress.js';

const parseNullSeparated = (value) => (
  String(value || '')
    .split('\0')
    .map((entry) => entry)
    .filter(Boolean)
);

const parseLines = (value) => (
  String(value || '')
    .split(/\r?\n/)
    .map((entry) => entry)
    .filter(Boolean)
);

const ensurePosixList = (entries) => (
  entries
    .map((entry) => toPosix(entry))
    .filter(Boolean)
);

const GIT_META_BATCH_FORMAT_PREFIX = '__POC_GIT_META__';
const GIT_META_BATCH_CHUNK_SIZE = 96;
const GIT_META_BATCH_CHUNK_SIZE_LARGE = 48;
const GIT_META_BATCH_CHUNK_SIZE_HUGE = 16;
const GIT_META_BATCH_FILESET_LARGE_MIN = 4000;
const GIT_META_BATCH_FILESET_HUGE_MIN = 8000;
const GIT_META_BATCH_SMALL_REPO_CHUNK_MAX = 2;
const GIT_META_BATCH_COMMIT_LIMIT_DEFAULT = 2000;
const GIT_META_BATCH_COMMIT_LIMIT_HUGE_DEFAULT = 1000;
const GIT_META_PREFETCH_CACHE_MAX_ENTRIES_DEFAULT = 8;
const GIT_META_PREFETCH_CACHE_TTL_MS_DEFAULT = 10 * 60 * 1000;
const GIT_META_TIMEOUT_RETRY_MAX_ATTEMPTS_DEFAULT = 3;
const GIT_META_TIMEOUT_COOLDOWN_AFTER_TIMEOUTS_DEFAULT = 2;
const GIT_META_TIMEOUT_COOLDOWN_MS_DEFAULT = 3 * 60 * 1000;
const GIT_META_TIMEOUT_MAX_MS_DEFAULT = 45 * 1000;
const GIT_META_TIMEOUT_HEATMAP_MAX_ENTRIES_DEFAULT = 32;

const toPositiveIntOrNull = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.max(1, Math.floor(numeric));
};

const toUniquePosixFiles = (filesPosix = [], repoRoot = null) => {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(filesPosix) ? filesPosix : []) {
    const normalized = repoRoot
      ? toRepoPosixPath(raw, repoRoot)
      : toPosix(String(raw || ''));
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

const chunkList = (items, size) => {
  const chunkSize = Number.isFinite(Number(size)) && Number(size) > 0
    ? Math.max(1, Math.floor(Number(size)))
    : 1;
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
};

/**
 * Pick a git-log file batch size based on repository scale.
 *
 * Larger repositories use smaller chunks to reduce tail latency variance
 * between chunks with very different history depth.
 *
 * @param {number} fileCount
 * @returns {number}
 */
const resolveGitMetaBatchChunkSize = (fileCount) => {
  const totalFiles = Number.isFinite(Number(fileCount))
    ? Math.max(0, Math.floor(Number(fileCount)))
    : 0;
  if (totalFiles >= GIT_META_BATCH_FILESET_HUGE_MIN) {
    return GIT_META_BATCH_CHUNK_SIZE_HUGE;
  }
  if (totalFiles >= GIT_META_BATCH_FILESET_LARGE_MIN) {
    return GIT_META_BATCH_CHUNK_SIZE_LARGE;
  }
  return GIT_META_BATCH_CHUNK_SIZE;
};

/**
 * Resolve per-chunk git history depth cap for file-meta batches.
 *
 * Unbounded `git log --name-only` scans can dominate stage1 startup time.
 * We cap scanned commits per chunk by default for all repository sizes and
 * treat unresolved files as "metadata unavailable" (null fields).
 *
 * @param {number} fileCount
 * @param {number|null} configuredLimit
 * @returns {number}
 */
const resolveGitMetaBatchCommitLimit = (fileCount, configuredLimit = null) => {
  const hasConfiguredLimit = configuredLimit !== null && configuredLimit !== undefined;
  if (hasConfiguredLimit && Number.isFinite(Number(configuredLimit))) {
    return Math.max(0, Math.floor(Number(configuredLimit)));
  }
  const totalFiles = Number.isFinite(Number(fileCount))
    ? Math.max(0, Math.floor(Number(fileCount)))
    : 0;
  if (totalFiles >= GIT_META_BATCH_FILESET_HUGE_MIN) {
    return GIT_META_BATCH_COMMIT_LIMIT_HUGE_DEFAULT;
  }
  return GIT_META_BATCH_COMMIT_LIMIT_DEFAULT;
};

/**
 * Execute indexed work items with a strict upper concurrency bound.
 *
 * @template TItem
 * @template TResult
 * @param {TItem[]} items
 * @param {number} concurrency
 * @param {(item:TItem,index:number)=>Promise<TResult>} worker
 * @returns {Promise<TResult[]>}
 */
const runWithBoundedConcurrency = async (items, concurrency, worker) => {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const resolvedConcurrency = Number.isFinite(Number(concurrency)) && Number(concurrency) > 0
    ? Math.max(1, Math.floor(Number(concurrency)))
    : 1;
  const maxWorkers = Math.min(list.length, resolvedConcurrency);
  const out = new Array(list.length);
  let cursor = 0;
  const runWorker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      out[index] = await worker(list[index], index);
    }
  };
  await Promise.all(Array.from({ length: maxWorkers }, () => runWorker()));
  return out;
};

/**
 * Parse batched `git log --name-only` output into per-file metadata.
 *
 * @param {{stdout:string,repoRoot:string}} input
 * @returns {Record<string,{lastCommitId:string|null,lastModifiedAt:string|null,lastAuthor:string|null,churn:null,churnAdded:null,churnDeleted:null,churnCommits:null}>}
 */
const parseGitMetaBatchOutput = ({ stdout, repoRoot }) => {
  const fileMetaByPath = Object.create(null);
  let currentMeta = null;
  for (const row of String(stdout || '').split(/\r?\n/)) {
    const line = String(row || '').trim();
    if (!line) continue;
    if (line.startsWith(GIT_META_BATCH_FORMAT_PREFIX)) {
      const payload = line.slice(GIT_META_BATCH_FORMAT_PREFIX.length);
      const parts = payload.split('\0');
      const hasCommitPrefix = parts.length >= 3 && /^[0-9a-f]{7,64}$/i.test(String(parts[0] || '').trim());
      const lastCommitIdRaw = hasCommitPrefix ? parts[0] : null;
      const lastModifiedAtRaw = hasCommitPrefix ? parts[1] : parts[0];
      const authorParts = hasCommitPrefix ? parts.slice(2) : parts.slice(1);
      const lastCommitId = String(lastCommitIdRaw || '').trim().toLowerCase() || null;
      const lastModifiedAt = String(lastModifiedAtRaw || '').trim() || null;
      const lastAuthor = authorParts.join('\0').trim() || null;
      currentMeta = { lastCommitId, lastModifiedAt, lastAuthor };
      continue;
    }
    if (!currentMeta) continue;
    const fileKey = toRepoPosixPath(line, repoRoot);
    if (!fileKey || fileMetaByPath[fileKey]) continue;
    fileMetaByPath[fileKey] = {
      lastCommitId: currentMeta.lastCommitId,
      lastModifiedAt: currentMeta.lastModifiedAt,
      lastAuthor: currentMeta.lastAuthor,
      churn: null,
      churnAdded: null,
      churnDeleted: null,
      churnCommits: null
    };
  }
  return fileMetaByPath;
};

const createUnavailableFileMeta = () => ({
  lastCommitId: null,
  lastModifiedAt: null,
  lastAuthor: null,
  churn: null,
  churnAdded: null,
  churnDeleted: null,
  churnCommits: null
});

const normalizeFileMeta = (value) => ({
  lastCommitId: typeof value?.lastCommitId === 'string' ? value.lastCommitId : null,
  lastModifiedAt: typeof value?.lastModifiedAt === 'string' ? value.lastModifiedAt : null,
  lastAuthor: typeof value?.lastAuthor === 'string' ? value.lastAuthor : null,
  churn: Number.isFinite(Number(value?.churn)) ? Number(value.churn) : null,
  churnAdded: Number.isFinite(Number(value?.churnAdded)) ? Number(value.churnAdded) : null,
  churnDeleted: Number.isFinite(Number(value?.churnDeleted)) ? Number(value.churnDeleted) : null,
  churnCommits: Number.isFinite(Number(value?.churnCommits)) ? Number(value.churnCommits) : null
});

const hasMetaIdentity = (meta) => Boolean(
  meta
  && (
    typeof meta.lastCommitId === 'string'
    || typeof meta.lastModifiedAt === 'string'
    || typeof meta.lastAuthor === 'string'
  )
);

const normalizeRepoRootKey = (repoRoot) => {
  const resolved = path.resolve(String(repoRoot || process.cwd()));
  return process.platform === 'win32'
    ? resolved.toLowerCase()
    : resolved;
};

const buildMetaPathScopeKey = (repoRoot, filePosix) => (
  `${normalizeRepoRootKey(repoRoot)}::${toPosix(filePosix)}`
);

const toFailureMessage = (value, maxLength = 220) => {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...`
    : normalized;
};

const toFailureCode = (value) => {
  const code = String(value || '').trim().toUpperCase();
  return code || null;
};

const isTimeoutLikeFailure = ({ code, message }) => (
  code === 'SUBPROCESS_TIMEOUT'
  || code === 'ABORT_ERR'
  || /timed?\s*out/i.test(String(message || ''))
);

const isFatalUnavailableFailure = ({ code, message }) => {
  const lower = String(message || '').toLowerCase();
  return code === 'ENOENT'
    || lower.includes('not a git repository')
    || lower.includes('git metadata unavailable')
    || lower.includes('is not recognized as an internal or external command')
    || lower.includes('spawn git');
};

const createGitMetaBatchFailure = ({ err = null, result = null } = {}) => {
  const code = toFailureCode(
    err?.code
    || err?.cause?.code
    || (result?.exitCode != null ? `GIT_EXIT_${result.exitCode}` : '')
  );
  const message = toFailureMessage(
    err?.message
    || err?.cause?.message
    || result?.stderr
    || result?.stdout
    || ''
  );
  const timeoutLike = isTimeoutLikeFailure({ code, message });
  const fatalUnavailable = isFatalUnavailableFailure({ code, message });
  return {
    code,
    message: message || null,
    timeoutLike,
    fatalUnavailable
  };
};

const resolveFileSizeBytes = (repoRoot, filePosix) => {
  try {
    const absPath = path.join(repoRoot, filePosix);
    const stat = fsSync.statSync(absPath);
    const size = Number(stat?.size);
    return Number.isFinite(size) && size > 0 ? size : 0;
  } catch {
    return 0;
  }
};

const resolveChunkCost = ({ repoRoot, chunk, timeoutState }) => {
  let maxBytes = 0;
  let totalBytes = 0;
  let count = 0;
  let maxTimeouts = 0;
  for (const filePosix of Array.isArray(chunk) ? chunk : []) {
    const normalized = toPosix(filePosix);
    if (!normalized) continue;
    const bytes = resolveFileSizeBytes(repoRoot, normalized);
    maxBytes = Math.max(maxBytes, bytes);
    totalBytes += bytes;
    count += 1;
    const bucket = timeoutState.get(buildMetaPathScopeKey(repoRoot, normalized));
    const pathTimeouts = Number.isFinite(Number(bucket?.timeouts))
      ? Math.max(0, Math.floor(Number(bucket.timeouts)))
      : 0;
    maxTimeouts = Math.max(maxTimeouts, pathTimeouts);
  }
  const avgBytes = count > 0 ? Math.floor(totalBytes / count) : 0;
  const sizeTier = maxBytes >= 2 * 1024 * 1024
    ? 3
    : maxBytes >= 512 * 1024
      ? 2
      : maxBytes >= 128 * 1024
        ? 1
        : 0;
  const multiplier = Math.max(
    1,
    Math.min(
      4,
      1 + (sizeTier * 0.35) + Math.min(1.2, maxTimeouts * 0.2)
    )
  );
  return {
    maxBytes,
    avgBytes,
    sizeTier,
    maxTimeouts,
    multiplier
  };
};

const resolveTimeoutPlan = ({
  baseTimeoutMs,
  timeoutPolicy,
  chunkCost
}) => {
  const minTimeoutMs = Math.max(500, Math.floor(timeoutPolicy?.minTimeoutMs || 500));
  const maxTimeoutMs = Math.max(minTimeoutMs, Math.floor(timeoutPolicy?.maxTimeoutMs || GIT_META_TIMEOUT_MAX_MS_DEFAULT));
  const base = Number.isFinite(Number(baseTimeoutMs)) && Number(baseTimeoutMs) > 0
    ? Math.max(minTimeoutMs, Math.floor(Number(baseTimeoutMs)))
    : Math.max(minTimeoutMs, 15000);
  const target = Math.max(
    minTimeoutMs,
    Math.min(maxTimeoutMs, Math.floor(base * (chunkCost?.multiplier || 1)))
  );
  const attemptCap = Number.isFinite(Number(timeoutPolicy?.retryMaxAttempts))
    ? Math.max(1, Math.floor(Number(timeoutPolicy.retryMaxAttempts)))
    : GIT_META_TIMEOUT_RETRY_MAX_ATTEMPTS_DEFAULT;
  const adaptiveAttempts = 1 + Math.max(0, chunkCost?.sizeTier || 0) + Math.min(2, Math.max(0, chunkCost?.maxTimeouts || 0));
  const attempts = Math.max(1, Math.min(attemptCap, adaptiveAttempts));
  const ladder = [];
  for (let i = 0; i < attempts; i += 1) {
    const ratio = attempts <= 1 ? 1 : (0.6 + ((i / (attempts - 1)) * 0.4));
    const value = Math.max(minTimeoutMs, Math.min(maxTimeoutMs, Math.floor(target * ratio)));
    if (!ladder.includes(value)) ladder.push(value);
  }
  if (!ladder.length) ladder.push(target);
  return ladder;
};

const createBatchDiagnostics = () => ({
  timeoutCount: 0,
  timeoutRetries: 0,
  cooldownSkips: 0,
  unavailableChunks: 0,
  timeoutHeatmap: []
});

const registerHeatEntry = (heatByPath, filePosix, patch = {}) => {
  const key = toPosix(filePosix);
  if (!key) return;
  const entry = heatByPath.get(key) || {
    file: key,
    timeouts: 0,
    retries: 0,
    cooldownSkips: 0,
    lastTimeoutMs: null
  };
  if (patch.timeout === true) {
    entry.timeouts += 1;
    if (Number.isFinite(Number(patch.timeoutMs)) && Number(patch.timeoutMs) > 0) {
      entry.lastTimeoutMs = Math.floor(Number(patch.timeoutMs));
    }
  }
  if (patch.retry === true) entry.retries += 1;
  if (patch.cooldownSkip === true) entry.cooldownSkips += 1;
  heatByPath.set(key, entry);
};

let gitQueue = null;
let gitQueueConcurrency = null;
let gitMetaPrefetchCache = new Map();
let gitMetaPrefetchInFlight = new Map();
let gitMetaTimeoutState = new Map();

const resolveGitConfig = () => {
  const config = getScmRuntimeConfig() || {};
  const runtimeConfig = config.runtime && typeof config.runtime === 'object'
    ? config.runtime
    : {};
  const runtimeThreadFloor = toPositiveIntOrNull(runtimeConfig.cpuConcurrency)
    || toPositiveIntOrNull(runtimeConfig.fileConcurrency)
    || 1;
  const explicitMaxConcurrentProcesses = toPositiveIntOrNull(config.maxConcurrentProcesses);
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
  const timeoutStateTtlMs = Math.max(timeoutPolicy.cooldownMs * 4, 60 * 1000);
  const now = Date.now();
  for (const [key, entry] of gitMetaTimeoutState) {
    const blockedUntil = Number(entry?.blockedUntil) || 0;
    const updatedAt = Number(entry?.updatedAt) || 0;
    if (blockedUntil > now) continue;
    if (updatedAt > 0 && now - updatedAt <= timeoutStateTtlMs) continue;
    gitMetaTimeoutState.delete(key);
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

const runGitTask = async (task, { useQueue = true } = {}) => {
  const config = resolveGitConfig();
  const queue = useQueue ? getQueue(config.maxConcurrentProcesses) : null;
  return queue ? queue.add(task) : task();
};

const pruneGitMetaPrefetchCache = (config) => {
  if (!config || config.prefetchCacheMaxEntries <= 0) {
    gitMetaPrefetchCache.clear();
    gitMetaPrefetchInFlight.clear();
    return;
  }
  const ttlMs = Number.isFinite(Number(config.prefetchCacheTtlMs)) && Number(config.prefetchCacheTtlMs) > 0
    ? Math.floor(Number(config.prefetchCacheTtlMs))
    : 0;
  if (ttlMs > 0) {
    const now = Date.now();
    for (const [key, entry] of gitMetaPrefetchCache) {
      const updatedAt = Number(entry?.updatedAt) || 0;
      if (updatedAt > 0 && now - updatedAt <= ttlMs) continue;
      gitMetaPrefetchCache.delete(key);
      gitMetaPrefetchInFlight.delete(key);
    }
  }
  while (gitMetaPrefetchCache.size > config.prefetchCacheMaxEntries) {
    const oldestKey = gitMetaPrefetchCache.keys().next()?.value;
    if (!oldestKey) break;
    gitMetaPrefetchCache.delete(oldestKey);
    gitMetaPrefetchInFlight.delete(oldestKey);
  }
};

const getGitMetaPrefetchEntry = (freshnessGuard, config) => {
  const key = freshnessGuard?.key || null;
  if (!key) return null;
  pruneGitMetaPrefetchCache(config);
  const entry = gitMetaPrefetchCache.get(key);
  if (!entry) return null;
  entry.updatedAt = Date.now();
  gitMetaPrefetchCache.delete(key);
  gitMetaPrefetchCache.set(key, entry);
  return entry;
};

const createGitMetaPrefetchEntry = (freshnessGuard) => ({
  key: freshnessGuard?.key || null,
  guard: freshnessGuard ? { ...freshnessGuard } : null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  fileMetaByPath: Object.create(null),
  knownFiles: new Set()
});

const setGitMetaPrefetchEntry = (freshnessGuard, entry, config) => {
  const key = freshnessGuard?.key || null;
  if (!key || !entry || config.prefetchCacheMaxEntries <= 0) return;
  entry.updatedAt = Date.now();
  gitMetaPrefetchCache.set(key, entry);
  pruneGitMetaPrefetchCache(config);
};

const runGitMetaPrefetchTask = async (freshnessGuard, task) => {
  const key = freshnessGuard?.key || null;
  if (!key) return task();
  const inFlight = gitMetaPrefetchInFlight.get(key);
  if (inFlight) return inFlight;
  const promise = (async () => {
    try {
      return await task();
    } finally {
      gitMetaPrefetchInFlight.delete(key);
    }
  })();
  gitMetaPrefetchInFlight.set(key, promise);
  return promise;
};

const mergeGitMetaPrefetchEntry = ({ entry, filesPosix, fileMetaByPath }) => {
  if (!entry) return;
  for (const filePosix of Array.isArray(filesPosix) ? filesPosix : []) {
    const normalized = toPosix(filePosix);
    if (!normalized) continue;
    const meta = fileMetaByPath && typeof fileMetaByPath === 'object' && fileMetaByPath[normalized]
      ? normalizeFileMeta(fileMetaByPath[normalized])
      : createUnavailableFileMeta();
    entry.fileMetaByPath[normalized] = meta;
    entry.knownFiles.add(normalized);
  }
  entry.updatedAt = Date.now();
};

const upsertGitMetaPrefetch = ({ freshnessGuard, config, filesPosix, fileMetaByPath }) => {
  const key = freshnessGuard?.key || null;
  if (!key || config.prefetchCacheMaxEntries <= 0) return null;
  const entry = getGitMetaPrefetchEntry(freshnessGuard, config) || createGitMetaPrefetchEntry(freshnessGuard);
  mergeGitMetaPrefetchEntry({ entry, filesPosix, fileMetaByPath });
  setGitMetaPrefetchEntry(freshnessGuard, entry, config);
  return entry;
};

const readGitMetaPrefetchValue = ({ freshnessGuard, config, filePosix }) => {
  const entry = getGitMetaPrefetchEntry(freshnessGuard, config);
  if (!entry?.knownFiles?.has(filePosix)) return null;
  const meta = normalizeFileMeta(entry.fileMetaByPath[filePosix] || null);
  return hasMetaIdentity(meta)
    ? meta
    : { ok: false, reason: 'unavailable' };
};

const buildGitMetaBatchResponseFromEntry = ({ entry, filesPosix, diagnostics = null }) => {
  const fileMetaByPath = Object.create(null);
  for (const filePosix of filesPosix) {
    const cached = entry?.fileMetaByPath?.[filePosix];
    fileMetaByPath[filePosix] = cached
      ? normalizeFileMeta(cached)
      : createUnavailableFileMeta();
  }
  return diagnostics
    ? { fileMetaByPath, diagnostics }
    : { fileMetaByPath };
};

const runGitMetaBatchFetch = async ({ repoRoot, filesPosix, timeoutMs, config }) => {
  const normalizedFiles = toUniquePosixFiles(filesPosix, repoRoot);
  const diagnostics = createBatchDiagnostics();
  if (!normalizedFiles.length) {
    return {
      ok: true,
      fileMetaByPath: Object.create(null),
      diagnostics
    };
  }
  const timeoutPolicy = config.timeoutPolicy || {};
  const fileMetaByPath = Object.create(null);
  const heatByPath = new Map();
  const now = Date.now();
  const activeFiles = [];
  for (const filePosix of normalizedFiles) {
    const pathKey = buildMetaPathScopeKey(repoRoot, filePosix);
    const bucket = gitMetaTimeoutState.get(pathKey);
    const blockedUntil = Number(bucket?.blockedUntil) || 0;
    if (blockedUntil > now) {
      fileMetaByPath[filePosix] = createUnavailableFileMeta();
      diagnostics.cooldownSkips += 1;
      registerHeatEntry(heatByPath, filePosix, { cooldownSkip: true });
      continue;
    }
    if (bucket && blockedUntil > 0 && blockedUntil <= now) {
      gitMetaTimeoutState.delete(pathKey);
    }
    activeFiles.push(filePosix);
  }

  const markTimeout = (filePosix, timeoutMsForAttempt = null) => {
    const key = buildMetaPathScopeKey(repoRoot, filePosix);
    const existing = gitMetaTimeoutState.get(key) || {
      timeouts: 0,
      blockedUntil: 0,
      updatedAt: 0
    };
    const timeoutCount = Math.max(0, existing.timeouts) + 1;
    const blockedUntil = timeoutCount >= timeoutPolicy.cooldownAfterTimeouts
      ? Date.now() + timeoutPolicy.cooldownMs
      : 0;
    gitMetaTimeoutState.set(key, {
      ...existing,
      timeouts: timeoutCount,
      blockedUntil,
      updatedAt: Date.now()
    });
    registerHeatEntry(heatByPath, filePosix, {
      timeout: true,
      timeoutMs: timeoutMsForAttempt
    });
  };

  const clearTimeoutState = (filePosix) => {
    const key = buildMetaPathScopeKey(repoRoot, filePosix);
    gitMetaTimeoutState.delete(key);
  };

  if (!activeFiles.length) {
    diagnostics.timeoutHeatmap = Array.from(heatByPath.values());
    return {
      ok: true,
      fileMetaByPath,
      diagnostics
    };
  }

  const batchChunkSize = resolveGitMetaBatchChunkSize(activeFiles.length);
  const batchCommitLimit = resolveGitMetaBatchCommitLimit(
    activeFiles.length,
    config.maxCommitsPerChunk
  );
  const chunks = chunkList(activeFiles, batchChunkSize);
  const resolvedTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.max(timeoutPolicy.minTimeoutMs, Math.floor(Number(timeoutMs)))
    : 15000;
  const forceSequential = chunks.length <= config.smallRepoChunkMax;
  const batchConcurrencyCap = config.explicitMaxConcurrentProcesses
    ? config.maxConcurrentProcesses
    : Math.max(config.maxConcurrentProcesses, config.minParallelChunks);
  const batchConcurrency = forceSequential
    ? 1
    : Math.max(
      1,
      Math.min(
        chunks.length,
        batchConcurrencyCap
      )
    );
  const shouldEmitProgress = chunks.length > 1;
  const baseProgressMeta = {
    taskId: 'scm:git:file-meta-batch',
    stage: 'scm',
    unit: 'chunks',
    ephemeral: true
  };
  if (shouldEmitProgress) {
    showProgress('SCM Meta', 0, chunks.length, baseProgressMeta);
  }
  let completedChunks = 0;
  const chunkResults = await runWithBoundedConcurrency(chunks, batchConcurrency, async (chunk) => {
    try {
      const chunkCost = resolveChunkCost({
        repoRoot,
        chunk,
        timeoutState: gitMetaTimeoutState
      });
      const timeoutPlan = resolveTimeoutPlan({
        baseTimeoutMs: resolvedTimeoutMs,
        timeoutPolicy,
        chunkCost
      });
      let parsedMetaByPath = null;
      let failure = null;
      for (let attemptIndex = 0; attemptIndex < timeoutPlan.length; attemptIndex += 1) {
        const attemptTimeoutMs = timeoutPlan[attemptIndex];
        const args = [
          '-C',
          repoRoot,
          'log',
          '--date=iso-strict',
          `--format=${GIT_META_BATCH_FORMAT_PREFIX}%H%x00%aI%x00%an`,
          '--name-only'
        ];
        if (batchCommitLimit > 0) {
          args.push('-n', String(batchCommitLimit));
        }
        args.push('--', ...chunk);
        let result = null;
        try {
          result = await runGitTask(() => runScmCommand('git', args, {
            outputMode: 'string',
            captureStdout: true,
            captureStderr: true,
            rejectOnNonZeroExit: false,
            timeoutMs: attemptTimeoutMs
          }), { useQueue: config.maxConcurrentProcesses > 1 });
        } catch (err) {
          failure = createGitMetaBatchFailure({ err });
          if (failure.timeoutLike) {
            diagnostics.timeoutCount += 1;
            for (const filePosix of chunk) {
              markTimeout(filePosix, attemptTimeoutMs);
            }
          }
          const canRetry = failure.timeoutLike && attemptIndex < timeoutPlan.length - 1;
          if (canRetry) {
            diagnostics.timeoutRetries += 1;
            for (const filePosix of chunk) {
              registerHeatEntry(heatByPath, filePosix, { retry: true });
            }
            continue;
          }
          break;
        }
        if (result?.exitCode === 0) {
          parsedMetaByPath = parseGitMetaBatchOutput({ stdout: result.stdout, repoRoot });
          for (const filePosix of chunk) {
            clearTimeoutState(filePosix);
          }
          failure = null;
          break;
        }
        failure = createGitMetaBatchFailure({ result });
        if (failure.timeoutLike) {
          diagnostics.timeoutCount += 1;
          for (const filePosix of chunk) {
            markTimeout(filePosix, attemptTimeoutMs);
          }
        }
        const canRetry = failure.timeoutLike && attemptIndex < timeoutPlan.length - 1;
        if (canRetry) {
          diagnostics.timeoutRetries += 1;
          for (const filePosix of chunk) {
            registerHeatEntry(heatByPath, filePosix, { retry: true });
          }
          continue;
        }
        break;
      }
      if (parsedMetaByPath) {
        for (const filePosix of chunk) {
          if (parsedMetaByPath[filePosix]) continue;
          parsedMetaByPath[filePosix] = createUnavailableFileMeta();
        }
        return { ok: true, fileMetaByPath: parsedMetaByPath };
      }
      diagnostics.unavailableChunks += 1;
      if (failure && (failure.fatalUnavailable || !failure.timeoutLike)) {
        return { ok: false, fatal: true, reason: failure.message || 'unavailable' };
      }
      const unavailableMetaByPath = Object.create(null);
      for (const filePosix of chunk) {
        unavailableMetaByPath[filePosix] = createUnavailableFileMeta();
      }
      return {
        ok: true,
        fileMetaByPath: unavailableMetaByPath
      };
    } finally {
      completedChunks += 1;
      if (shouldEmitProgress) {
        showProgress('SCM Meta', completedChunks, chunks.length, baseProgressMeta);
      }
    }
  });

  for (const chunkResult of chunkResults) {
    if (chunkResult?.fatal) {
      return {
        ok: false,
        reason: 'unavailable',
        diagnostics
      };
    }
    if (!chunkResult?.ok) continue;
    const chunkMeta = chunkResult.fileMetaByPath || {};
    for (const [fileKey, meta] of Object.entries(chunkMeta)) {
      if (!fileKey || fileMetaByPath[fileKey]) continue;
      fileMetaByPath[fileKey] = normalizeFileMeta(meta);
    }
  }
  for (const filePosix of normalizedFiles) {
    if (fileMetaByPath[filePosix]) continue;
    fileMetaByPath[filePosix] = createUnavailableFileMeta();
  }
  diagnostics.timeoutHeatmap = Array.from(heatByPath.values())
    .filter((entry) => (entry.timeouts > 0 || entry.cooldownSkips > 0))
    .sort((left, right) => (
      (right.timeouts - left.timeouts)
      || (right.cooldownSkips - left.cooldownSkips)
      || left.file.localeCompare(right.file)
    ))
    .slice(0, timeoutPolicy.heatmapMaxEntries);
  if (diagnostics.timeoutHeatmap.length) {
    const heatLabel = diagnostics.timeoutHeatmap
      .slice(0, 3)
      .map((entry) => `${entry.file}:${entry.timeouts}t/${entry.cooldownSkips}c`)
      .join(', ');
    showProgress(
      'SCM Meta',
      shouldEmitProgress ? chunks.length : 1,
      shouldEmitProgress ? chunks.length : 1,
      {
        ...baseProgressMeta,
        message: `timeouts=${diagnostics.timeoutCount} retries=${diagnostics.timeoutRetries} cooldownSkips=${diagnostics.cooldownSkips} heatmap=${heatLabel}`
      }
    );
  }
  return {
    ok: true,
    fileMetaByPath,
    diagnostics
  };
};

const GIT_METADATA_CAPABILITIES = Object.freeze({
  author: true,
  time: true,
  branch: true,
  churn: true,
  commitId: true,
  changeId: false,
  operationId: false,
  bookmarks: false,
  annotateCommitId: false
});

export const gitProvider = {
  name: 'git',
  adapter: 'parity',
  metadataCapabilities: GIT_METADATA_CAPABILITIES,
  detect({ startPath }) {
    const repoRoot = findGitRoot(startPath || process.cwd());
    return repoRoot ? { ok: true, provider: 'git', repoRoot, detectedBy: 'git-root' } : { ok: false };
  },
  async listTrackedFiles({ repoRoot, subdir = null }) {
    const args = ['-C', repoRoot, 'ls-files', '-z'];
    const scoped = subdir ? toRepoPosixPath(subdir, repoRoot) : null;
    if (scoped) args.push('--', scoped);
    const result = await runGitTask(() => runScmCommand('git', args, {
      outputMode: 'string',
      captureStdout: true,
      captureStderr: true,
      rejectOnNonZeroExit: false
    }));
    if (result.exitCode !== 0) {
      return { ok: false, reason: 'unavailable' };
    }
    const entries = ensurePosixList(parseNullSeparated(result.stdout))
      .map((entry) => toRepoPosixPath(entry, repoRoot))
      .filter(Boolean)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return { filesPosix: entries };
  },
  async getRepoProvenance({ repoRoot }) {
    const repoProvenance = await getRepoProvenance(repoRoot);
    const commitId = repoProvenance?.commit || null;
    const branch = repoProvenance?.branch || null;
    return {
      provider: 'git',
      root: repoRoot,
      head: {
        commitId,
        branch
      },
      dirty: repoProvenance?.dirty ?? null,
      detectedBy: 'git-root',
      commit: commitId,
      branch,
      isRepo: repoProvenance?.isRepo ?? null
    };
  },
  async getChangedFiles({ repoRoot, fromRef = null, toRef = null, subdir = null }) {
    const args = ['-C', repoRoot, 'diff', '--name-only'];
    if (fromRef && toRef) {
      args.push(fromRef, toRef);
    } else if (fromRef) {
      args.push(fromRef);
    } else if (toRef) {
      args.push(toRef);
    }
    const scoped = subdir ? toRepoPosixPath(subdir, repoRoot) : null;
    if (scoped) args.push('--', scoped);
    const result = await runGitTask(() => runScmCommand('git', args, {
      outputMode: 'string',
      captureStdout: true,
      captureStderr: true,
      rejectOnNonZeroExit: false
    }));
    if (result.exitCode !== 0) {
      return { ok: false, reason: 'unavailable' };
    }
    const entries = ensurePosixList(parseLines(result.stdout))
      .map((entry) => toRepoPosixPath(entry, repoRoot))
      .filter(Boolean)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return { filesPosix: entries };
  },
  async getFileMeta({ repoRoot, filePosix, timeoutMs, includeChurn = true, headId = null }) {
    const config = resolveGitConfig();
    const normalizedFilePosix = toRepoPosixPath(filePosix, repoRoot);
    if (!normalizedFilePosix) {
      return { ok: false, reason: 'unavailable' };
    }
    const freshnessGuard = buildScmFreshnessGuard({
      provider: 'git',
      repoRoot,
      repoHeadId: headId
    });
    const cachedMeta = readGitMetaPrefetchValue({
      freshnessGuard,
      config,
      filePosix: normalizedFilePosix
    });
    if (cachedMeta) {
      return cachedMeta;
    }
    const absPath = path.join(repoRoot, normalizedFilePosix);
    const meta = await runGitTask(() => getGitMetaForFile(absPath, {
      blame: false,
      baseDir: repoRoot,
      timeoutMs,
      includeChurn
    }));
    if (!meta || !meta.last_modified) {
      upsertGitMetaPrefetch({
        freshnessGuard,
        config,
        filesPosix: [normalizedFilePosix],
        fileMetaByPath: { [normalizedFilePosix]: createUnavailableFileMeta() }
      });
      return { ok: false, reason: 'unavailable' };
    }
    const normalizedMeta = {
      lastCommitId: typeof meta.last_commit === 'string' ? meta.last_commit : null,
      lastModifiedAt: meta.last_modified || null,
      lastAuthor: meta.last_author || null,
      churn: Number.isFinite(meta.churn) ? meta.churn : null,
      churnAdded: Number.isFinite(meta.churn_added) ? meta.churn_added : null,
      churnDeleted: Number.isFinite(meta.churn_deleted) ? meta.churn_deleted : null,
      churnCommits: Number.isFinite(meta.churn_commits) ? meta.churn_commits : null
    };
    upsertGitMetaPrefetch({
      freshnessGuard,
      config,
      filesPosix: [normalizedFilePosix],
      fileMetaByPath: { [normalizedFilePosix]: normalizedMeta }
    });
    return normalizedMeta;
  },
  async getFileMetaBatch({ repoRoot, filesPosix, timeoutMs, includeChurn = false, headId = null }) {
    const config = resolveGitConfig();
    const normalizedFiles = toUniquePosixFiles(filesPosix, repoRoot);
    if (!normalizedFiles.length) {
      return { fileMetaByPath: Object.create(null) };
    }
    const freshnessGuard = buildScmFreshnessGuard({
      provider: 'git',
      repoRoot,
      repoHeadId: headId
    });
    const canUsePrefetchCache = Boolean(freshnessGuard.key && config.prefetchCacheMaxEntries > 0);
    if (canUsePrefetchCache) {
      const cachedEntry = getGitMetaPrefetchEntry(freshnessGuard, config);
      const missing = cachedEntry
        ? normalizedFiles.filter((filePosix) => !cachedEntry.knownFiles.has(filePosix))
        : normalizedFiles;
      if (!missing.length) {
        return buildGitMetaBatchResponseFromEntry({ entry: cachedEntry, filesPosix: normalizedFiles });
      }
      const hydratedResult = await runGitMetaPrefetchTask(freshnessGuard, async () => {
        const reusableEntry = getGitMetaPrefetchEntry(freshnessGuard, config)
          || createGitMetaPrefetchEntry(freshnessGuard);
        const unresolvedFiles = normalizedFiles.filter((filePosix) => !reusableEntry.knownFiles.has(filePosix));
        if (!unresolvedFiles.length) {
          return {
            entry: reusableEntry,
            diagnostics: createBatchDiagnostics()
          };
        }
        const fetched = await runGitMetaBatchFetch({
          repoRoot,
          filesPosix: unresolvedFiles,
          timeoutMs,
          config
        });
        if (!fetched.ok) return null;
        mergeGitMetaPrefetchEntry({
          entry: reusableEntry,
          filesPosix: unresolvedFiles,
          fileMetaByPath: fetched.fileMetaByPath
        });
        setGitMetaPrefetchEntry(freshnessGuard, reusableEntry, config);
        return {
          entry: reusableEntry,
          diagnostics: fetched.diagnostics || createBatchDiagnostics()
        };
      });
      if (!hydratedResult?.entry) {
        return { ok: false, reason: 'unavailable' };
      }
      return buildGitMetaBatchResponseFromEntry({
        entry: hydratedResult.entry,
        filesPosix: normalizedFiles,
        diagnostics: hydratedResult.diagnostics || null
      });
    }
    const fetched = await runGitMetaBatchFetch({
      repoRoot,
      filesPosix: normalizedFiles,
      timeoutMs,
      config
    });
    if (!fetched.ok) {
      return { ok: false, reason: 'unavailable' };
    }
    return {
      fileMetaByPath: fetched.fileMetaByPath,
      diagnostics: fetched.diagnostics || null
    };
  },
  async annotate({ repoRoot, filePosix, timeoutMs, signal, commitId = null }) {
    const absPath = path.join(repoRoot, filePosix);
    const lineAuthors = await runGitTask(() => getGitLineAuthorsForFile(absPath, {
      baseDir: repoRoot,
      timeoutMs,
      signal,
      commitId
    }));
    if (!Array.isArray(lineAuthors)) {
      return { ok: false, reason: 'unavailable' };
    }
    const lines = lineAuthors.map((author, index) => ({
      line: index + 1,
      author: author || 'unknown'
    }));
    return { lines };
  }
};

const findGitRoot = (startPath) => {
  return findUpwards(
    startPath || process.cwd(),
    (candidateDir) => fsExists(path.join(candidateDir, '.git'))
  );
};

const fsExists = (value) => {
  try {
    return Boolean(value) && fsSync.existsSync(value);
  } catch {
    return false;
  }
};
