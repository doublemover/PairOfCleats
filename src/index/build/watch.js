import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireIndexLock } from './lock.js';
import { discoverFiles } from './discover.js';
import { buildIndexForMode } from './indexer.js';
import {
  EXTS_CODE,
  EXTS_PROSE,
  isLockFile,
  isManifestFile,
  isSpecialCodeFile,
  resolveSpecialCodeExt
} from '../constants.js';
import { log } from '../../shared/progress.js';
import {
  incWatchBurst,
  incWatchDebounce,
  incWatchEvent,
  observeWatchBuildDuration,
  setWatchBacklog
} from '../../shared/metrics.js';
import { fileExt, toPosix } from '../../shared/files.js';
import { getCapabilities } from '../../shared/capabilities.js';
import { getEnvConfig } from '../../shared/env.js';
import { startChokidarWatcher } from './watch/backends/chokidar.js';
import { startParcelWatcher } from './watch/backends/parcel.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeBackend = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

export const resolveWatcherBackend = ({ runtime, pollMs }) => {
  const envConfig = getEnvConfig();
  const configBackend = normalizeBackend(runtime?.userConfig?.indexing?.watch?.backend);
  const envBackend = normalizeBackend(envConfig.watcherBackend);
  const requested = configBackend || envBackend || 'auto';
  const caps = getCapabilities();
  const pollingEnabled = Number.isFinite(Number(pollMs)) && Number(pollMs) > 0;
  let resolved = requested;
  let warning = null;

  if (requested === 'auto') {
    resolved = caps.watcher.parcel && !pollingEnabled ? 'parcel' : 'chokidar';
  } else if (requested === 'parcel') {
    if (!caps.watcher.parcel) {
      resolved = 'chokidar';
      warning = 'Parcel watcher unavailable; falling back to chokidar.';
    } else if (pollingEnabled) {
      resolved = 'chokidar';
      warning = 'Polling requires chokidar; falling back.';
    }
  } else if (requested !== 'chokidar') {
    resolved = 'chokidar';
  }

  return { requested, resolved, warning, pollingEnabled };
};

export const waitForStableFile = async (absPath, { checks, intervalMs }) => {
  let lastSignature = null;
  for (let index = 0; index < checks; index += 1) {
    let stat = null;
    try {
      stat = await fs.stat(absPath);
    } catch {
      return false;
    }
    const signature = `${stat.size}:${stat.mtimeMs}`;
    if (signature === lastSignature) return true;
    lastSignature = signature;
    if (index < checks - 1) {
      await sleep(intervalMs);
    }
  }
  return true;
};

export function createDebouncedScheduler({ debounceMs, onRun, onSchedule, onCancel, onFire, onError }) {
  let timer = null;
  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
      if (onCancel) onCancel();
    }
    timer = setTimeout(() => {
      timer = null;
      if (onFire) onFire();
      void Promise.resolve()
        .then(() => onRun())
        .catch((err) => {
          if (onError) onError(err);
        });
    }, debounceMs);
    if (onSchedule) onSchedule();
  };
  const cancel = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    if (onCancel) onCancel();
  };
  return { schedule, cancel };
}

const normalizeRoot = (value) => {
  const resolved = path.resolve(value || '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const resolveRecordsRoot = (root, recordsDir) => {
  if (!recordsDir) return null;
  const normalizedRoot = normalizeRoot(root);
  const normalizedRecords = normalizeRoot(recordsDir);
  if (normalizedRecords === normalizedRoot) return normalizedRecords;
  if (normalizedRecords.startsWith(`${normalizedRoot}${path.sep}`)) return normalizedRecords;
  return null;
};

export function isIndexablePath({ absPath, root, recordsRoot, ignoreMatcher, modes }) {
  const relPosix = toPosix(path.relative(root, absPath));
  if (!relPosix || relPosix === '.' || relPosix.startsWith('..')) return false;
  const normalizedRecordsRoot = recordsRoot ? normalizeRoot(recordsRoot) : null;
  if (normalizedRecordsRoot) {
    const normalizedAbs = normalizeRoot(absPath);
    if (normalizedAbs.startsWith(`${normalizedRecordsRoot}${path.sep}`)) {
      return modes.includes('records');
    }
  }
  if (ignoreMatcher?.ignores(relPosix)) return false;
  const baseName = path.basename(absPath);
  const ext = resolveSpecialCodeExt(baseName) || fileExt(absPath);
  const isManifest = isManifestFile(baseName);
  const isLock = isLockFile(baseName);
  const isSpecial = isSpecialCodeFile(baseName) || isManifest || isLock;
  const allowCode = (modes.includes('code') || modes.includes('extracted-prose'))
    && (EXTS_CODE.has(ext) || isSpecial);
  const allowProse = (modes.includes('prose') || modes.includes('extracted-prose')) && EXTS_PROSE.has(ext);
  return allowCode || allowProse;
}

const listRecordsFiles = async (recordsDir) => {
  if (!recordsDir) return [];
  try {
    const entries = await fs.readdir(recordsDir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(recordsDir, entry.name);
      if (entry.isDirectory()) {
        const nested = await listRecordsFiles(fullPath);
        files.push(...nested);
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.md') || entry.name.endsWith('.json')) {
          files.push(fullPath);
        }
      }
    }
    return files;
  } catch {
    return [];
  }
};

const scanFiles = async ({
  root,
  modes,
  recordsDir,
  ignoreMatcher,
  maxFileBytes,
  fileCaps,
  maxDepth,
  maxFiles
}) => {
  const scanModes = modes.filter((mode) => mode !== 'records');
  const files = new Set();
  const skippedFiles = [];
  for (const mode of scanModes) {
    const modeFiles = await discoverFiles({
      root,
      mode,
      recordsDir,
      ignoreMatcher,
      skippedFiles,
      maxFileBytes,
      fileCaps,
      maxDepth,
      maxFiles
    });
    modeFiles.forEach((entry) => files.add(entry.abs || entry));
  }
  if (modes.includes('records')) {
    const recordFiles = await listRecordsFiles(recordsDir);
    recordFiles.forEach((entry) => files.add(entry));
  }
  return Array.from(files);
};

const resolveMaxBytesForExt = (ext, maxFileBytes, fileCaps) => {
  const extKey = ext ? ext.toLowerCase() : '';
  const defaultCap = fileCaps?.default?.maxBytes;
  const extCap = extKey ? fileCaps?.byExt?.[extKey]?.maxBytes : null;
  const capValue = Number.isFinite(Number(extCap ?? defaultCap))
    ? Number(extCap ?? defaultCap)
    : null;
  if (!Number.isFinite(Number(maxFileBytes)) || Number(maxFileBytes) <= 0) {
    return capValue;
  }
  if (!Number.isFinite(capValue) || capValue <= 0) {
    return Number(maxFileBytes);
  }
  return Math.min(Number(maxFileBytes), capValue);
};

const isWithinMaxBytes = async (absPath, maxFileBytes, fileCaps) => {
  const baseName = path.basename(absPath);
  const ext = resolveSpecialCodeExt(baseName) || fileExt(absPath);
  const resolvedMax = resolveMaxBytesForExt(ext, maxFileBytes, fileCaps);
  if (!Number.isFinite(Number(resolvedMax)) || Number(resolvedMax) <= 0) {
    return true;
  }
  try {
    const stat = await fs.stat(absPath);
    return stat.size <= Number(resolvedMax);
  } catch {
    return false;
  }
};

const buildIgnoredMatcher = ({ root, ignoreMatcher }) => (targetPath, stats) => {
  const relPosix = toPosix(path.relative(root, targetPath));
  if (!relPosix || relPosix === '.' || relPosix.startsWith('..')) return false;
  if (stats?.isDirectory && stats.isDirectory()) {
    const dirPath = relPosix.endsWith('/') ? relPosix : `${relPosix}/`;
    if (ignoreMatcher.ignores(dirPath)) return true;
  }
  return ignoreMatcher.ignores(relPosix);
};

/**
 * Watch for file changes and rebuild indexes incrementally.
 * @param {{runtime:object,modes:string[],pollMs:number,debounceMs:number}} input
 */
export async function watchIndex({ runtime, modes, pollMs, debounceMs }) {
  const root = runtime.root;
  const recordsRoot = resolveRecordsRoot(root, runtime.recordsDir);
  const ignoreMatcher = runtime.ignoreMatcher;
  const maxFileBytes = runtime.maxFileBytes;
  const fileCaps = runtime.fileCaps;
  const guardrails = runtime.guardrails || {};
  const maxDepth = guardrails.maxDepth ?? null;
  const maxFiles = guardrails.maxFiles ?? null;
  runtime.incrementalEnabled = true;
  runtime.argv.incremental = true;

  let running = false;
  let pending = false;
  let shouldExit = false;
  let shutdownSignal = null;
  let resolveExit = null;
  const trackedFiles = new Set();
  const pendingPaths = new Set();
  const burstWindowMs = 1000;
  const burstThreshold = 25;
  let burstStart = 0;
  let burstCount = 0;
  let burstMax = 0;
  let scheduler;
  let stabilityGuard = null;

  const stop = () => {
    if (resolveExit) {
      resolveExit();
      resolveExit = null;
    }
  };

  const requestShutdown = (signal) => {
    if (shouldExit) return;
    shouldExit = true;
    shutdownSignal = signal;
    scheduler.cancel();
    log(`[watch] ${signal} received; shutting down...`);
    stop();
  };

  const handleSigint = () => requestShutdown('SIGINT');
  const handleSigterm = () => requestShutdown('SIGTERM');
  process.on('SIGINT', handleSigint);
  process.on('SIGTERM', handleSigterm);

  const scheduleBuild = () => {
    if (shouldExit) return;
    scheduler?.schedule();
  };

  const runBuild = async () => {
    if (running) {
      pending = true;
      return;
    }
    if (shouldExit) return;
    running = true;
    const startTime = process.hrtime.bigint();
    let status = 'ok';
    let lock = null;
    lock = await acquireIndexLock({ repoCacheRoot: runtime.repoCacheRoot, log });
    if (!lock) {
      status = 'unknown';
      running = false;
      pending = true;
      if (!shouldExit) scheduleBuild();
      return;
    }
    const batchSize = pendingPaths.size;
    if (batchSize > 0) {
      pendingPaths.clear();
      setWatchBacklog(0);
      log(`[watch] Rebuilding index for ${batchSize} change(s)...`);
    }
    try {
      for (const mode of modes) {
        await buildIndexForMode({ mode, runtime });
      }
      log('[watch] Index update complete.');
    } catch (err) {
      status = 'error';
      log(`[watch] Index update failed: ${err?.message || err}`);
    } finally {
      await lock.release();
      running = false;
      observeWatchBuildDuration({
        status,
        seconds: Number(process.hrtime.bigint() - startTime) / 1e9
      });
    }
    if (pending) {
      pending = false;
      if (!shouldExit) scheduleBuild();
    }
  };

  scheduler = createDebouncedScheduler({
    debounceMs,
    onRun: runBuild,
    onSchedule: () => incWatchDebounce('scheduled'),
    onCancel: () => incWatchDebounce('canceled'),
    onFire: () => incWatchDebounce('fired'),
    onError: (err) => log(`[watch] Debounced build failed: ${err?.message || err}`)
  });

  const recordAddOrChange = async (absPath) => {
    if (!isIndexablePath({ absPath, root, recordsRoot, ignoreMatcher, modes })) return;
    if (stabilityGuard?.enabled) {
      const stable = await waitForStableFile(absPath, stabilityGuard);
      if (!stable) return;
    }
    pendingPaths.add(absPath);
    setWatchBacklog(pendingPaths.size);
    const withinMax = await isWithinMaxBytes(absPath, maxFileBytes, fileCaps);
    if (!withinMax) {
      if (trackedFiles.delete(absPath)) scheduleBuild();
      return;
    }
    trackedFiles.add(absPath);
    scheduleBuild();
  };

  const recordRemove = (absPath) => {
    if (!isIndexablePath({ absPath, root, recordsRoot, ignoreMatcher, modes })) return;
    pendingPaths.add(absPath);
    setWatchBacklog(pendingPaths.size);
    if (trackedFiles.delete(absPath)) scheduleBuild();
  };

  const initialFiles = await scanFiles({
    root,
    modes,
    recordsDir: runtime.recordsDir,
    ignoreMatcher,
    maxFileBytes,
    fileCaps,
    maxDepth,
    maxFiles
  });
  initialFiles.forEach((file) => trackedFiles.add(file));
  const backendSelection = resolveWatcherBackend({ runtime, pollMs });
  const pollingEnabled = backendSelection.pollingEnabled;
  const pollLabel = pollingEnabled ? ` polling ${Number(pollMs)}ms` : ' fs events';
  const backendLabel = backendSelection.resolved === 'parcel' ? 'parcel' : 'chokidar';
  if (backendSelection.warning) log(`[watch] ${backendSelection.warning}`);
  log(`[watch] Monitoring ${trackedFiles.size} file(s) via ${backendLabel}${pollLabel}.`);

  stabilityGuard = backendSelection.resolved === 'parcel'
    ? {
      enabled: true,
      checks: 3,
      intervalMs: Math.max(50, Math.min(200, Math.floor(Number(debounceMs) / 3) || 50))
    }
    : { enabled: false, checks: 0, intervalMs: 0 };

  const recordBurst = () => {
    const now = Date.now();
    if (!burstStart || now - burstStart > burstWindowMs) {
      burstStart = now;
      burstCount = 0;
    }
    burstCount += 1;
    burstMax = Math.max(burstMax, burstCount);
    if (burstCount === burstThreshold) {
      incWatchBurst();
      log(`[watch] Burst detected: ${burstCount} events in ${burstWindowMs}ms (max ${burstMax}).`);
    }
  };

  const handleEvent = (event) => {
    incWatchEvent(event?.type || 'unknown');
    recordBurst();
    if (event?.type === 'unlink') {
      recordRemove(event.absPath);
      return;
    }
    void recordAddOrChange(event.absPath);
  };
  const handleError = (err) => {
    incWatchEvent('error');
    log(`[watch] Watcher error: ${err?.message || err}`);
  };
  const ignored = buildIgnoredMatcher({ root, ignoreMatcher });
  const watcher = backendSelection.resolved === 'parcel'
    ? await startParcelWatcher({ root, ignored, onEvent: handleEvent, onError: handleError })
    : startChokidarWatcher({
      root,
      ignored,
      onEvent: handleEvent,
      onError: handleError,
      pollMs,
      awaitWriteFinishMs: debounceMs
    });

  await new Promise((resolve) => {
    resolveExit = resolve;
  });

  await watcher.close();

  if (running) {
    log('[watch] Waiting for active build to finish...');
    while (running) {
      await sleep(200);
    }
  }
  process.off('SIGINT', handleSigint);
  process.off('SIGTERM', handleSigterm);
  log(`[watch] Shutdown complete${shutdownSignal ? ` (${shutdownSignal})` : ''}.`);
}
