import fs from 'node:fs/promises';
import { acquireIndexLock } from './lock.js';
import { discoverFiles } from './discover.js';
import { buildIndexForMode } from './indexer.js';
import { log } from '../../shared/progress.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scanFiles = async ({ root, modes, ignoreMatcher, maxFileBytes }) => {
  const files = new Set();
  const skippedFiles = [];
  for (const mode of modes) {
    const modeFiles = await discoverFiles({ root, mode, ignoreMatcher, skippedFiles, maxFileBytes });
    modeFiles.forEach((file) => files.add(file));
  }
  return Array.from(files);
};

const statFiles = async (files) => {
  const stats = new Map();
  for (const file of files) {
    try {
      const stat = await fs.stat(file);
      stats.set(file, { mtimeMs: stat.mtimeMs, size: stat.size });
    } catch {}
  }
  return stats;
};

const hasChanges = (prev, next) => {
  for (const [file, stat] of next.entries()) {
    const before = prev.get(file);
    if (!before || before.mtimeMs !== stat.mtimeMs || before.size !== stat.size) return true;
  }
  for (const file of prev.keys()) {
    if (!next.has(file)) return true;
  }
  return false;
};

/**
 * Poll for file changes and rebuild indexes incrementally.
 * @param {{runtime:object,modes:string[],pollMs:number,debounceMs:number}} input
 */
export async function watchIndex({ runtime, modes, pollMs, debounceMs }) {
  const root = runtime.root;
  const ignoreMatcher = runtime.ignoreMatcher;
  const maxFileBytes = runtime.maxFileBytes;
  runtime.incrementalEnabled = true;
  runtime.argv.incremental = true;

  let prevStats = new Map();
  let running = false;
  let pending = false;
  let scanRunning = false;
  let debounceTimer = null;
  let shouldExit = false;
  let shutdownSignal = null;

  const requestShutdown = (signal) => {
    if (shouldExit) return;
    shouldExit = true;
    shutdownSignal = signal;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    log(`[watch] ${signal} received; shutting down...`);
  };
  const handleSigint = () => requestShutdown('SIGINT');
  const handleSigterm = () => requestShutdown('SIGTERM');
  process.on('SIGINT', handleSigint);
  process.on('SIGTERM', handleSigterm);

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

  const scheduleBuild = () => {
    if (shouldExit) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runBuild, debounceMs);
  };

  const initialFiles = await scanFiles({ root, modes, ignoreMatcher, maxFileBytes });
  prevStats = await statFiles(initialFiles);
  log(`[watch] Monitoring ${prevStats.size} file(s) every ${pollMs}ms.`);

  while (!shouldExit) {
    if (scanRunning) {
      await sleep(pollMs);
      continue;
    }
    scanRunning = true;
    try {
      const files = await scanFiles({ root, modes, ignoreMatcher, maxFileBytes });
      const nextStats = await statFiles(files);
      if (hasChanges(prevStats, nextStats)) {
        log('[watch] Change detected; scheduling incremental rebuild.');
        prevStats = nextStats;
        scheduleBuild();
      }
    } catch (err) {
      log(`[watch] Scan failed: ${err.message || err}`);
    } finally {
      scanRunning = false;
    }
    await sleep(pollMs);
  }

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
