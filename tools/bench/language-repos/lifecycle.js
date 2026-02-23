import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { retainCrashArtifacts } from '../../../src/index/build/crash-log.js';
import { isInside, isRootPath } from '../../shared/path-utils.js';
import { ensureRepoBenchmarkReady, tryMirrorClone } from '../language/repos.js';

/**
 * Ensure repository-local benchmark config exists so bench runs inherit the
 * shared cache root even when a repo has no local settings yet.
 *
 * @param {string} repoPath
 * @param {string} cacheRoot
 * @returns {Promise<void>}
 */
export const ensureBenchConfig = async (repoPath, cacheRoot) => {
  const configPath = path.join(repoPath, '.pairofcleats.json');
  if (fs.existsSync(configPath)) return;
  const payload = { cache: { root: cacheRoot } };
  await fsPromises.writeFile(configPath, JSON.stringify(payload, null, 2), 'utf8');
};

/**
 * @typedef {object} RepoLifecycle
 * @property {(repoPath:string) => boolean} hasRepoPath
 * @property {(input:{task:object,repoPath:string,repoLabel:string}) => Promise<{ok:boolean,failureCode?:number|null,schedulerEvents?:object[]}>} ensureRepoPresent
 * @property {(input:{repoPath:string}) => Promise<void>} prepareRepoWorkspace
 * @property {(input:{repoCacheRoot:string,repoLabel:string}) => Promise<void>} cleanRepoCache
 * @property {(input:{
 *   task:object,
 *   repoLabel:string,
 *   repoPath:string,
 *   repoCacheRoot:string,
 *   outFile:string|null,
 *   failureReason:string,
 *   failureCode?:number|null,
 *   schedulerEvents?:object[]
 * }) => Promise<object|null>} attachCrashRetention
 */

/**
 * Create helpers that own repo lifecycle operations for one benchmark run.
 *
 * @param {{
 *   appendLog:(line:string,level?:'info'|'warn'|'error',meta?:object|null) => void,
 *   display:object,
 *   processRunner:object,
 *   cloneEnabled:boolean,
 *   dryRun:boolean,
 *   keepCache:boolean,
 *   cloneTool:object|null,
 *   cloneCommandEnv:object,
 *   mirrorCacheRoot:string,
 *   mirrorRefreshMs:number,
 *   cacheRoot:string,
 *   runDiagnosticsRoot:string,
 *   runSuffix:string,
 *   benchEnvironmentMetadata:object,
 *   logHistory:string[],
 *   exitWithDisplay:(code:number) => void
 * }} input
 * @returns {RepoLifecycle}
 */
export const createRepoLifecycle = ({
  appendLog,
  display,
  processRunner,
  cloneEnabled,
  dryRun,
  keepCache,
  cloneTool,
  cloneCommandEnv,
  mirrorCacheRoot,
  mirrorRefreshMs,
  cacheRoot,
  runDiagnosticsRoot,
  runSuffix,
  benchEnvironmentMetadata,
  logHistory,
  exitWithDisplay
}) => {
  const resolvedCacheRoot = path.resolve(cacheRoot);
  const repoPresenceCache = new Map();
  const ensuredBenchConfig = new Set();

  const hasRepoPath = (repoPath) => {
    if (repoPresenceCache.has(repoPath)) return repoPresenceCache.get(repoPath) === true;
    const exists = fs.existsSync(repoPath);
    repoPresenceCache.set(repoPath, exists);
    return exists;
  };

  const markRepoPath = (repoPath, exists) => {
    repoPresenceCache.set(repoPath, Boolean(exists));
  };

  /**
   * Ensure a repo exists on disk, optionally cloning when missing.
   *
   * @param {{task:object,repoPath:string,repoLabel:string}} input
   * @returns {Promise<{ok:boolean,failureCode?:number|null,schedulerEvents?:object[]}>}
   */
  const ensureRepoPresent = async ({ task, repoPath, repoLabel }) => {
    if (hasRepoPath(repoPath)) return { ok: true };
    if (!cloneEnabled && !dryRun) {
      display.error(`Missing repo ${task.repo} at ${repoPath}. Re-run with --clone.`);
      exitWithDisplay(1);
      return { ok: false };
    }
    if (dryRun || !cloneEnabled || !cloneTool) return { ok: true };

    let clonedFromMirror = false;
    if (cloneTool.supportsMirrorClone) {
      const mirrorClone = tryMirrorClone({
        repo: task.repo,
        repoPath,
        mirrorCacheRoot,
        mirrorRefreshMs,
        onLog: appendLog
      });
      if (mirrorClone.ok) {
        clonedFromMirror = true;
        appendLog(`[clone] mirror ${mirrorClone.mirrorAction} for ${repoLabel}.`, 'info', {
          fileOnlyLine: `[clone] mirror ${mirrorClone.mirrorAction} ${task.repo} -> ${repoPath} (${mirrorClone.mirrorPath})`
        });
      } else if (mirrorClone.attempted) {
        appendLog(
          `[clone] mirror unavailable for ${repoLabel}; falling back to direct clone (${mirrorClone.reason || 'unknown'}).`,
          'warn'
        );
        try {
          await fsPromises.rm(repoPath, { recursive: true, force: true });
        } catch {}
      }
    }
    if (!clonedFromMirror) {
      const args = cloneTool.buildArgs(task.repo, repoPath);
      const cloneResult = await processRunner.runProcess(`clone ${task.repo}`, cloneTool.label, args, {
        env: cloneCommandEnv,
        continueOnError: true
      });
      if (!cloneResult.ok) {
        markRepoPath(repoPath, false);
        return {
          ok: false,
          failureCode: cloneResult.code ?? null,
          schedulerEvents: cloneResult.schedulerEvents || []
        };
      }
    }
    markRepoPath(repoPath, true);
    return { ok: true };
  };

  /**
   * Run repo-local preflight and ensure repo-scoped bench config once.
   *
   * @param {{repoPath:string}} input
   * @returns {Promise<void>}
   */
  const prepareRepoWorkspace = async ({ repoPath }) => {
    if (!dryRun) {
      ensureRepoBenchmarkReady({
        repoPath,
        onLog: appendLog
      });
    }
    if (!ensuredBenchConfig.has(repoPath)) {
      await ensureBenchConfig(repoPath, cacheRoot);
      ensuredBenchConfig.add(repoPath);
    }
  };

  /**
   * Remove repo cache while guarding against deleting paths outside cache root.
   *
   * @param {{repoCacheRoot:string,repoLabel:string}} input
   * @returns {Promise<void>}
   */
  const cleanRepoCache = async ({ repoCacheRoot, repoLabel }) => {
    if (keepCache || dryRun || !repoCacheRoot) return;
    try {
      const resolvedRepoCacheRoot = path.resolve(repoCacheRoot);
      if (!isInside(resolvedCacheRoot, resolvedRepoCacheRoot) || isRootPath(resolvedRepoCacheRoot)) {
        appendLog('[cache] skip cleanup; repo cache path escaped cache root.', 'warn', {
          fileOnlyLine: `[cache] Skip cleanup; repo cache path not under cache root (${resolvedRepoCacheRoot}).`
        });
        return;
      }
      if (!fs.existsSync(resolvedRepoCacheRoot)) return;
      await fsPromises.rm(resolvedRepoCacheRoot, { recursive: true, force: true });
      appendLog(`[cache] cleaned ${repoLabel}.`);
    } catch (err) {
      appendLog(`[cache] cleanup failed for ${repoLabel}: ${err?.message || err}`, 'warn');
    }
  };

  /**
   * Persist crash diagnostics bundle metadata for failed repo runs.
   *
   * @param {{
   *   task:object,
   *   repoLabel:string,
   *   repoPath:string,
   *   repoCacheRoot:string,
   *   outFile:string|null,
   *   failureReason:string,
   *   failureCode?:number|null,
   *   schedulerEvents?:object[]
   * }} input
   * @returns {Promise<object|null>}
   */
  const attachCrashRetention = async ({
    task,
    repoLabel,
    repoPath,
    repoCacheRoot,
    outFile,
    failureReason,
    failureCode = null,
    schedulerEvents = []
  }) => {
    if (dryRun || !repoCacheRoot) return null;
    try {
      const crashRetention = await retainCrashArtifacts({
        repoCacheRoot,
        diagnosticsRoot: runDiagnosticsRoot,
        repoLabel,
        repoSlug: task?.logSlug || null,
        runId: runSuffix,
        failure: {
          reason: failureReason || 'unknown',
          code: Number.isFinite(Number(failureCode)) ? Number(failureCode) : null
        },
        runtime: {
          runSuffix,
          language: task?.language || null,
          tier: task?.tier || null,
          repo: task?.repo || null,
          repoPath,
          repoCacheRoot,
          outFile: outFile || null
        },
        environment: benchEnvironmentMetadata,
        schedulerEvents: Array.isArray(schedulerEvents) ? schedulerEvents : [],
        logTail: logHistory.slice(-20)
      });
      if (crashRetention?.bundlePath) {
        appendLog(`[diagnostics] retained crash evidence for ${repoLabel}.`, 'warn', {
          fileOnlyLine: `[diagnostics] Crash bundle: ${crashRetention.bundlePath}`
        });
      }
      return crashRetention;
    } catch (err) {
      appendLog(`[diagnostics] retention failed for ${repoLabel}: ${err?.message || err}`, 'warn');
      return null;
    }
  };

  return {
    hasRepoPath,
    ensureRepoPresent,
    prepareRepoWorkspace,
    cleanRepoCache,
    attachCrashRetention
  };
};
