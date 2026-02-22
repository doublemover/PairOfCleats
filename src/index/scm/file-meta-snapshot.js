import path from 'node:path';
import PQueue from 'p-queue';
import { toPosix, readJsonFileSafe } from '../../shared/files.js';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';

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

const runBatchFetch = async ({
  providerImpl,
  repoRoot,
  filesPosix,
  includeChurn,
  timeoutMs
}) => {
  if (!providerImpl || typeof providerImpl.getFileMetaBatch !== 'function') {
    return { ok: false, reason: 'unsupported' };
  }
  const result = await providerImpl.getFileMetaBatch({
    repoRoot,
    filesPosix,
    includeChurn,
    timeoutMs
  });
  if (!result || result.ok === false || !result.fileMetaByPath || typeof result.fileMetaByPath !== 'object') {
    return { ok: false, reason: result?.reason || 'unavailable' };
  }
  return {
    ok: true,
    fileMetaByPath: normalizeFileMetaMap(result.fileMetaByPath)
  };
};

const runPerFileFetch = async ({
  providerImpl,
  repoRoot,
  filesPosix,
  includeChurn,
  timeoutMs,
  maxConcurrency
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
      timeoutMs
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
  const canReuseByHead = Boolean(headId && cachedHeadId && headId === cachedHeadId && dirty === false);
  let changedFileSet = null;
  if (!canReuseByHead && compatibleCached && !dirty && cachedIncludeChurn === includeChurn) {
    changedFileSet = await resolveChangedFileSet({
      providerImpl,
      repoRoot,
      cachedHeadId,
      headId
    });
  }

  const reusable = Object.create(null);
  let reused = 0;
  if (cachedIncludeChurn === includeChurn) {
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
  let source = reused > 0 ? 'mixed' : 'fresh';
  if (missing.length > 0) {
    const batch = await runBatchFetch({
      providerImpl,
      repoRoot,
      filesPosix: missing,
      includeChurn,
      timeoutMs: resolvedTimeoutMs
    });
    if (batch.ok) {
      fetchedMap = batch.fileMetaByPath;
    } else {
      fetchedMap = await runPerFileFetch({
        providerImpl,
        repoRoot,
        filesPosix: missing,
        includeChurn,
        timeoutMs: resolvedTimeoutMs,
        maxConcurrency: maxFallbackConcurrency
      });
      source = reused > 0 ? 'mixed-fallback' : 'fallback';
    }
  } else {
    source = 'cache';
  }

  const persisted = Object.create(null);
  if (compatibleCached && cachedIncludeChurn === includeChurn) {
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
    updatedAt: new Date().toISOString(),
    files: persisted
  };
  await atomicWriteJson(snapshotPath, payload, { spaces: 2 });

  const fileMetaByPath = Object.create(null);
  for (const filePosix of targetFiles) {
    const meta = persisted[filePosix];
    if (meta) fileMetaByPath[filePosix] = meta;
  }
  const fetched = Object.keys(fetchedMap).length;
  if (logFn) {
    logFn(
      `[scm] file-meta snapshot: source=${source} requested=${targetFiles.length} reused=${reused} fetched=${fetched}.`
    );
  }
  return {
    fileMetaByPath,
    stats: {
      enabled: true,
      source,
      requested: targetFiles.length,
      reused,
      fetched
    }
  };
};
