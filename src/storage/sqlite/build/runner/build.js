import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSqliteIngestPlan } from '../index.js';
import { resolveManifestBundleNames } from '../../../../shared/bundle-io.js';

const SQLITE_DEFAULT_PAGE_SIZE = 4096;

const readPragmaSimple = (db, name) => {
  if (!db || !name) return null;
  try {
    return db.pragma(name, { simple: true });
  } catch {
    return null;
  }
};

export const probeSqliteTargetRuntime = ({ Database, dbPath }) => {
  const runtime = {
    pageSize: SQLITE_DEFAULT_PAGE_SIZE,
    journalMode: null,
    walEnabled: false,
    walBytes: 0,
    dbBytes: 0,
    source: 'default'
  };
  if (!dbPath) return runtime;
  try {
    runtime.dbBytes = Number(fsSync.statSync(dbPath).size) || 0;
  } catch {}
  try {
    runtime.walBytes = Number(fsSync.statSync(`${dbPath}-wal`).size) || 0;
  } catch {}
  if (!fsSync.existsSync(dbPath)) {
    runtime.walEnabled = runtime.walBytes > 0;
    runtime.source = runtime.walEnabled ? 'wal-sidecar' : 'missing-db';
    return runtime;
  }
  let probeDb = null;
  try {
    probeDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    const pageSize = Number(readPragmaSimple(probeDb, 'page_size'));
    if (Number.isFinite(pageSize) && pageSize > 0) {
      runtime.pageSize = Math.max(512, Math.floor(pageSize));
    }
    const journalModeRaw = readPragmaSimple(probeDb, 'journal_mode');
    runtime.journalMode = typeof journalModeRaw === 'string'
      ? journalModeRaw.trim().toLowerCase()
      : null;
    runtime.walEnabled = runtime.journalMode === 'wal' || runtime.walBytes > 0;
    runtime.source = 'pragma';
  } catch {
    runtime.walEnabled = runtime.walBytes > 0;
    runtime.source = runtime.walEnabled ? 'wal-sidecar' : 'stat';
  } finally {
    try {
      probeDb?.close();
    } catch {}
  }
  return runtime;
};

const normalizeAdaptiveBatchConfig = ({
  requestedBatchSize,
  runtime,
  inputBytes = 0,
  rowCount = 0,
  fileCount = 0,
  repoBytes = 0
}) => {
  const resolvedRuntime = runtime && typeof runtime === 'object' ? runtime : {};
  const numericInputBytes = Number(inputBytes);
  const numericRepoBytes = Number(repoBytes);
  const runtimeDbBytes = Number(resolvedRuntime.dbBytes);
  return {
    requested: Number.isFinite(requestedBatchSize) && requestedBatchSize > 0
      ? Math.floor(requestedBatchSize)
      : null,
    pageSize: resolvedRuntime.pageSize ?? SQLITE_DEFAULT_PAGE_SIZE,
    journalMode: resolvedRuntime.journalMode ?? null,
    walEnabled: resolvedRuntime.walEnabled === true,
    walBytes: Number.isFinite(Number(resolvedRuntime.walBytes)) && Number(resolvedRuntime.walBytes) > 0
      ? Number(resolvedRuntime.walBytes)
      : 0,
    inputBytes: Number.isFinite(numericInputBytes) && numericInputBytes > 0
      ? numericInputBytes
      : 0,
    rowCount: Number.isFinite(Number(rowCount)) && Number(rowCount) > 0
      ? Number(rowCount)
      : 0,
    fileCount: Number.isFinite(Number(fileCount)) && Number(fileCount) > 0
      ? Number(fileCount)
      : 0,
    repoBytes: Math.max(
      Number.isFinite(numericRepoBytes) && numericRepoBytes > 0 ? numericRepoBytes : 0,
      Number.isFinite(numericInputBytes) && numericInputBytes > 0 ? numericInputBytes : 0,
      Number.isFinite(runtimeDbBytes) && runtimeDbBytes > 0 ? runtimeDbBytes : 0
    )
  };
};

const createAdaptiveBatchPlanKey = (config) => [
  config.requested ?? '',
  config.pageSize ?? '',
  config.journalMode ?? '',
  config.walEnabled ? 1 : 0,
  config.walBytes ?? 0,
  config.inputBytes ?? 0,
  config.rowCount ?? 0,
  config.fileCount ?? 0,
  config.repoBytes ?? 0
].join('|');

/**
 * Memoize ingest-plan resolution for repeated mode planning.
 * @returns {(options: {
 *   requestedBatchSize:number|null|undefined,
 *   runtime:object,
 *   inputBytes?:number,
 *   rowCount?:number,
 *   fileCount?:number,
 *   repoBytes?:number
 * }) => { config: object, plan: object }}
 */
export const createAdaptiveBatchPlanner = () => {
  const planCache = new Map();
  return (options = {}) => {
    const config = normalizeAdaptiveBatchConfig(options);
    const cacheKey = createAdaptiveBatchPlanKey(config);
    let plan = planCache.get(cacheKey);
    if (!plan) {
      plan = resolveSqliteIngestPlan({ batchSize: config });
      planCache.set(cacheKey, plan);
    }
    return { config, plan: { ...plan } };
  };
};

const estimateBundleAverageBytes = (bundleDir, manifestFiles) => {
  if (!bundleDir || !manifestFiles || typeof manifestFiles !== 'object') return 0;
  const sampleNames = [];
  for (const entry of Object.values(manifestFiles)) {
    for (const bundleName of resolveManifestBundleNames(entry)) {
      if (!bundleName || sampleNames.includes(bundleName)) continue;
      sampleNames.push(bundleName);
      if (sampleNames.length >= 32) break;
    }
    if (sampleNames.length >= 32) break;
  }
  if (!sampleNames.length) return 0;
  let total = 0;
  let count = 0;
  for (const bundleName of sampleNames) {
    const bundlePath = path.join(bundleDir, bundleName);
    try {
      const stat = fsSync.statSync(bundlePath);
      const size = Number(stat?.size);
      if (!Number.isFinite(size) || size <= 0) continue;
      total += size;
      count += 1;
    } catch {}
  }
  if (!count) return 0;
  return Math.floor(total / count);
};

export const resolveBundleWorkerAutotune = ({
  mode,
  manifestFiles,
  bundleDir,
  threadLimits,
  envConfig,
  profile
}) => {
  const explicitBundleThreads = Number(envConfig?.bundleThreads);
  const concurrencyFloor = 1;
  const cpuHint = Number.isFinite(Number(threadLimits?.fileConcurrency))
    ? Math.max(1, Math.floor(Number(threadLimits.fileConcurrency)))
    : 1;
  const hostCpu = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : (Array.isArray(os.cpus()) ? os.cpus().length : 1);
  const upperBound = Math.max(1, Math.min(16, Math.max(cpuHint, hostCpu)));
  const bundleCount = manifestFiles && typeof manifestFiles === 'object'
    ? Object.keys(manifestFiles).length
    : 0;
  if (Number.isFinite(explicitBundleThreads) && explicitBundleThreads > 0) {
    return {
      threads: Math.max(concurrencyFloor, Math.min(upperBound, Math.floor(explicitBundleThreads))),
      reason: 'explicit-env',
      bundleCount,
      avgBundleBytes: estimateBundleAverageBytes(bundleDir, manifestFiles)
    };
  }
  let desired = bundleCount >= 96 ? 8
    : bundleCount >= 48 ? 6
      : bundleCount >= 16 ? 4
        : bundleCount >= 8 ? 2
          : 1;
  const avgBundleBytes = estimateBundleAverageBytes(bundleDir, manifestFiles);
  if (avgBundleBytes >= 4 * 1024 * 1024) desired = Math.max(1, desired - 2);
  else if (avgBundleBytes >= 1024 * 1024) desired = Math.max(1, desired - 1);
  else if (avgBundleBytes > 0 && avgBundleBytes <= 192 * 1024) desired += 1;
  if (mode === 'records') desired = Math.max(1, Math.floor(desired * 0.5));
  if (mode === 'extracted-prose') desired = Math.max(1, desired - 1);
  const lowCountSafetyCap = bundleCount > 0 && bundleCount < 16
    ? Math.max(1, Math.ceil(bundleCount / 2))
    : upperBound;
  desired = Math.max(concurrencyFloor, Math.min(upperBound, lowCountSafetyCap, desired));
  const priorMode = profile?.modes && typeof profile.modes === 'object'
    ? profile.modes[mode]
    : null;
  const priorThreads = Number(priorMode?.threads);
  // Rapid-convergence guard: move by at most one worker per run.
  if (Number.isFinite(priorThreads) && priorThreads > 0) {
    const clampedPrior = Math.max(concurrencyFloor, Math.min(upperBound, Math.floor(priorThreads)));
    if (desired > clampedPrior + 1) desired = clampedPrior + 1;
    if (desired < clampedPrior - 1) desired = clampedPrior - 1;
  }
  return {
    threads: Math.max(concurrencyFloor, Math.min(upperBound, desired)),
    reason: 'autotune',
    bundleCount,
    avgBundleBytes
  };
};
