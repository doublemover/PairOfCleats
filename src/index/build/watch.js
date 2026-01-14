import fs from 'node:fs/promises';
import path from 'node:path';
import chokidar from 'chokidar';
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createDebouncedScheduler({ debounceMs, onRun, onSchedule, onCancel, onFire }) {
  let timer = null;
  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
      if (onCancel) onCancel();
    }
    timer = setTimeout(() => {
      timer = null;
      if (onFire) onFire();
      onRun();
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

export function isIndexablePath({ absPath, root, ignoreMatcher, modes }) {
  const relPosix = toPosix(path.relative(root, absPath));
  if (!relPosix || relPosix === '.' || relPosix.startsWith('..')) return false;
  if (ignoreMatcher?.ignores(relPosix)) return false;
  const baseName = path.basename(absPath);
  const ext = resolveSpecialCodeExt(baseName) || fileExt(absPath);
  const isManifest = isManifestFile(baseName);
  const isLock = isLockFile(baseName);
  const isSpecial = isSpecialCodeFile(baseName) || isManifest || isLock;
  const allowCode = modes.includes('code') && (EXTS_CODE.has(ext) || isSpecial);
  const allowProse = modes.includes('prose') && EXTS_PROSE.has(ext);
  return allowCode || allowProse;
}

const scanFiles = async ({ root, modes, ignoreMatcher, maxFileBytes, fileCaps, maxDepth, maxFiles }) => {
  const files = new Set();
  const skippedFiles = [];
  for (const mode of modes) {
    const modeFiles = await discoverFiles({
      root,
      mode,
      ignoreMatcher,
      skippedFiles,
      maxFileBytes,
      fileCaps,
      maxDepth,
      maxFiles
    });
    modeFiles.forEach((entry) => files.add(entry.abs || entry));
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
    onFire: () => incWatchDebounce('fired')
  });

  const recordAddOrChange = async (absPath) => {
    if (!isIndexablePath({ absPath, root, ignoreMatcher, modes })) return;
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
    if (!isIndexablePath({ absPath, root, ignoreMatcher, modes })) return;
    pendingPaths.add(absPath);
    setWatchBacklog(pendingPaths.size);
    if (trackedFiles.delete(absPath)) scheduleBuild();
  };

  const initialFiles = await scanFiles({ root, modes, ignoreMatcher, maxFileBytes, fileCaps, maxDepth, maxFiles });
  initialFiles.forEach((file) => trackedFiles.add(file));
  const pollingEnabled = Number.isFinite(Number(pollMs)) && Number(pollMs) > 0;
  const pollLabel = pollingEnabled ? ` polling ${Number(pollMs)}ms` : ' fs events';
  log(`[watch] Monitoring ${trackedFiles.size} file(s)${pollLabel}.`);

  const watcher = chokidar.watch(root, {
    persistent: true,
    ignoreInitial: true,
    ignored: buildIgnoredMatcher({ root, ignoreMatcher }),
    usePolling: pollingEnabled,
    interval: pollingEnabled ? Number(pollMs) : undefined,
    binaryInterval: pollingEnabled ? Number(pollMs) : undefined,
    awaitWriteFinish: debounceMs
      ? { stabilityThreshold: debounceMs, pollInterval: pollingEnabled ? Math.min(100, Number(pollMs)) : 100 }
      : false
  });

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

  watcher.on('add', (filePath) => {
    incWatchEvent('add');
    recordBurst();
    void recordAddOrChange(filePath);
  });
  watcher.on('change', (filePath) => {
    incWatchEvent('change');
    recordBurst();
    void recordAddOrChange(filePath);
  });
  watcher.on('unlink', (filePath) => {
    incWatchEvent('unlink');
    recordBurst();
    recordRemove(filePath);
  });
  watcher.on('error', (err) => {
    incWatchEvent('error');
    log(`[watch] Watcher error: ${err?.message || err}`);
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
