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

let gitQueue = null;
let gitQueueConcurrency = null;
let gitMetaPrefetchCache = new Map();
let gitMetaPrefetchInFlight = new Map();

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
  return {
    explicitMaxConcurrentProcesses,
    maxConcurrentProcesses,
    smallRepoChunkMax,
    minParallelChunks,
    maxCommitsPerChunk,
    prefetchCacheMaxEntries,
    prefetchCacheTtlMs
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

const buildGitMetaBatchResponseFromEntry = ({ entry, filesPosix }) => {
  const fileMetaByPath = Object.create(null);
  for (const filePosix of filesPosix) {
    const cached = entry?.fileMetaByPath?.[filePosix];
    fileMetaByPath[filePosix] = cached
      ? normalizeFileMeta(cached)
      : createUnavailableFileMeta();
  }
  return { fileMetaByPath };
};

const runGitMetaBatchFetch = async ({ repoRoot, filesPosix, timeoutMs, config }) => {
  const normalizedFiles = toUniquePosixFiles(filesPosix, repoRoot);
  if (!normalizedFiles.length) {
    return { ok: true, fileMetaByPath: Object.create(null) };
  }
  const fileMetaByPath = Object.create(null);
  const batchChunkSize = resolveGitMetaBatchChunkSize(normalizedFiles.length);
  const batchCommitLimit = resolveGitMetaBatchCommitLimit(
    normalizedFiles.length,
    config.maxCommitsPerChunk
  );
  const chunks = chunkList(normalizedFiles, batchChunkSize);
  const resolvedTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.max(5000, Math.floor(Number(timeoutMs)))
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
    const result = await runGitTask(() => runScmCommand('git', args, {
      outputMode: 'string',
      captureStdout: true,
      captureStderr: true,
      rejectOnNonZeroExit: false,
      timeoutMs: resolvedTimeoutMs
    }), { useQueue: config.maxConcurrentProcesses > 1 });
    if (result.exitCode !== 0) {
      return { ok: false, reason: 'unavailable' };
    }
    completedChunks += 1;
    if (shouldEmitProgress) {
      showProgress('SCM Meta', completedChunks, chunks.length, baseProgressMeta);
    }
    const chunkMetaByPath = parseGitMetaBatchOutput({ stdout: result.stdout, repoRoot });
    for (const filePosix of chunk) {
      if (chunkMetaByPath[filePosix]) continue;
      chunkMetaByPath[filePosix] = createUnavailableFileMeta();
    }
    return {
      ok: true,
      fileMetaByPath: chunkMetaByPath
    };
  });
  for (const chunkResult of chunkResults) {
    if (!chunkResult?.ok) {
      return { ok: false, reason: 'unavailable' };
    }
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
  return { ok: true, fileMetaByPath };
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
      const hydratedEntry = await runGitMetaPrefetchTask(freshnessGuard, async () => {
        const reusableEntry = getGitMetaPrefetchEntry(freshnessGuard, config)
          || createGitMetaPrefetchEntry(freshnessGuard);
        const unresolvedFiles = normalizedFiles.filter((filePosix) => !reusableEntry.knownFiles.has(filePosix));
        if (!unresolvedFiles.length) return reusableEntry;
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
        return reusableEntry;
      });
      if (!hydratedEntry) {
        return { ok: false, reason: 'unavailable' };
      }
      return buildGitMetaBatchResponseFromEntry({ entry: hydratedEntry, filesPosix: normalizedFiles });
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
    return { fileMetaByPath: fetched.fileMetaByPath };
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
