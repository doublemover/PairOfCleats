import fs from 'node:fs/promises';
import path from 'node:path';
import chokidar from 'chokidar';
import { acquireIndexLock } from './lock.js';
import { discoverFiles } from './discover.js';
import { buildIndexForMode } from './indexer.js';
import { EXTS_CODE, EXTS_PROSE, isSpecialCodeFile } from '../constants.js';
import { log } from '../../shared/progress.js';
import { fileExt, toPosix } from '../../shared/files.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createDebouncedScheduler({ debounceMs, onRun }) {
  let timer = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onRun();
    }, debounceMs);
  };
  const cancel = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };
  return { schedule, cancel };
}

export function isIndexablePath({ absPath, root, ignoreMatcher, modes }) {
  const relPosix = toPosix(path.relative(root, absPath));
  if (!relPosix || relPosix === '.' || relPosix.startsWith('..')) return false;
  if (ignoreMatcher?.ignores(relPosix)) return false;
  const ext = fileExt(absPath);
  const baseName = path.basename(absPath);
  const isSpecial = isSpecialCodeFile(baseName);
  const allowCode = modes.includes('code') && (EXTS_CODE.has(ext) || isSpecial);
  const allowProse = modes.includes('prose') && EXTS_PROSE.has(ext);
  return allowCode || allowProse;
}

const scanFiles = async ({ root, modes, ignoreMatcher, maxFileBytes }) => {
  const files = new Set();
  const skippedFiles = [];
  for (const mode of modes) {
    const modeFiles = await discoverFiles({ root, mode, ignoreMatcher, skippedFiles, maxFileBytes });
    modeFiles.forEach((entry) => files.add(entry.abs || entry));
  }
  return Array.from(files);
};

const isWithinMaxBytes = async (absPath, maxFileBytes) => {
  if (!Number.isFinite(Number(maxFileBytes)) || Number(maxFileBytes) <= 0) {
    return true;
  }
  try {
    const stat = await fs.stat(absPath);
    return stat.size <= maxFileBytes;
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
  runtime.incrementalEnabled = true;
  runtime.argv.incremental = true;

  let running = false;
  let pending = false;
  let shouldExit = false;
  let shutdownSignal = null;
  let resolveExit = null;
  const trackedFiles = new Set();
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
    const lock = await acquireIndexLock({ repoCacheRoot: runtime.repoCacheRoot, log });
    if (!lock) {
      running = false;
      return;
    }
    try {
      for (const mode of modes) {
        await buildIndexForMode({ mode, runtime });
      }
      log('[watch] Index update complete.');
    } finally {
      await lock.release();
      running = false;
    }
    if (pending) {
      pending = false;
      if (!shouldExit) scheduleBuild();
    }
  };

  scheduler = createDebouncedScheduler({ debounceMs, onRun: runBuild });

  const recordAddOrChange = async (absPath) => {
    if (!isIndexablePath({ absPath, root, ignoreMatcher, modes })) return;
    const withinMax = await isWithinMaxBytes(absPath, maxFileBytes);
    if (!withinMax) {
      if (trackedFiles.delete(absPath)) scheduleBuild();
      return;
    }
    trackedFiles.add(absPath);
    scheduleBuild();
  };

  const recordRemove = (absPath) => {
    if (!isIndexablePath({ absPath, root, ignoreMatcher, modes })) return;
    if (trackedFiles.delete(absPath)) scheduleBuild();
  };

  const initialFiles = await scanFiles({ root, modes, ignoreMatcher, maxFileBytes });
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

  watcher.on('add', (filePath) => {
    void recordAddOrChange(filePath);
  });
  watcher.on('change', (filePath) => {
    void recordAddOrChange(filePath);
  });
  watcher.on('unlink', (filePath) => {
    recordRemove(filePath);
  });
  watcher.on('error', (err) => {
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
