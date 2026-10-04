import path from 'node:path';
import PQueue from 'p-queue';
import { toPosix } from '../../shared/file-paths.js';
import { readJsonFileSafe } from '../../shared/file-read.js';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import {
  resolveQualityImpactForCause,
  resolveScmFallbackCause,
  summarizeReuseObservations
} from '../../shared/reuse-diagnostics.js';
import {
  isIncompleteFileMeta,
  normalizeFileMeta
} from './file-meta.js';
import { buildScmFreshnessGuard, getScmRuntimeConfigEpoch } from './runtime.js';
import { buildScmMetadataFailure, normalizeScmMetadataDiagnostics, preserveScmMetadataFailure } from './metadata-diagnostics.js';

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

const normalizeFileMetaMap = (input) => {
  const fileMetaByPath = Object.create(null);
  if (!input || typeof input !== 'object') return fileMetaByPath;
  for (const [rawPath, rawMeta] of Object.entries(input)) {
    const key = normalizeFileKey(rawPath);
    if (!key) continue;
    fileMetaByPath[key] = normalizeFileMeta(rawMeta);
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
    index.set(key, normalizeFileMeta(rawMeta));
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

const normalizeBatchDiagnostics = normalizeScmMetadataDiagnostics;

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
  let result;
  try {
    result = await providerImpl.getFileMetaBatch({ repoRoot, filesPosix, includeChurn, timeoutMs, headId });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') throw error;
    result = { ok: false, reason: 'unavailable', failure: buildScmMetadataFailure(error, 'getFileMetaBatch') };
  }
  if (!result || result.ok === false || !result.fileMetaByPath || typeof result.fileMetaByPath !== 'object') {
    return { ok: false, reason: result?.reason || 'unavailable', ...preserveScmMetadataFailure(result) };
  }
  return {
    ok: true,
    fileMetaByPath: normalizeFileMetaMap(result.fileMetaByPath),
    diagnostics: normalizeScmMetadataDiagnostics(result?.diagnostics || null)
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
  const diagnostics = { attempted: 0, complete: 0, unavailable: 0, failures: [], truncated: false };
  await Promise.all(filesPosix.map((filePosix) => queue.add(async () => {
    diagnostics.attempted += 1;
    let meta;
    try {
      meta = await providerImpl.getFileMeta({ repoRoot, filePosix, includeChurn, timeoutMs, headId });
    } catch (error) {
      if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') throw error;
      meta = { ok: false, reason: 'unavailable', failure: buildScmMetadataFailure(error, 'getFileMeta') };
    }
    if (!meta || meta.ok === false) {
      diagnostics.unavailable += 1;
      if (meta?.failure) {
        if (diagnostics.failures.length < 8) diagnostics.failures.push(buildScmMetadataFailure(meta.failure, 'getFileMeta'));
        else diagnostics.truncated = true;
      }
      return;
    }
    const normalized = normalizeFileMeta(meta);
    fileMetaByPath[filePosix] = normalized;
    if (!isIncompleteFileMeta(normalized, { includeChurn })) diagnostics.complete += 1;
    else diagnostics.unavailable += 1;
  })));
  return { fileMetaByPath, diagnostics };
};

const hasCompleteFetchedMeta = (fileMetaByPath, filesPosix, { includeChurn = false } = {}) => (
  Array.isArray(filesPosix)
  && filesPosix.every((filePosix) => {
    const meta = fileMetaByPath?.[filePosix];
    return !isIncompleteFileMeta(meta, { includeChurn });
  })
);

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
  log = null,
  buildRoot = null,
  buildId = null,
  mode = null
} = {}) => {
  const startedAtMs = Date.now();
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
      if (!meta || isIncompleteFileMeta(meta, { includeChurn })) continue;
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
  let usedUnavailableBatchFallback = false;
  let batchReason = null;
  let batchFailure = null;
  let perFileDiagnostics = { attempted: 0, complete: 0, unavailable: 0, failures: [], truncated: false };
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
      const incompleteFiles = missing.filter((filePosix) => isIncompleteFileMeta(fetchedMap[filePosix], { includeChurn }));
      if (incompleteFiles.length > 0) {
        const completedMap = await runPerFileFetch({
          providerImpl,
          repoRoot,
          filesPosix: incompleteFiles,
          includeChurn,
          timeoutMs: resolvedTimeoutMs,
          maxConcurrency: maxFallbackConcurrency,
          headId
        });
        perFileDiagnostics = completedMap.diagnostics;
        for (const [filePosix, meta] of Object.entries(completedMap.fileMetaByPath || {})) {
          fetchedMap[filePosix] = meta;
        }
        source = reused > 0 ? 'mixed-fallback' : 'fresh-fallback';
      }
    } else {
      usedUnavailableBatchFallback = true;
      batchReason = batch.reason;
      batchFailure = batch.failure || null;
      batchDiagnostics = normalizeScmMetadataDiagnostics(batch.diagnostics);
      const completed = await runPerFileFetch({
        providerImpl,
        repoRoot,
        filesPosix: missing,
        includeChurn,
        timeoutMs: resolvedTimeoutMs,
        maxConcurrency: maxFallbackConcurrency,
        headId
      });
      fetchedMap = completed.fileMetaByPath;
      perFileDiagnostics = completed.diagnostics;
      source = reused > 0 ? 'mixed-fallback' : 'fallback';
    }
    const recoveredAllMissing = hasCompleteFetchedMeta(fetchedMap, missing, { includeChurn });
    const unresolvedDiagnostics = (
      batchDiagnostics.timeoutCount > 0
      || batchDiagnostics.cooldownSkips > 0
      || batchDiagnostics.unavailableChunks > 0
    );
    if (recoveredAllMissing && !unresolvedDiagnostics && (!usedUnavailableBatchFallback || batchReason === 'unsupported')) {
      source = reused > 0 ? 'mixed' : 'fresh';
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
    diagnostics: { batchReason, batchFailure, batch: batchDiagnostics, perFile: perFileDiagnostics },
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
  const unresolvedFiles = targetFiles.filter((file) => isIncompleteFileMeta(fileMetaByPath[file], { includeChurn })).length;
  const causeClass = resolveScmFallbackCause({
    source,
    timeoutCount: batchDiagnostics.timeoutCount,
    cooldownSkips: batchDiagnostics.cooldownSkips,
    unavailableChunks: batchDiagnostics.unavailableChunks
  });
  const generation = {
    mode,
    repoRoot: resolvedRepoRoot,
    buildRoot: typeof buildRoot === 'string' ? path.resolve(buildRoot) : null,
    buildId: typeof buildId === 'string' ? buildId : null
  };
  const observation = {
    kind: 'scm_snapshot',
    reuseSurface: 'scm-derived',
    reuseSource: source,
    causeClass,
    qualityImpact: resolveQualityImpactForCause(causeClass),
    requestedCount: targetFiles.length,
    reusedCount: reused,
    fetchedCount: fetched,
    timeCostMs: Math.max(0, Date.now() - startedAtMs),
    generation
  };
  const reuseSummary = {
    ...summarizeReuseObservations([observation], { generation }),
    observations: [observation]
  };
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
      `[scm] file-meta snapshot: source=${source} requested=${targetFiles.length} reused=${reused} fetched=${fetched}.`
      + ` elapsedMs=${Math.max(0, Date.now() - startedAtMs)}${diagnosticsSuffix}`
    );
    if (batchReason || perFileDiagnostics.attempted > 0) {
      logFn(`[scm] file-meta recovery: batch=${batchReason || 'partial'} perFileAttempted=${perFileDiagnostics.attempted}`
        + ` complete=${perFileDiagnostics.complete} unavailable=${perFileDiagnostics.unavailable} unresolved=${unresolvedFiles}`
        + (batchFailure ? ` failure=${JSON.stringify(batchFailure)}` : ''));
    }
  }
  return {
    fileMetaByPath,
    stats: {
      enabled: true,
      source,
      requested: targetFiles.length,
      reused,
      fetched,
      unresolvedFiles,
      batchReason,
      batchFailure,
      perFileDiagnostics,
      failureCount: batchDiagnostics.failureCount,
      failures: batchDiagnostics.failures,
      truncated: batchDiagnostics.truncated,
      reuse: reuseSummary,
      timeoutCount: batchDiagnostics.timeoutCount,
      timeoutRetries: batchDiagnostics.timeoutRetries,
      cooldownSkips: batchDiagnostics.cooldownSkips,
      unavailableChunks: batchDiagnostics.unavailableChunks,
      timeoutHeatmap: batchDiagnostics.timeoutHeatmap
    }
  };
};
