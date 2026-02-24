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
import { fileExt, isRelativePathEscape, toPosix } from '../../shared/files.js';
import { runWithConcurrency, runWithQueue } from '../../shared/concurrency.js';
import { createDebouncedScheduler } from '../../shared/scheduler/debounce.js';
import { getLanguageForFile } from '../language-registry.js';
import { createRecordsClassifier, shouldSniffRecordContent } from './records.js';
import { initBuildState, markBuildPhase, updateBuildState } from './build-state.js';
import { runBuildCleanupWithTimeout } from './cleanup-timeout.js';
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
import { normalizeRoot } from './watch/shared.js';
import { isCodeEntryForPath, isProseEntryForPath } from './mode-routing.js';
import { detectShebangLanguage } from './shebang.js';
import { isWithinRoot, toRealPathSync } from '../../workspace/identity.js';
import {
  buildGeneratedPolicyConfig,
  buildGeneratedPolicyDowngradePayload,
  resolveGeneratedPolicyDecision
} from './generated-policy.js';

export { createDebouncedScheduler, acquireIndexLockWithBackoff };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const canonicalRoot = toRealPathSync(root);
  const recordsRoot = resolveRecordsRoot(root, runtimeRef.recordsDir);
  const normalizedRecordsRoot = recordsRoot ? toRealPathSync(recordsRoot) : null;
  const ignoreMatcher = runtimeRef.ignoreMatcher;
  const generatedPolicy = runtimeRef.generatedPolicy && typeof runtimeRef.generatedPolicy === 'object'
    ? runtimeRef.generatedPolicy
    : buildGeneratedPolicyConfig({});
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
      const fallbackConcurrency = Number.isFinite(Number(runtimeRef.ioConcurrency))
        ? Math.max(1, Math.floor(Number(runtimeRef.ioConcurrency)))
        : 8;
      await runWithConcurrency(absPaths, fallbackConcurrency, async (absPath) => handleUpdate(absPath), {
        collectResults: false,
        signal: abortSignal
      });
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
    const drainPendingUpdateBatch = () => {
      const batch = Array.from(pendingUpdates);
      for (const absPath of batch) {
        pendingUpdates.delete(absPath);
      }
      return batch;
    };
    try {
      while (pendingUpdates.size) {
        const batch = drainPendingUpdateBatch();
        if (!batch.length) break;
        try {
          await applyTrackedUpdates(batch);
        } catch (err) {
          // Requeue the current batch so transient failures don't drop updates.
          for (const absPath of batch) {
            pendingUpdates.add(absPath);
          }
          throw err;
        }
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

  /**
   * Classify a changed path for watch-mode indexing, applying guardrails
   * (outside-root, depth, ignore, minified, size, symlink, records routing).
   *
   * @param {string} absPath
   * @returns {Promise<object>}
   */
  const classifyPath = async (absPath) => {
    const canonicalAbs = toRealPathSync(absPath);
    if (!isWithinRoot(canonicalAbs, canonicalRoot)) {
      return { skip: true, reason: 'outside-root' };
    }
    const relPosix = toPosix(path.relative(canonicalRoot, canonicalAbs));
    if (!relPosix || relPosix === '.' || isRelativePathEscape(relPosix)) {
      return { skip: true, reason: 'outside-root' };
    }
    const inRecordsRoot = normalizedRecordsRoot
      ? isWithinRoot(canonicalAbs, normalizedRecordsRoot)
      : false;
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
    let ext = resolveSpecialCodeExt(baseName) || fileExt(absPath);
    let stat;
    try {
      stat = await fs.lstat(absPath);
    } catch {
      return { skip: true, reason: 'stat-failed' };
    }
    if (stat.isSymbolicLink()) {
      return { skip: true, reason: 'symlink' };
    }
    let language = getLanguageForFile(ext, relPosix);
    if (!ext && !language && stat.isFile()) {
      const shebang = await detectShebangLanguage(absPath);
      if (shebang?.languageId) {
        ext = shebang.ext || ext;
        language = getLanguageForFile(ext, relPosix);
      }
    }
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
    if (inRecordsRoot) {
      record = { source: 'triage', recordType: 'record', reason: 'records-dir' };
    }
    if (!record && recordsClassifier) {
      const sampleText = shouldSniffRecordContent(ext)
        ? await readRecordSample(absPath, recordsClassifier.config?.sniffBytes)
        : '';
      record = recordsClassifier.classify({ absPath, relPath: relPosix, ext, sampleText });
    }
    // Preserve records routing even when generated-policy heuristics match.
    if (!record) {
      const generatedPolicyDecision = resolveGeneratedPolicyDecision({
        generatedPolicy,
        relPath: relPosix,
        absPath,
        baseName
      });
      if (generatedPolicyDecision?.downgrade) {
        return {
          skip: true,
          reason: generatedPolicyDecision.classification || 'generated',
          extra: {
            indexMode: generatedPolicyDecision.indexMode,
            downgrade: buildGeneratedPolicyDowngradePayload(generatedPolicyDecision)
          }
        };
      }
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

  /**
   * Reconcile one absolute path across all active modes and update tracked
   * entry/skip maps while maintaining cross-mode reference counts.
   *
   * @param {string} absPath
   * @returns {Promise<boolean>} true when tracked membership changed.
   */
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
      stat: classification.stat,
      ext: classification.ext
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
      const proseAllowed = isProseEntryForPath({
        ext: classification.ext,
        relPath: classification.relPosix
      });
      const codeAllowed = isCodeEntryForPath({
        ext: classification.ext,
        relPath: classification.relPosix,
        isSpecial: classification.isSpecial
      });
      const allowed = (isProse && proseAllowed)
        || (isCode && codeAllowed)
        || (mode === 'extracted-prose' && proseAllowed);
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

  /**
   * Execute one watch rebuild cycle:
   * acquire lock, build per mode from tracked discovery, validate, then
   * promote on success. If updates arrive mid-run, queue a follow-up cycle.
   *
   * @returns {Promise<void>}
   */
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
    let validationRunning = false;
    let validationDone = false;
    let promoteRunning = false;
    let promoteDone = false;
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
      try {
        await runBuildCleanupWithTimeout({
          label: 'watch.lock.release.shutdown',
          cleanup: () => lock.release(),
          log
        });
      } catch (err) {
        status = 'error';
        log(`[watch] Index lock release failed during shutdown: ${err?.message || err}`);
      }
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
        signatureVersion: SIGNATURE_VERSION,
        profile: attemptRuntime.profile || null
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
      validationRunning = true;
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
        validationDone = true;
        log('[watch] Index update failed validation; skipping promotion.');
      } else {
        await markBuildPhase(attemptRuntime.buildRoot, 'validation', 'done');
        validationDone = true;
        await markBuildPhase(attemptRuntime.buildRoot, 'promote', 'running');
        promoteRunning = true;
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
        promoteDone = true;
        log('[watch] Index update complete.');
      }
    } catch (err) {
      status = 'error';
      log(`[watch] Index update failed: ${err?.message || err}`);
    } finally {
      activeBuildAbort = null;
      if (attemptRuntime) {
        if (promoteRunning && !promoteDone) {
          try { await markBuildPhase(attemptRuntime.buildRoot, 'promote', 'failed'); } catch {}
        }
        if (validationRunning && !validationDone) {
          try { await markBuildPhase(attemptRuntime.buildRoot, 'validation', 'failed'); } catch {}
        }
        try {
          await markBuildPhase(
            attemptRuntime.buildRoot,
            'watch',
            status === 'ok' ? 'done' : 'failed'
          );
        } catch (err) {
          status = 'error';
          log(`[watch] Failed to write build phase state: ${err?.message || err}`);
        }
      }
      let releaseError = null;
      try {
        await runBuildCleanupWithTimeout({
          label: 'watch.lock.release',
          cleanup: () => lock.release(),
          log
        });
      } catch (err) {
        status = 'error';
        releaseError = err;
        log(`[watch] Index lock release failed: ${err?.message || err}`);
      }
      if (attempt) {
        await attemptManager.recordOutcome(attempt, status === 'ok');
      }
      running = false;
      observeWatchBuildDuration({
        status,
        seconds: Number(process.hrtime.bigint() - startTime) / 1e9
      });
      if (releaseError) {
        return;
      }
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
    scmProvider: runtimeRef.scmProvider,
    scmProviderImpl: runtimeRef.scmProviderImpl,
    scmRepoRoot: runtimeRef.scmRepoRoot,
    ignoreMatcher,
    generatedPolicy,
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

  await runBuildCleanupWithTimeout({
    label: 'watch.watcher.close',
    cleanup: () => watcher.close(),
    log
  });

  if (running) {
    log('[watch] Waiting for active build to finish...');
    await runBuildCleanupWithTimeout({
      label: 'watch.active-build.wait',
      cleanup: async () => {
        while (running) {
          await sleep(200);
        }
      },
      log
    });
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
