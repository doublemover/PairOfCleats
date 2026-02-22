import path from 'node:path';
import PQueue from 'p-queue';
import { toPosix, readJsonFileSafe } from '../../shared/files.js';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import { buildScmFreshnessGuard, getScmRuntimeConfigEpoch } from './runtime.js';

const SCM_FILE_META_SNAPSHOT_SCHEMA_VERSION = 1;
const SCM_FILE_META_SNAPSHOT_NAME = 'file-meta-v1.json';

const normalizeRepoRoot = (value) => {
  if (!value || typeof value !== 'string') return null;
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const normalizeFileKey = (value) => {
  const normalized = toPosix(String(value || ''))
    .replace(/^\.\/+/, '')
    .trim();
  if (!normalized || normalized.startsWith('../')) return null;
  return normalized;
};

const normalizeMeta = (value) => ({
  lastCommitId: typeof value?.lastCommitId === 'string' ? value.lastCommitId : null,
  lastModifiedAt: typeof value?.lastModifiedAt === 'string' ? value.lastModifiedAt : null,
  lastAuthor: typeof value?.lastAuthor === 'string' ? value.lastAuthor : null,
  churn: Number.isFinite(Number(value?.churn)) ? Number(value.churn) : null,
  churnAdded: Number.isFinite(Number(value?.churnAdded)) ? Number(value.churnAdded) : null,
  churnDeleted: Number.isFinite(Number(value?.churnDeleted)) ? Number(value.churnDeleted) : null,
  churnCommits: Number.isFinite(Number(value?.churnCommits)) ? Number(value.churnCommits) : null
});

const normalizeFileMetaMap = (input) => {
  const fileMetaByPath = Object.create(null);
  if (!input || typeof input !== 'object') return fileMetaByPath;
  for (const [rawPath, rawMeta] of Object.entries(input)) {
    const key = normalizeFileKey(rawPath);
    if (!key) continue;
    fileMetaByPath[key] = normalizeMeta(rawMeta);
  }
  return fileMetaByPath;
};

const resolveHeadId = (repoProvenance) => (
  repoProvenance?.head?.changeId
  || repoProvenance?.head?.commitId
  || repoProvenance?.commit
  || null
);

const resolveDirty = (repoProvenance) => (
  typeof repoProvenance?.dirty === 'boolean' ? repoProvenance.dirty : null
);

const toUniqueFiles = (filesPosix = []) => {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(filesPosix) ? filesPosix : []) {
    const key = normalizeFileKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
};

const attachGuardedMetaIndex = ({
  fileMetaByPath,
  provider,
  repoRoot,
  includeChurn,
  freshnessGuard
}) => {
  if (!fileMetaByPath || typeof fileMetaByPath !== 'object') return fileMetaByPath;
  const index = new Map();
  for (const [rawPath, rawMeta] of Object.entries(fileMetaByPath)) {
    const key = normalizeFileKey(rawPath);
    if (!key) continue;
    index.set(key, normalizeMeta(rawMeta));
  }
  let guardEpoch = -1;
  let guardFresh = true;
  const isFresh = () => {
    if (!freshnessGuard?.key) return true;
    const epoch = getScmRuntimeConfigEpoch();
    if (epoch === guardEpoch) return guardFresh;
    guardEpoch = epoch;
    const runtimeGuard = buildScmFreshnessGuard({
      provider,
      repoRoot,
      includeChurn
    });
    guardFresh = runtimeGuard.key === freshnessGuard.key;
    return guardFresh;
  };
  Object.defineProperty(fileMetaByPath, 'get', {
    enumerable: false,
    configurable: true,
    value: (filePosix) => {
      if (!isFresh()) return null;
      const key = normalizeFileKey(filePosix);
      if (!key) return null;
      return index.get(key) || null;
    }
  });
  Object.defineProperty(fileMetaByPath, 'has', {
    enumerable: false,
    configurable: true,
    value: (filePosix) => {
      if (!isFresh()) return false;
      const key = normalizeFileKey(filePosix);
      return Boolean(key && index.has(key));
    }
  });
  Object.defineProperty(fileMetaByPath, 'size', {
    enumerable: false,
    configurable: true,
    value: index.size
  });
  Object.defineProperty(fileMetaByPath, 'freshness', {
    enumerable: false,
    configurable: true,
    value: freshnessGuard?.key ? {
      provider: freshnessGuard.provider || provider || null,
      repoRoot: freshnessGuard.repoRoot || normalizeRepoRoot(repoRoot) || null,
      headId: freshnessGuard.headId || null,
      includeChurn: includeChurn === true,
      configSignature: freshnessGuard.configSignature || null,
      key: freshnessGuard.key
    } : null
  });
  return fileMetaByPath;
};

const resolveChangedFileSet = async ({
  providerImpl,
  repoRoot,
  cachedHeadId,
  headId
}) => {
  if (!cachedHeadId || !headId) return null;
  if (cachedHeadId === headId) return new Set();
  if (!providerImpl || typeof providerImpl.getChangedFiles !== 'function') return null;
  const changed = await providerImpl.getChangedFiles({
    repoRoot,
    fromRef: cachedHeadId,
    toRef: headId
  });
  if (!changed || changed.ok === false || !Array.isArray(changed.filesPosix)) return null;
  const fileSet = new Set();
  for (const value of changed.filesPosix) {
    const key = normalizeFileKey(value);
    if (key) fileSet.add(key);
  }
  return fileSet;
};

const normalizeBatchDiagnostics = (value) => {
  const timeoutCount = Number.isFinite(Number(value?.timeoutCount))
    ? Math.max(0, Math.floor(Number(value.timeoutCount)))
    : 0;
  const timeoutRetries = Number.isFinite(Number(value?.timeoutRetries))
    ? Math.max(0, Math.floor(Number(value.timeoutRetries)))
    : 0;
  const cooldownSkips = Number.isFinite(Number(value?.cooldownSkips))
    ? Math.max(0, Math.floor(Number(value.cooldownSkips)))
    : 0;
  const unavailableChunks = Number.isFinite(Number(value?.unavailableChunks))
    ? Math.max(0, Math.floor(Number(value.unavailableChunks)))
    : 0;
  const timeoutHeatmap = Array.isArray(value?.timeoutHeatmap)
    ? value.timeoutHeatmap
      .map((entry) => {
        const file = normalizeFileKey(entry?.file);
        if (!file) return null;
        return {
          file,
          timeouts: Number.isFinite(Number(entry?.timeouts))
            ? Math.max(0, Math.floor(Number(entry.timeouts)))
            : 0,
          retries: Number.isFinite(Number(entry?.retries))
            ? Math.max(0, Math.floor(Number(entry.retries)))
            : 0,
          cooldownSkips: Number.isFinite(Number(entry?.cooldownSkips))
            ? Math.max(0, Math.floor(Number(entry.cooldownSkips)))
            : 0,
          lastTimeoutMs: Number.isFinite(Number(entry?.lastTimeoutMs))
            ? Math.max(0, Math.floor(Number(entry.lastTimeoutMs)))
            : null
        };
      })
      .filter(Boolean)
    : [];
  return {
    timeoutCount,
    timeoutRetries,
    cooldownSkips,
    unavailableChunks,
    timeoutHeatmap
  };
};

const runBatchFetch = async ({
  providerImpl,
  repoRoot,
  filesPosix,
  includeChurn,
  timeoutMs,
  headId
}) => {
  if (!providerImpl || typeof providerImpl.getFileMetaBatch !== 'function') {
    return { ok: false, reason: 'unsupported' };
  }
  const result = await providerImpl.getFileMetaBatch({
    repoRoot,
    filesPosix,
    includeChurn,
    timeoutMs,
    headId
  });
  if (!result || result.ok === false || !result.fileMetaByPath || typeof result.fileMetaByPath !== 'object') {
    return { ok: false, reason: result?.reason || 'unavailable' };
  }
  return {
    ok: true,
    fileMetaByPath: normalizeFileMetaMap(result.fileMetaByPath),
    diagnostics: normalizeBatchDiagnostics(result?.diagnostics || null)
  };
};

const runPerFileFetch = async ({
  providerImpl,
  repoRoot,
  filesPosix,
  includeChurn,
  timeoutMs,
  maxConcurrency,
  headId
}) => {
  const queue = new PQueue({
    concurrency: Number.isFinite(Number(maxConcurrency)) && Number(maxConcurrency) > 0
      ? Math.max(1, Math.floor(Number(maxConcurrency)))
      : 8
  });
  const fileMetaByPath = Object.create(null);
  await Promise.all(filesPosix.map((filePosix) => queue.add(async () => {
    const meta = await providerImpl.getFileMeta({
      repoRoot,
      filePosix,
      includeChurn,
      timeoutMs,
      headId
    });
    if (!meta || meta.ok === false) return;
    fileMetaByPath[filePosix] = normalizeMeta(meta);
  })));
  return fileMetaByPath;
};

export const resolveScmFileMetaSnapshotPath = (repoCacheRoot) => (
  path.join(repoCacheRoot, 'scm', SCM_FILE_META_SNAPSHOT_NAME)
);

export const prepareScmFileMetaSnapshot = async ({
  repoCacheRoot,
  provider,
  providerImpl,
  repoRoot,
  repoProvenance,
  filesPosix,
  includeChurn = false,
  timeoutMs = null,
  maxFallbackConcurrency = 8,
  log = null
} = {}) => {
  const logFn = typeof log === 'function' ? log : null;
  const activeProvider = typeof provider === 'string' ? provider : null;
  const resolvedRepoRoot = normalizeRepoRoot(repoRoot);
  const targetFiles = toUniqueFiles(filesPosix);
  const hasRepoCacheRoot = typeof repoCacheRoot === 'string' && repoCacheRoot.trim().length > 0;
  if (
    !hasRepoCacheRoot
    || !resolvedRepoRoot
    || !activeProvider
    || activeProvider === 'none'
    || !providerImpl
    || !targetFiles.length
  ) {
    return {
      fileMetaByPath: Object.create(null),
      stats: {
        enabled: false,
        source: 'disabled',
        requested: targetFiles.length,
        reused: 0,
        fetched: 0
      }
    };
  }

  const snapshotPath = resolveScmFileMetaSnapshotPath(repoCacheRoot);
  const headId = resolveHeadId(repoProvenance);
  const dirty = resolveDirty(repoProvenance);
  const freshnessGuard = buildScmFreshnessGuard({
    provider: activeProvider,
    repoRoot: resolvedRepoRoot,
    repoProvenance,
    repoHeadId: headId,
    includeChurn
  });
  const cached = await readJsonFileSafe(snapshotPath, { fallback: null, maxBytes: 64 * 1024 * 1024 });
  const cachedRoot = normalizeRepoRoot(cached?.repoRoot);
  const compatibleCached = cached
    && Number(cached.schemaVersion) === SCM_FILE_META_SNAPSHOT_SCHEMA_VERSION
    && cached.provider === activeProvider
    && cachedRoot
    && cachedRoot === resolvedRepoRoot
    && typeof cached.files === 'object'
    && cached.files != null
    && Boolean(cached.headId);
  const cachedFiles = compatibleCached ? normalizeFileMetaMap(cached.files) : Object.create(null);
  const cachedHeadId = compatibleCached ? String(cached.headId || '') : null;
  const cachedIncludeChurn = compatibleCached ? cached.includeChurn === true : false;
  const cachedConfigSignature = compatibleCached && typeof cached.configSignature === 'string' && cached.configSignature
    ? cached.configSignature
    : null;
  const hasConfigSignaturePair = Boolean(freshnessGuard.configSignature && cachedConfigSignature);
  const configCompatible = !hasConfigSignaturePair
    || cachedConfigSignature === freshnessGuard.configSignature;
  const canReuseByHead = configCompatible
    && Boolean(headId && cachedHeadId && headId === cachedHeadId && dirty === false);
  let changedFileSet = null;
  if (!canReuseByHead && compatibleCached && configCompatible && !dirty && cachedIncludeChurn === includeChurn) {
    changedFileSet = await resolveChangedFileSet({
      providerImpl,
      repoRoot,
      cachedHeadId,
      headId
    });
  }

  const reusable = Object.create(null);
  let reused = 0;
  if (configCompatible && cachedIncludeChurn === includeChurn) {
    for (const filePosix of targetFiles) {
      const meta = cachedFiles[filePosix];
      if (!meta) continue;
      if (canReuseByHead) {
        reusable[filePosix] = meta;
        reused += 1;
        continue;
      }
      if (changedFileSet && !changedFileSet.has(filePosix)) {
        reusable[filePosix] = meta;
        reused += 1;
      }
    }
  }
  const missing = targetFiles.filter((filePosix) => !reusable[filePosix]);
  const resolvedTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.max(1000, Math.floor(Number(timeoutMs)))
    : 15000;

  let fetchedMap = Object.create(null);
  let batchDiagnostics = normalizeBatchDiagnostics(null);
  let source = reused > 0 ? 'mixed' : 'fresh';
  if (missing.length > 0) {
    const batch = await runBatchFetch({
      providerImpl,
      repoRoot,
      filesPosix: missing,
      includeChurn,
      timeoutMs: resolvedTimeoutMs,
      headId
    });
    if (batch.ok) {
      fetchedMap = batch.fileMetaByPath;
      batchDiagnostics = batch.diagnostics || normalizeBatchDiagnostics(null);
    } else {
      fetchedMap = await runPerFileFetch({
        providerImpl,
        repoRoot,
        filesPosix: missing,
        includeChurn,
        timeoutMs: resolvedTimeoutMs,
        maxConcurrency: maxFallbackConcurrency,
        headId
      });
      source = reused > 0 ? 'mixed-fallback' : 'fallback';
    }
  } else {
    source = 'cache';
  }

  const persisted = Object.create(null);
  if (configCompatible && compatibleCached && cachedIncludeChurn === includeChurn) {
    for (const [filePosix, meta] of Object.entries(cachedFiles)) {
      if (changedFileSet && changedFileSet.has(filePosix)) continue;
      persisted[filePosix] = meta;
    }
  }
  for (const [filePosix, meta] of Object.entries(fetchedMap)) {
    persisted[filePosix] = meta;
  }

  const payload = {
    schemaVersion: SCM_FILE_META_SNAPSHOT_SCHEMA_VERSION,
    provider: activeProvider,
    repoRoot,
    headId: headId || null,
    dirty,
    includeChurn: includeChurn === true,
    freshnessKey: freshnessGuard.key || null,
    configSignature: freshnessGuard.configSignature || null,
    updatedAt: new Date().toISOString(),
    files: persisted
  };
  await atomicWriteJson(snapshotPath, payload, { spaces: 2 });

  const fileMetaByPath = Object.create(null);
  for (const filePosix of targetFiles) {
    const meta = persisted[filePosix];
    if (meta) fileMetaByPath[filePosix] = meta;
  }
  attachGuardedMetaIndex({
    fileMetaByPath,
    provider: activeProvider,
    repoRoot: resolvedRepoRoot,
    includeChurn,
    freshnessGuard
  });
  const fetched = Object.keys(fetchedMap).length;
  if (logFn) {
    const timeoutHeatmapLabel = Array.isArray(batchDiagnostics.timeoutHeatmap) && batchDiagnostics.timeoutHeatmap.length
      ? batchDiagnostics.timeoutHeatmap
        .slice(0, 3)
        .map((entry) => `${entry.file}:${entry.timeouts}t/${entry.cooldownSkips}c`)
        .join(',')
      : null;
    const diagnosticsSuffix = (
      batchDiagnostics.timeoutCount > 0
      || batchDiagnostics.cooldownSkips > 0
      || batchDiagnostics.timeoutRetries > 0
      || batchDiagnostics.unavailableChunks > 0
    )
      ? ` timeoutCount=${batchDiagnostics.timeoutCount}` +
        ` timeoutRetries=${batchDiagnostics.timeoutRetries}` +
        ` cooldownSkips=${batchDiagnostics.cooldownSkips}` +
        ` unavailableChunks=${batchDiagnostics.unavailableChunks}` +
        (timeoutHeatmapLabel ? ` timeoutHeatmap=${timeoutHeatmapLabel}` : '')
      : '';
    logFn(
      `[scm] file-meta snapshot: source=${source} requested=${targetFiles.length} reused=${reused} fetched=${fetched}.${diagnosticsSuffix}`
    );
  }
  return {
    fileMetaByPath,
    stats: {
      enabled: true,
      source,
      requested: targetFiles.length,
      reused,
      fetched,
      timeoutCount: batchDiagnostics.timeoutCount,
      timeoutRetries: batchDiagnostics.timeoutRetries,
      cooldownSkips: batchDiagnostics.cooldownSkips,
      unavailableChunks: batchDiagnostics.unavailableChunks,
      timeoutHeatmap: batchDiagnostics.timeoutHeatmap
    }
  };
};
