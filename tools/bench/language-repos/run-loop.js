import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { formatEtaSeconds } from '../../../src/shared/perf/eta.js';
import { getRuntimeConfig, loadUserConfig, resolveRuntimeEnv } from '../../shared/dict-utils.js';
import { checkIndexLock, formatLockDetail } from '../language/locks.js';
import {
  buildLineStats,
  formatGb,
  formatMetricSummary,
  getRecommendedHeapMb,
  stripMaxOldSpaceFlag
} from '../language/metrics.js';
import { needsIndexArtifacts, needsSqliteArtifacts } from '../language/repos.js';

/**
 * @typedef {object} BenchProgressEvent
 * @property {string} [event]
 * @property {string} [status]
 * @property {string} [name]
 * @property {string} [taskId]
 * @property {string} [stage]
 * @property {string} [mode]
 * @property {number} [current]
 * @property {number} [total]
 * @property {string} [message]
 * @property {number} [etaSeconds]
 * @property {object} [throughput]
 * @property {number} [chunksPerSec]
 * @property {number} [filesPerSec]
 * @property {object} [cache]
 * @property {number} [cacheHitRate]
 * @property {object} [writer]
 * @property {number} [writerPending]
 * @property {number} [writerMaxPending]
 * @property {object} [meta]
 * @property {boolean} [ephemeral]
 */

/**
 * Normalize tier labels for progress header rendering.
 *
 * @param {unknown} tier
 * @returns {string}
 */
const formatBenchTierTag = (tier) => {
  if (!tier) return '';
  const label = String(tier).trim().toLowerCase();
  return label || '';
};

/**
 * Create a short repo-specific progress task label.
 *
 * @param {unknown} repo
 * @returns {string}
 */
const formatBenchRepoLabel = (repo) => {
  if (!repo) return 'Benching';
  const repoName = String(repo).split('/').filter(Boolean).pop() || repo;
  return `Benching ${repoName}`;
};

/**
 * Clamp a bench progress value to [0, 1].
 *
 * @param {number} value
 * @returns {number}
 */
const clampBenchFraction = (value) => {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

/**
 * Derive fractional completion from progress events.
 *
 * @param {BenchProgressEvent|object|null} event
 * @returns {number|null}
 */
const deriveBenchFraction = (event) => {
  const current = Number.isFinite(event?.current) ? Number(event.current) : 0;
  const total = Number.isFinite(event?.total) ? Number(event.total) : 0;
  if (total <= 0) return null;
  return clampBenchFraction(current / total);
};

/**
 * Build a compact status line from structured child task telemetry.
 *
 * @param {BenchProgressEvent|object|null} event
 * @returns {string|null}
 */
const formatChildTaskMessage = (event) => {
  if (!event || typeof event !== 'object') return null;
  const explicit = typeof event.message === 'string' ? event.message.trim() : '';
  if (explicit) return explicit;
  const throughputChunks = Number(event?.throughput?.chunksPerSec ?? event?.chunksPerSec);
  const throughputFiles = Number(event?.throughput?.filesPerSec ?? event?.filesPerSec);
  const etaText = formatEtaSeconds(event?.etaSeconds, { preferHours: false });
  const cacheHitRate = Number(event?.cache?.hitRate ?? event?.cacheHitRate);
  const writerPending = Number(event?.writer?.pending ?? event?.writerPending);
  const writerMax = Number(event?.writer?.currentMaxPending ?? event?.writerMaxPending);
  const parts = [];
  if (Number.isFinite(throughputFiles) && throughputFiles > 0) {
    parts.push(`${throughputFiles.toFixed(1)} files/s`);
  }
  if (Number.isFinite(throughputChunks) && throughputChunks > 0) {
    parts.push(`${throughputChunks.toFixed(1)} chunks/s`);
  }
  if (etaText) {
    parts.push(`eta ${etaText}`);
  }
  if (Number.isFinite(cacheHitRate)) {
    parts.push(`cache ${cacheHitRate.toFixed(1)}%`);
  }
  if (Number.isFinite(writerPending) && Number.isFinite(writerMax) && writerMax > 0) {
    parts.push(`writer ${writerPending}/${writerMax}`);
  }
  return parts.length ? parts.join(' | ') : null;
};

/**
 * @typedef {object} BenchProgressRuntime
 * @property {(event:object) => void} handleProgressEvent
 * @property {(total:number) => void} setTotal
 * @property {(input:{tierLabel:string,repo:string}) => void} beginRepo
 * @property {() => void} update
 * @property {() => void} completeRepo
 */

/**
 * Create run-progress state plus child-progress event mapping.
 *
 * @param {{display:object,appendLog:(line:string,level?:'info'|'warn'|'error',meta?:object|null) => void,totalRepos:number}} input
 * @returns {BenchProgressRuntime}
 */
export const createBenchProgressRuntime = ({ display, appendLog, totalRepos }) => {
  let benchTotal = Number.isFinite(Number(totalRepos)) && Number(totalRepos) > 0
    ? Number(totalRepos)
    : 0;
  let completed = 0;
  let benchTierTag = '';
  let benchRepoLabel = '';
  let benchInFlightFraction = 0;
  let benchTask = null;

  const updateBenchProgress = ({ ensureTask = false } = {}) => {
    if (!benchTask && ensureTask) {
      benchTask = display.task('Repos', { total: benchTotal, stage: 'bench' });
    }
    if (!benchTask) return;
    const reposLabel = benchTierTag ? `Repos (${benchTierTag})` : 'Repos';
    const effectiveCompleted = Math.min(benchTotal, completed + benchInFlightFraction);
    benchTask.set(effectiveCompleted, benchTotal, { name: reposLabel });
  };

  const setBenchInFlightFraction = (value, { refresh = true } = {}) => {
    const next = clampBenchFraction(value);
    if (next === benchInFlightFraction) return;
    benchInFlightFraction = next;
    if (refresh) updateBenchProgress();
  };

  /**
   * Consume child progress events and map them to interactive renderer state.
   *
   * @param {object} event
   * @returns {void}
   */
  const handleProgressEvent = (event) => {
    if (!event || typeof event !== 'object') return;
    if (event.event === 'log') {
      const message = event.message || '';
      const level = event.level || 'info';
      const meta = event.meta && typeof event.meta === 'object' ? event.meta : null;
      appendLog(message, level, meta);
      return;
    }
    const rawName = event.name || event.taskId || 'task';
    const isOverall = (event.stage || '').toLowerCase() === 'overall'
      || String(rawName).trim().toLowerCase() === 'overall';
    if (isOverall) {
      const fraction = deriveBenchFraction(event);
      if (event.event === 'task:end') {
        setBenchInFlightFraction(event.status === 'failed' ? 0 : 1);
      } else if (fraction !== null) {
        setBenchInFlightFraction(fraction);
      } else if (event.event === 'task:start') {
        setBenchInFlightFraction(0);
      }
    }
    const name = isOverall && benchRepoLabel ? benchRepoLabel : rawName;
    const taskId = isOverall && benchRepoLabel ? 'bench:current' : (event.taskId || name);
    const total = Number.isFinite(event.total) && event.total > 0 ? event.total : null;
    const task = display.task(name, {
      taskId,
      stage: event.stage,
      mode: event.mode,
      total,
      ephemeral: event.ephemeral === true
    });
    const taskMessage = formatChildTaskMessage(event);
    const taskMeta = {
      ...event,
      message: taskMessage,
      name
    };
    const current = Number.isFinite(event.current) ? event.current : 0;
    if (event.event === 'task:start') {
      task.set(current, total, taskMeta);
      return;
    }
    if (event.event === 'task:progress') {
      task.set(current, total, taskMeta);
      return;
    }
    if (event.event === 'task:end') {
      if (event.status === 'failed') {
        task.fail(new Error(taskMessage || 'failed'));
      } else {
        task.done(taskMeta);
      }
    }
  };

  const setTotal = (total) => {
    if (!Number.isFinite(Number(total)) || Number(total) < 0) return;
    benchTotal = Number(total);
    updateBenchProgress({ ensureTask: benchTotal > 0 });
  };

  const beginRepo = ({ tierLabel, repo }) => {
    benchTierTag = formatBenchTierTag(tierLabel) || benchTierTag;
    benchRepoLabel = formatBenchRepoLabel(repo);
    setBenchInFlightFraction(0, { refresh: false });
    display.resetTasks({ preserveStages: ['bench'] });
    updateBenchProgress({ ensureTask: true });
  };

  const completeRepo = () => {
    setBenchInFlightFraction(0, { refresh: false });
    completed += 1;
    updateBenchProgress({ ensureTask: true });
  };

  return {
    handleProgressEvent,
    setTotal,
    beginRepo,
    update: updateBenchProgress,
    completeRepo
  };
};

const formatLineStatsSummary = (stats) => {
  const totals = stats?.totals || {};
  const parts = [
    `code=${Number(totals.code || 0).toLocaleString()}`,
    `prose=${Number(totals.prose || 0).toLocaleString()}`,
    `extracted-prose=${Number(totals['extracted-prose'] || 0).toLocaleString()}`,
    `records=${Number(totals.records || 0).toLocaleString()}`
  ];
  return parts.join(' ');
};

/**
 * Build child bench command args for one repo plan.
 *
 * @param {{
 *   benchScript:string,
 *   repoPath:string,
 *   queriesPath:string,
 *   outFile:string,
 *   autoBuildIndex:boolean,
 *   autoBuildSqlite:boolean,
 *   buildRequested:boolean,
 *   buildIndexFlag:boolean,
 *   buildSqliteFlag:boolean,
 *   benchArgsPrefix:string[],
 *   benchArgsSuffix:string[]
 * }} input
 * @returns {string[]}
 */
const buildBenchArgs = ({
  benchScript,
  repoPath,
  queriesPath,
  outFile,
  autoBuildIndex,
  autoBuildSqlite,
  buildRequested,
  buildIndexFlag,
  buildSqliteFlag,
  benchArgsPrefix,
  benchArgsSuffix
}) => {
  const args = [
    benchScript,
    '--repo',
    repoPath,
    '--queries',
    queriesPath,
    '--write-report',
    '--out',
    outFile,
    ...benchArgsPrefix
  ];
  if (buildRequested) {
    args.push('--build');
  } else {
    if (buildIndexFlag || autoBuildIndex) args.push('--build-index');
    if (buildSqliteFlag || autoBuildSqlite) args.push('--build-sqlite');
  }
  args.push(...benchArgsSuffix);
  return args;
};

/**
 * Run the per-repo benchmark loop in deterministic plan order.
 *
 * @param {{
 *   executionPlans:Array<object>,
 *   argv:object,
 *   scriptRoot:string,
 *   baseEnv:NodeJS.ProcessEnv,
 *   processRunner:object,
 *   appendLog:(line:string,level?:'info'|'warn'|'error',meta?:object|null) => void,
 *   display:object,
 *   quietMode:boolean,
 *   dryRun:boolean,
 *   repoLogsEnabled:boolean,
 *   initRepoLog:(input:{label:string,tier?:string,repoPath:string,slug:string}) => (string|null),
 *   getRepoLogPath:() => (string|null),
 *   clearLogHistory:() => void,
 *   hasDiskFullMessageInHistory:() => boolean,
 *   progressRuntime:BenchProgressRuntime,
 *   lifecycle:object,
 *   wantsSqlite:boolean,
 *   backendList:string[],
 *   lockMode:string,
 *   lockWaitMs:number,
 *   lockStaleMs:number
 * }} input
 * @returns {Promise<object[]>}
 */
export const runBenchExecutionLoop = async ({
  executionPlans,
  argv,
  scriptRoot,
  baseEnv,
  processRunner,
  appendLog,
  display,
  quietMode,
  dryRun,
  repoLogsEnabled,
  initRepoLog,
  getRepoLogPath,
  clearLogHistory,
  hasDiskFullMessageInHistory,
  progressRuntime,
  lifecycle,
  wantsSqlite,
  backendList,
  lockMode,
  lockWaitMs,
  lockStaleMs
}) => {
  const results = [];
  const benchScript = path.join(scriptRoot, 'tests', 'perf', 'bench', 'run.test.js');
  const heapArgRaw = argv['heap-mb'];
  const heapArg = Number.isFinite(Number(heapArgRaw)) ? Math.floor(Number(heapArgRaw)) : null;
  const heapRecommendation = getRecommendedHeapMb();
  let heapLogged = false;
  const heapArgEnabled = Number.isFinite(heapArg) && heapArg > 0;
  const baseNodeOptionsForRun = heapArgEnabled
    ? stripMaxOldSpaceFlag(baseEnv.NODE_OPTIONS || '')
    : (baseEnv.NODE_OPTIONS || '');
  const baseNodeOptionsHasHeapFlag = baseNodeOptionsForRun.includes('--max-old-space-size');
  const baseEnvForRepoRuntime = { ...baseEnv };
  if (typeof baseEnv.NODE_OPTIONS === 'string' || baseNodeOptionsForRun) {
    baseEnvForRepoRuntime.NODE_OPTIONS = baseNodeOptionsForRun;
  }

  const wantsMemoryBackend = backendList.includes('memory');
  const buildRequested = Boolean(argv.build);
  const buildIndexFlag = Boolean(argv['build-index']);
  const buildSqliteFlag = Boolean(argv['build-sqlite']);
  const buildIndexRequested = buildRequested || buildIndexFlag;
  const buildSqliteRequested = buildRequested || buildSqliteFlag;
  const autoBuildEnabled = !(buildRequested || buildIndexFlag || buildSqliteFlag);
  const benchArgsPrefix = [argv['stub-embeddings'] ? '--stub-embeddings' : '--real-embeddings'];
  const benchArgsSuffix = [];
  if (argv.incremental) benchArgsSuffix.push('--incremental');
  if (argv.ann) benchArgsSuffix.push('--ann');
  if (argv['no-ann']) benchArgsSuffix.push('--no-ann');
  if (argv.backend) benchArgsSuffix.push('--backend', String(argv.backend));
  if (argv.top) benchArgsSuffix.push('--top', String(argv.top));
  if (argv.limit) benchArgsSuffix.push('--limit', String(argv.limit));
  if (argv.threads) benchArgsSuffix.push('--threads', String(argv.threads));
  const childProgressMode = argv.progress === 'off' ? 'off' : 'jsonl';
  benchArgsSuffix.push('--progress', childProgressMode);
  if (argv.verbose) benchArgsSuffix.push('--verbose');
  if (argv.quiet || argv.json) benchArgsSuffix.push('--quiet');

  const runtimeConfigCache = new Map();
  const artifactStateCache = new Map();
  const lineStatsCache = new Map();

  const loadRepoRuntime = (repoPath) => {
    if (runtimeConfigCache.has(repoPath)) return runtimeConfigCache.get(repoPath);
    const repoUserConfig = loadUserConfig(repoPath);
    const repoRuntimeConfig = getRuntimeConfig(repoPath, repoUserConfig);
    const payload = { repoUserConfig, repoRuntimeConfig };
    runtimeConfigCache.set(repoPath, payload);
    return payload;
  };

  const readArtifactState = (repoPath) => {
    if (artifactStateCache.has(repoPath)) return artifactStateCache.get(repoPath);
    const payload = {
      missingIndex: needsIndexArtifacts(repoPath),
      missingSqlite: wantsSqlite && needsSqliteArtifacts(repoPath)
    };
    artifactStateCache.set(repoPath, payload);
    return payload;
  };

  /**
   * Update cached artifact state after a successful run with build flags.
   * This avoids rescanning the same repo path when the same target is queued
   * multiple times in one invocation.
   */
  const markArtifactsPresent = ({ repoPath, builtIndex, builtSqlite }) => {
    const prior = artifactStateCache.get(repoPath) || {
      missingIndex: true,
      missingSqlite: true
    };
    artifactStateCache.set(repoPath, {
      missingIndex: builtIndex ? false : prior.missingIndex,
      missingSqlite: builtSqlite ? false : prior.missingSqlite
    });
  };

  for (const plan of executionPlans) {
    const {
      task,
      repoPath,
      repoLabel,
      tierLabel,
      repoCacheRoot,
      outFile,
      fallbackLogSlug
    } = plan;
    progressRuntime.beginRepo({ tierLabel, repo: task.repo });

    // Reset per-repo transient history so failure summaries and disk-full
    // detection reflect only the currently executing repo.
    clearLogHistory();
    if (repoLogsEnabled) {
      initRepoLog({
        label: repoLabel,
        tier: tierLabel,
        repoPath,
        slug: fallbackLogSlug
      });
      const repoLogPath = getRepoLogPath();
      if (!quietMode && repoLogPath) {
        appendLog(`[logs] ${repoLabel}: ${path.basename(repoLogPath)}`, 'info', {
          fileOnlyLine: `[logs] ${repoLabel} -> ${repoLogPath}`
        });
      }
    }

    try {
      if (!lifecycle.hasRepoPath(repoPath)) {
        progressRuntime.update();
      }
      const repoState = await lifecycle.ensureRepoPresent({ task, repoPath, repoLabel });
      if (!repoState.ok) {
        appendLog(`[error] clone failed for ${repoLabel}; continuing.`, 'error');
        const crashRetention = await lifecycle.attachCrashRetention({
          task,
          repoLabel,
          repoPath,
          repoCacheRoot,
          outFile: null,
          failureReason: 'clone',
          failureCode: repoState.failureCode ?? null,
          schedulerEvents: repoState.schedulerEvents || []
        });
        progressRuntime.completeRepo();
        appendLog('[metrics] failed (clone)');
        results.push({
          ...task,
          repoPath,
          outFile: null,
          summary: null,
          failed: true,
          failureReason: 'clone',
          failureCode: repoState.failureCode ?? null,
          ...(crashRetention
            ? { diagnostics: { crashRetention } }
            : {})
        });
        continue;
      }

      await lifecycle.prepareRepoWorkspace({ repoPath });

      const { repoUserConfig, repoRuntimeConfig } = loadRepoRuntime(repoPath);
      const hasHeapFlag = baseNodeOptionsHasHeapFlag;
      let heapOverride = null;
      if (heapArgEnabled) {
        heapOverride = heapArg;
        if (!heapLogged) {
          appendLog(`[heap] using ${formatGb(heapOverride)} (${heapOverride} MB) from --heap-mb.`);
          heapLogged = true;
        }
      } else if (
        !Number.isFinite(repoRuntimeConfig.maxOldSpaceMb)
        && !hasHeapFlag
      ) {
        heapOverride = heapRecommendation.recommendedMb;
        if (!heapLogged) {
          appendLog(
            `[auto-heap] using ${formatGb(heapOverride)} (${heapOverride} MB). `
              + 'Override with --heap-mb.'
          );
          heapLogged = true;
        }
      }
      const runtimeConfigForRun = heapOverride
        ? { ...repoRuntimeConfig, maxOldSpaceMb: heapOverride }
        : repoRuntimeConfig;
      const repoEnvBase = resolveRuntimeEnv(runtimeConfigForRun, baseEnvForRepoRuntime);
      if (heapOverride) {
        repoEnvBase.NODE_OPTIONS = stripMaxOldSpaceFlag(repoEnvBase.NODE_OPTIONS || '');
        repoEnvBase.NODE_OPTIONS = [repoEnvBase.NODE_OPTIONS, `--max-old-space-size=${heapOverride}`].filter(Boolean).join(' ').trim();
      }

      const artifactState = readArtifactState(repoPath);
      const missingIndex = artifactState.missingIndex;
      const missingSqlite = artifactState.missingSqlite;
      let autoBuildIndex = false;
      let autoBuildSqlite = false;
      if (buildSqliteRequested && !buildIndexRequested && missingIndex) {
        autoBuildIndex = true;
        appendLog('[auto-build] sqlite needs index artifacts; enabling --build-index.');
      }
      if (autoBuildEnabled) {
        if (missingIndex && wantsMemoryBackend) autoBuildIndex = true;
        if (missingSqlite) autoBuildSqlite = true;
        if (autoBuildSqlite && missingIndex) autoBuildIndex = true;
        if (autoBuildIndex || autoBuildSqlite) {
          appendLog(
            `[auto-build] missing artifacts (${autoBuildIndex ? 'index' : ''}${autoBuildIndex && autoBuildSqlite ? ', ' : ''}${autoBuildSqlite ? 'sqlite' : ''}); enabling build steps.`
          );
        }
      }

      const shouldBuildIndex = buildIndexRequested || autoBuildIndex;
      const shouldBuildSqlite = buildSqliteRequested || autoBuildSqlite;

      if (shouldBuildIndex && !dryRun) {
        if (lineStatsCache.has(repoPath)) {
          appendLog(`[metrics] lines ${formatLineStatsSummary(lineStatsCache.get(repoPath))} (cached)`);
        } else {
          try {
            appendLog(`[metrics] scanning lines for ${repoLabel}...`);
            const stats = await buildLineStats(repoPath, repoUserConfig);
            lineStatsCache.set(repoPath, stats);
            appendLog(`[metrics] lines ${formatLineStatsSummary(stats)}`);
          } catch (err) {
            appendLog(`[metrics] line scan unavailable: ${err?.message || err}`);
          }
        }
      }

      const lockCheck = await checkIndexLock({
        repoCacheRoot,
        repoLabel,
        lockMode,
        lockWaitMs,
        lockStaleMs,
        onLog: appendLog
      });
      if (!lockCheck.ok) {
        const detail = formatLockDetail(lockCheck.detail);
        const message = `Skipping ${repoLabel}: index lock held ${detail}`.trim();
        appendLog(`[lock] ${message}`);
        if (!quietMode) display.error(message);
        progressRuntime.completeRepo();
        appendLog('[metrics] skipped (lock)');
        results.push({
          ...task,
          repoPath,
          outFile,
          summary: null,
          skipped: true,
          skipReason: 'lock',
          lock: lockCheck.detail || null
        });
        continue;
      }

      const benchArgs = buildBenchArgs({
        benchScript,
        repoPath,
        queriesPath: task.queriesPath,
        outFile,
        autoBuildIndex,
        autoBuildSqlite,
        buildRequested,
        buildIndexFlag,
        buildSqliteFlag,
        benchArgsPrefix,
        benchArgsSuffix
      });

      progressRuntime.update();

      let summary = null;
      if (dryRun) {
        appendLog(`[dry-run] node ${benchArgs.join(' ')}`);
      } else {
        const benchProcessEnv = { ...repoEnvBase };
        if (!Object.prototype.hasOwnProperty.call(benchProcessEnv, 'PAIROFCLEATS_CRASH_LOG_ANNOUNCE')) {
          benchProcessEnv.PAIROFCLEATS_CRASH_LOG_ANNOUNCE = '0';
        }
        const benchResult = await processRunner.runProcess(`bench ${repoLabel}`, process.execPath, benchArgs, {
          cwd: scriptRoot,
          env: benchProcessEnv,
          continueOnError: true
        });
        if (!benchResult.ok) {
          artifactStateCache.delete(repoPath);
          const diskFull = hasDiskFullMessageInHistory();
          if (diskFull) {
            appendLog(`[error] disk full while benchmarking ${repoLabel}; continuing.`, 'error');
          }
          appendLog(`[error] benchmark failed for ${repoLabel}; continuing.`, 'error');
          const failureReason = diskFull ? 'disk-full' : 'bench';
          const crashRetention = await lifecycle.attachCrashRetention({
            task,
            repoLabel,
            repoPath,
            repoCacheRoot,
            outFile,
            failureReason,
            failureCode: benchResult.code ?? null,
            schedulerEvents: benchResult.schedulerEvents || []
          });
          progressRuntime.completeRepo();
          appendLog('[metrics] failed (bench)');
          results.push({
            ...task,
            repoPath,
            outFile,
            summary: null,
            failed: true,
            failureReason,
            failureCode: benchResult.code ?? null,
            ...(crashRetention
              ? { diagnostics: { crashRetention } }
              : {})
          });
          continue;
        }

        markArtifactsPresent({
          repoPath,
          builtIndex: shouldBuildIndex,
          builtSqlite: shouldBuildSqlite
        });

        try {
          const raw = await fsPromises.readFile(outFile, 'utf8');
          summary = JSON.parse(raw).summary || null;
        } catch (err) {
          appendLog(`[error] failed to read bench report for ${repoLabel}; continuing.`, 'error');
          if (err && err.message) display.error(err.message);
          const crashRetention = await lifecycle.attachCrashRetention({
            task,
            repoLabel,
            repoPath,
            repoCacheRoot,
            outFile,
            failureReason: 'report',
            failureCode: null,
            schedulerEvents: benchResult.schedulerEvents || []
          });
          progressRuntime.completeRepo();
          appendLog('[metrics] failed (report)');
          results.push({
            ...task,
            repoPath,
            outFile,
            summary: null,
            failed: true,
            failureReason: 'report',
            failureCode: null,
            ...(crashRetention
              ? { diagnostics: { crashRetention } }
              : {})
          });
          continue;
        }
      }

      progressRuntime.completeRepo();
      appendLog(`[metrics] ${formatMetricSummary(summary)}`);
      results.push({ ...task, repoPath, outFile, summary });
    } finally {
      await lifecycle.cleanRepoCache({ repoCacheRoot, repoLabel });
    }
  }

  return results;
};
