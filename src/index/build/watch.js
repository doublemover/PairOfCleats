import fs from 'node:fs/promises';
import path from 'node:path';
import { discoverFilesForModes } from './discover.js';
import { buildIndexForMode } from './indexer.js';
import { promoteBuild } from './promotion.js';
import { validateIndexArtifacts } from '../validate.js';
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
import { runWithQueue } from '../../shared/concurrency.js';
import { createDebouncedScheduler } from '../../shared/scheduler/debounce.js';
import { getLanguageForFile } from '../language-registry.js';
import { createRecordsClassifier, shouldSniffRecordContent } from './records.js';
import { initBuildState, markBuildPhase, updateBuildState } from './build-state.js';
import { SIGNATURE_VERSION } from './indexer/signatures.js';
import { buildIgnoredMatcher } from '../../shared/fs/ignore.js';
import { acquireIndexLockWithBackoff } from './watch/lock.js';
import { resolveWatcherBackend } from './watch/resolve-backend.js';
import { waitForStableFile } from './watch/stability.js';
import { resolveRecordsRoot, readRecordSample } from './watch/records.js';
import { resolveMaxBytesForFile, resolveMaxDepthCap, resolveMaxFilesCap, isIndexablePath } from './watch/guardrails.js';
import { startChokidarWatcher } from './watch/backends/chokidar.js';
import { startParcelWatcher } from './watch/backends/parcel.js';
import { createWatchAttemptManager } from './watch/attempts.js';

export { createDebouncedScheduler, acquireIndexLockWithBackoff };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MINIFIED_NAME_REGEX = /(?:\.min\.[^/]+$)|(?:-min\.[^/]+$)/i;

/**
 * Watch for file changes and rebuild indexes incrementally.
 * @param {{runtime:object,modes:string[],pollMs:number,debounceMs:number,abortSignal?:AbortSignal|null,handleSignals?:boolean,deps?:object,onReady?:Function}} input
 */
export async function watchIndex({
  runtime,
  modes,
  pollMs,
  debounceMs,
  abortSignal = null,
  handleSignals = true,
  deps = null,
  onReady = null
}) {
  const resolvedDeps = {
    acquireIndexLockWithBackoff,
    discoverFilesForModes,
    buildIndexForMode,
    validateIndexArtifacts,
    promoteBuild,
    createWatchAttemptManager,
    startChokidarWatcher,
    startParcelWatcher,
    resolveWatcherBackend,
    ...(deps || {})
  };
  const runtimeRef = {
    ...runtime,
    argv: { ...(runtime?.argv || {}), incremental: true },
    incrementalEnabled: true
  };
  const root = runtimeRef.root;
  const recordsRoot = resolveRecordsRoot(root, runtimeRef.recordsDir);
  const ignoreMatcher = runtimeRef.ignoreMatcher;
  const maxFileBytes = runtimeRef.maxFileBytes;
  const fileCaps = runtimeRef.fileCaps;
  const guardrails = runtimeRef.guardrails || {};
  const maxDepth = guardrails.maxDepth ?? null;
  const maxFiles = guardrails.maxFiles ?? null;
  const maxDepthCap = resolveMaxDepthCap(maxDepth);
  const maxFilesCap = resolveMaxFilesCap(maxFiles);
  const recordsClassifier = createRecordsClassifier({ root, config: runtimeRef.recordsConfig });
  const attemptManager = resolvedDeps.createWatchAttemptManager({
    repoRoot: root,
    userConfig: runtimeRef.userConfig,
    log
  });

  let running = false;
  let pending = false;
  let shouldExit = false;
  let shutdownSignal = null;
  let resolveExit = null;
  let activeBuildAbort = null;
  const exitPromise = new Promise((resolve) => {
    resolveExit = resolve;
  });
  const trackedEntriesByMode = new Map();
  const skippedEntriesByMode = new Map();
  const trackedCounts = new Map();
  const trackedFiles = new Set();
  const pendingPaths = new Set();
  const pendingUpdates = new Set();
  const burstWindowMs = 1000;
  const burstThreshold = 25;
  let burstStart = 0;
  let burstCount = 0;
  let burstMax = 0;
  let scheduler;
  let stabilityGuard = null;
  let updateScheduled = false;
  let updateRunning = false;

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
    scheduler?.cancel?.();
    if (activeBuildAbort && !activeBuildAbort.signal.aborted) {
      activeBuildAbort.abort();
    }
    log(`[watch] ${signal} received; shutting down...`);
    stop();
  };

  const handleSigint = () => requestShutdown('SIGINT');
  const handleSigterm = () => requestShutdown('SIGTERM');
  if (handleSignals) {
    process.on('SIGINT', handleSigint);
    process.on('SIGTERM', handleSigterm);
  }
  let abortHandler = null;
  if (abortSignal) {
    abortHandler = () => requestShutdown('ABORT');
    if (abortSignal.aborted) {
      abortHandler();
    } else {
      abortSignal.addEventListener('abort', abortHandler, { once: true });
    }
  }
  if (shouldExit) {
    stop();
    if (handleSignals) {
      process.off('SIGINT', handleSigint);
      process.off('SIGTERM', handleSigterm);
    }
    if (abortSignal && abortHandler) {
      abortSignal.removeEventListener('abort', abortHandler);
    }
    return;
  }

  const scheduleBuild = () => {
    if (shouldExit) return;
    scheduler?.schedule();
  };

  const applyTrackedUpdates = async (absPaths) => {
    const updateQueue = runtimeRef.queues?.io;
    const handleUpdate = async (absPath) => {
      const beforeTracked = trackedCounts.get(absPath) || 0;
      const changed = await updateTrackedEntry(absPath);
      const afterTracked = trackedCounts.get(absPath) || 0;
      if (beforeTracked > 0 || afterTracked > 0 || changed) scheduleBuild();
    };
    if (!updateQueue) {
      await Promise.all(absPaths.map((absPath) => handleUpdate(absPath)));
      return;
    }
    await runWithQueue(
      updateQueue,
      absPaths,
      async (absPath) => handleUpdate(absPath),
      {
        collectResults: false,
        bestEffort: true,
        signal: abortSignal,
        onError: (err, ctx) => {
          log(`[watch] Update failed for ${ctx?.item || 'file'}: ${err?.message || err}`);
        }
      }
    );
  };

  const flushPendingUpdates = async () => {
    if (updateRunning) return;
    updateRunning = true;
    try {
      while (pendingUpdates.size) {
        const batch = Array.from(pendingUpdates);
        pendingUpdates.clear();
        await applyTrackedUpdates(batch);
      }
    } catch (err) {
      if (!abortSignal?.aborted) {
        log(`[watch] Update queue failed: ${err?.message || err}`);
      }
    } finally {
      updateRunning = false;
    }
    if (pendingUpdates.size) {
      scheduleUpdateFlush();
    }
  };

  const scheduleUpdateFlush = () => {
    if (updateScheduled) return;
    updateScheduled = true;
    setImmediate(() => {
      updateScheduled = false;
      void flushPendingUpdates();
    });
  };

  const ensureModeMap = (mode) => {
    if (!trackedEntriesByMode.has(mode)) trackedEntriesByMode.set(mode, new Map());
    return trackedEntriesByMode.get(mode);
  };

  const ensureSkipMap = (mode) => {
    if (!skippedEntriesByMode.has(mode)) skippedEntriesByMode.set(mode, new Map());
    return skippedEntriesByMode.get(mode);
  };

  const recordSkip = (mode, absPath, reason, extra = {}) => {
    if (!mode) return;
    const map = ensureSkipMap(mode);
    map.set(absPath, { file: absPath, reason, ...extra });
  };

  const clearSkip = (mode, absPath) => {
    const map = skippedEntriesByMode.get(mode);
    if (map) map.delete(absPath);
  };

  const incrementTracked = (absPath) => {
    const count = trackedCounts.get(absPath) || 0;
    trackedCounts.set(absPath, count + 1);
    trackedFiles.add(absPath);
  };

  const decrementTracked = (absPath) => {
    const count = trackedCounts.get(absPath) || 0;
    if (count <= 1) {
      trackedCounts.delete(absPath);
      trackedFiles.delete(absPath);
      return;
    }
    trackedCounts.set(absPath, count - 1);
  };

  const removeEntryFromModes = (absPath) => {
    for (const [mode, map] of trackedEntriesByMode.entries()) {
      if (map.delete(absPath)) {
        decrementTracked(absPath);
      }
    }
  };

  const buildDiscoveryForMode = (mode) => {
    const map = trackedEntriesByMode.get(mode);
    const entries = map ? Array.from(map.values()) : [];
    const skippedMap = skippedEntriesByMode.get(mode);
    const skippedFiles = skippedMap ? Array.from(skippedMap.values()) : [];
    return { entries, skippedFiles };
  };

  const classifyPath = async (absPath) => {
    const relPosix = toPosix(path.relative(root, absPath));
    if (!relPosix || relPosix === '.' || relPosix.startsWith('..')) {
      return { skip: true, reason: 'outside-root' };
    }
    if (maxDepthCap != null) {
      const depth = relPosix.split('/').length - 1;
      if (depth > maxDepthCap) {
        return { skip: true, reason: 'max-depth', extra: { depth, maxDepth: maxDepthCap } };
      }
    }
    if (ignoreMatcher?.ignores(relPosix)) {
      return { skip: true, reason: 'ignored' };
    }
    const baseName = path.basename(absPath);
    if (MINIFIED_NAME_REGEX.test(baseName.toLowerCase())) {
      return { skip: true, reason: 'minified', extra: { method: 'name' } };
    }
    const ext = resolveSpecialCodeExt(baseName) || fileExt(absPath);
    let stat;
    try {
      stat = await fs.lstat(absPath);
    } catch {
      return { skip: true, reason: 'stat-failed' };
    }
    if (stat.isSymbolicLink()) {
      return { skip: true, reason: 'symlink' };
    }
    const language = getLanguageForFile(ext, relPosix);
    const maxBytesForFile = resolveMaxBytesForFile(ext, language?.id || null, maxFileBytes, fileCaps);
    if (maxBytesForFile && stat.size > maxBytesForFile) {
      return {
        skip: true,
        reason: 'oversize',
        extra: {
          stage: 'watch',
          capSource: 'maxBytes',
          bytes: stat.size,
          maxBytes: maxBytesForFile
        }
      };
    }
    const isSpecialLanguage = !!language && !EXTS_CODE.has(ext) && !EXTS_PROSE.has(ext);
    const isSpecial = isSpecialCodeFile(baseName) || isManifestFile(baseName) || isLockFile(baseName) || isSpecialLanguage;
    let record = null;
    const normalizedRecordsRoot = recordsRoot ? normalizeRoot(recordsRoot) : null;
    if (normalizedRecordsRoot) {
      const normalizedAbs = normalizeRoot(absPath);
      if (normalizedAbs.startsWith(`${normalizedRecordsRoot}${path.sep}`)) {
        record = { source: 'triage', recordType: 'record', reason: 'records-dir' };
      }
    }
    if (!record && recordsClassifier) {
      const sampleText = shouldSniffRecordContent(ext)
        ? await readRecordSample(absPath, recordsClassifier.config?.sniffBytes)
        : '';
      record = recordsClassifier.classify({ absPath, relPath: relPosix, ext, sampleText });
    }
    return {
      skip: false,
      relPosix,
      ext,
      stat,
      record,
      isSpecial
    };
  };

  const updateTrackedEntry = async (absPath) => {
    const beforeCount = trackedCounts.get(absPath) || 0;
    const classification = await classifyPath(absPath);
    if (classification.skip) {
      if (beforeCount > 0) removeEntryFromModes(absPath);
      for (const mode of modes) {
        recordSkip(mode, absPath, classification.reason, classification.extra || {});
      }
      return beforeCount > 0;
    }
    if (maxFilesCap && beforeCount === 0 && trackedCounts.size >= maxFilesCap) {
      for (const mode of modes) {
        recordSkip(mode, absPath, 'max-files', { maxFiles: maxFilesCap });
      }
      return false;
    }
    const baseEntry = {
      abs: absPath,
      rel: classification.relPosix,
      stat: classification.stat
    };
    for (const mode of modes) {
      if (classification.record) {
        if (mode === 'records') {
          const map = ensureModeMap(mode);
          if (!map.has(absPath)) incrementTracked(absPath);
          map.set(absPath, { ...baseEntry, record: classification.record });
          clearSkip(mode, absPath);
        } else {
          const map = ensureModeMap(mode);
          if (map.delete(absPath)) decrementTracked(absPath);
          recordSkip(mode, absPath, 'records', {
            recordType: classification.record.recordType || null
          });
        }
        continue;
      }
      if (mode === 'records') {
        const map = ensureModeMap(mode);
        if (map.delete(absPath)) decrementTracked(absPath);
        recordSkip(mode, absPath, 'unsupported');
        continue;
      }
      const isProse = mode === 'prose';
      const isCode = mode === 'code' || mode === 'extracted-prose';
      const allowed = (isProse && EXTS_PROSE.has(classification.ext))
        || (isCode && (EXTS_CODE.has(classification.ext) || classification.isSpecial))
        || (mode === 'extracted-prose' && EXTS_PROSE.has(classification.ext));
      const map = ensureModeMap(mode);
      if (allowed) {
        if (!map.has(absPath)) incrementTracked(absPath);
        map.set(absPath, baseEntry);
        clearSkip(mode, absPath);
      } else {
        if (map.delete(absPath)) decrementTracked(absPath);
        recordSkip(mode, absPath, 'unsupported');
      }
    }
    const afterCount = trackedCounts.get(absPath) || 0;
    return beforeCount !== afterCount;
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
    let attempt = null;
    let attemptRuntime = null;
    lock = await resolvedDeps.acquireIndexLockWithBackoff({
      repoCacheRoot: runtimeRef.repoCacheRoot,
      shouldExit: () => shouldExit,
      log
    });
    if (!lock) {
      status = 'unknown';
      running = false;
      pending = true;
      if (!shouldExit) scheduleBuild();
      return;
    }
    if (shouldExit) {
      await lock.release();
      running = false;
      return;
    }
    attempt = await attemptManager.createAttempt();
    attemptRuntime = {
      ...runtimeRef,
      buildId: attempt.buildId,
      buildRoot: attempt.buildRoot
    };
    activeBuildAbort = new AbortController();
    const batchSize = pendingPaths.size;
    if (batchSize > 0) {
      pendingPaths.clear();
      setWatchBacklog(0);
      log(`[watch] Rebuilding index for ${batchSize} change(s)...`);
    }
    try {
      await initBuildState({
        buildRoot: attemptRuntime.buildRoot,
        buildId: attemptRuntime.buildId,
        repoRoot: attemptRuntime.root,
        modes,
        stage: attemptRuntime.stage,
        configHash: attemptRuntime.configHash,
        toolVersion: attemptRuntime.toolInfo?.version || null,
        repoProvenance: attemptRuntime.repoProvenance,
        signatureVersion: SIGNATURE_VERSION
      });
      if (attemptRuntime?.ignoreFiles?.length || attemptRuntime?.ignoreWarnings?.length) {
        await updateBuildState(attemptRuntime.buildRoot, {
          ignore: {
            files: attemptRuntime.ignoreFiles || [],
            warnings: attemptRuntime.ignoreWarnings?.length ? attemptRuntime.ignoreWarnings : null
          }
        });
      }
      await markBuildPhase(attemptRuntime.buildRoot, 'watch', 'running');
      for (const mode of modes) {
        if (shouldExit) {
          status = 'aborted';
          break;
        }
        const discovery = buildDiscoveryForMode(mode);
        await resolvedDeps.buildIndexForMode({
          mode,
          runtime: attemptRuntime,
          discovery,
          abortSignal: activeBuildAbort.signal,
          shouldExit: () => shouldExit
        });
      }
      if (shouldExit && status === 'ok') {
        status = 'aborted';
      }
      if (status !== 'ok') {
        return;
      }
      await markBuildPhase(attemptRuntime.buildRoot, 'validation', 'running');
      const validation = await resolvedDeps.validateIndexArtifacts({
        root: attemptRuntime.root,
        indexRoot: attemptRuntime.buildRoot,
        modes,
        userConfig: attemptRuntime.userConfig,
        sqliteEnabled: false
      });
      const validationSummary = {
        ok: validation.ok,
        issueCount: validation.issues.length,
        warningCount: validation.warnings.length,
        issues: validation.ok ? null : validation.issues.slice(0, 10)
      };
      await updateBuildState(attemptRuntime.buildRoot, { validation: validationSummary });
      if (!validation.ok) {
        status = 'error';
        await markBuildPhase(attemptRuntime.buildRoot, 'validation', 'failed');
        log('[watch] Index update failed validation; skipping promotion.');
      } else {
        await markBuildPhase(attemptRuntime.buildRoot, 'validation', 'done');
        await markBuildPhase(attemptRuntime.buildRoot, 'promote', 'running');
        await resolvedDeps.promoteBuild({
          repoRoot: attemptRuntime.root,
          userConfig: attemptRuntime.userConfig,
          buildId: attemptRuntime.buildId,
          buildRoot: attemptRuntime.buildRoot,
          stage: attemptRuntime.stage,
          modes,
          configHash: attemptRuntime.configHash,
          repoProvenance: attemptRuntime.repoProvenance,
          compatibilityKey: attemptRuntime.compatibilityKey || null
        });
        await markBuildPhase(attemptRuntime.buildRoot, 'promote', 'done');
        log('[watch] Index update complete.');
      }
    } catch (err) {
      status = 'error';
      log(`[watch] Index update failed: ${err?.message || err}`);
    } finally {
      activeBuildAbort = null;
      if (attemptRuntime) {
        await markBuildPhase(
          attemptRuntime.buildRoot,
          'watch',
          status === 'ok' ? 'done' : 'failed'
        );
      }
      if (attempt) {
        await attemptManager.recordOutcome(attempt, status === 'ok');
      }
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
    if (stabilityGuard?.enabled) {
      const stable = await waitForStableFile(absPath, stabilityGuard);
      if (!stable) return;
    }
    pendingPaths.add(absPath);
    setWatchBacklog(pendingPaths.size);
    pendingUpdates.add(absPath);
    scheduleUpdateFlush();
  };

  const recordRemove = (absPath) => {
    pendingPaths.add(absPath);
    setWatchBacklog(pendingPaths.size);
    const before = trackedCounts.get(absPath) || 0;
    if (before > 0) {
      removeEntryFromModes(absPath);
      scheduleBuild();
    }
  };

  const skippedByMode = {};
  const discoveredByMode = await resolvedDeps.discoverFilesForModes({
    root,
    modes,
    recordsDir: runtimeRef.recordsDir,
    recordsConfig: runtimeRef.recordsConfig,
    ignoreMatcher,
    skippedByMode,
    maxFileBytes,
    fileCaps,
    maxDepth: maxDepthCap,
    maxFiles: maxFilesCap
  });
  for (const mode of modes) {
    const entries = Array.isArray(discoveredByMode[mode]) ? discoveredByMode[mode] : [];
    const modeMap = ensureModeMap(mode);
    for (const entry of entries) {
      if (!entry?.abs) continue;
      if (!modeMap.has(entry.abs)) incrementTracked(entry.abs);
      modeMap.set(entry.abs, entry);
    }
    const skippedList = Array.isArray(skippedByMode[mode]) ? skippedByMode[mode] : [];
    const skipMap = ensureSkipMap(mode);
    for (const skipped of skippedList) {
      if (skipped?.file) skipMap.set(skipped.file, skipped);
    }
  }
  const backendSelection = resolvedDeps.resolveWatcherBackend({ runtime: runtimeRef, pollMs });
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
  const watcher = resolvedDeps.startWatcher
    ? await resolvedDeps.startWatcher({
      root,
      ignored,
      onEvent: handleEvent,
      onError: handleError,
      pollMs,
      awaitWriteFinishMs: debounceMs,
      backend: backendSelection.resolved
    })
    : (backendSelection.resolved === 'parcel'
      ? await resolvedDeps.startParcelWatcher({ root, ignored, onEvent: handleEvent, onError: handleError })
      : resolvedDeps.startChokidarWatcher({
        root,
        ignored,
        onEvent: handleEvent,
        onError: handleError,
        pollMs,
        awaitWriteFinishMs: debounceMs
      }));

  if (typeof onReady === 'function') {
    onReady();
  }

  if (shouldExit) stop();
  await exitPromise;

  await watcher.close();

  if (running) {
    log('[watch] Waiting for active build to finish...');
    while (running) {
      await sleep(200);
    }
  }
  if (handleSignals) {
    process.off('SIGINT', handleSigint);
    process.off('SIGTERM', handleSigterm);
  }
  if (abortSignal && abortHandler) {
    abortSignal.removeEventListener('abort', abortHandler);
  }
  log(`[watch] Shutdown complete${shutdownSignal ? ` (${shutdownSignal})` : ''}.`);
}

export { resolveWatcherBackend, waitForStableFile, isIndexablePath };
