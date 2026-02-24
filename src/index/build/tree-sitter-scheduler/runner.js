import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coerceAbortSignal, throwIfAborted } from '../../../shared/abort.js';
import { runWithConcurrency } from '../../../shared/concurrency.js';
import { resolveRuntimeEnv } from '../../../shared/runtime-envelope.js';
import { spawnSubprocess } from '../../../shared/subprocess.js';
import {
  resolveBuildCleanupTimeoutMs,
  runBuildCleanupWithTimeout
} from '../cleanup-timeout.js';
import { buildTreeSitterSchedulerPlan } from './plan.js';
import { createTreeSitterSchedulerLookup } from './lookup.js';
import {
  loadTreeSitterSchedulerAdaptiveProfile,
  mergeTreeSitterSchedulerAdaptiveProfile,
  saveTreeSitterSchedulerAdaptiveProfile
} from './adaptive-profile.js';
import { parseSubprocessCrashEvents, isSubprocessCrashExit, inferFailedGrammarKeysFromSubprocessOutput } from './runner/crash-utils.js';
import { createSchedulerCrashTracker } from './runner/crash-tracker.js';
import { resolveExecConcurrency, resolveExecutionOrder, buildWarmPoolTasks, resolveSchedulerTaskTimeoutMs } from './runner/task-scheduler.js';
import { loadIndexEntries } from './runner/index-loader.js';
import {
  loadSubprocessProfile,
  createLineBuffer,
  buildPlannedSegmentsByContainer,
  buildScheduledLanguageSet
} from './runner/execution-utils.js';

const SCHEDULER_EXEC_PATH = fileURLToPath(new URL('./subprocess-exec.js', import.meta.url));

/**
 * Execute tree-sitter scheduling for a mode by planning per-grammar jobs,
 * running the scheduler subprocess(es), and loading the merged index rows.
 *
 * @param {object} input
 * @param {'code'|'prose'|'records'|'extracted-prose'} input.mode
 * @param {object} input.runtime
 * @param {Array<object>} input.entries
 * @param {string} input.outDir
 * @param {object|null} [input.fileTextCache]
 * @param {AbortSignal|null} [input.abortSignal]
 * @param {(line:string)=>void|null} [input.log]
 * @param {object|null} [input.crashLogger]
 * @returns {Promise<object|null>}
 */
export const runTreeSitterScheduler = async ({
  mode,
  runtime,
  entries,
  outDir,
  fileTextCache = null,
  abortSignal = null,
  log = null,
  crashLogger = null
}) => {
  const effectiveAbortSignal = coerceAbortSignal(abortSignal);
  throwIfAborted(effectiveAbortSignal);
  const schedulerConfig = runtime?.languageOptions?.treeSitter?.scheduler || {};
  const requestedTransport = typeof schedulerConfig.transport === 'string'
    ? schedulerConfig.transport.trim().toLowerCase()
    : 'disk';
  const requestedSharedCache = schedulerConfig.sharedCache === true;
  if (requestedTransport === 'shm' && log) {
    log('[tree-sitter:schedule] scheduler transport=shm requested; falling back to disk transport.');
  }
  if (requestedSharedCache && log) {
    log(
      '[tree-sitter:schedule] scheduler sharedCache requested; ' +
      'paged cross-process cache is not enabled, using process-local cache.'
    );
  }
  const planResult = await buildTreeSitterSchedulerPlan({
    mode,
    runtime,
    entries,
    outDir,
    fileTextCache,
    abortSignal: effectiveAbortSignal,
    log
  });
  if (!planResult) return null;

  // Execute the plan in a separate Node process to isolate parser memory churn
  // from the main indexer process.
  const runtimeEnv = runtime?.envelope
    ? resolveRuntimeEnv(runtime.envelope, process.env)
    : process.env;
  const executionOrder = resolveExecutionOrder(planResult.plan);
  const grammarKeys = Array.from(new Set(executionOrder));
  const groupMetaByGrammarKey = planResult.plan?.groupMeta && typeof planResult.plan.groupMeta === 'object'
    ? planResult.plan.groupMeta
    : {};
  const groupByGrammarKey = new Map();
  for (const group of planResult.groups || []) {
    if (!group?.grammarKey) continue;
    groupByGrammarKey.set(group.grammarKey, group);
  }
  const crashTracker = createSchedulerCrashTracker({
    runtime,
    outDir,
    paths: planResult.paths,
    groupByGrammarKey,
    crashLogger,
    log
  });
  const idleGapStats = {
    samples: 0,
    totalMs: 0,
    maxMs: 0,
    thresholdMs: 25
  };
  let lastTaskCompletedAt = 0;
  if (executionOrder.length) {
    const streamLogs = typeof log === 'function'
      && (runtime?.argv?.verbose === true || runtime?.languageOptions?.treeSitter?.debugScheduler === true);
    const execConcurrency = resolveExecConcurrency({
      schedulerConfig,
      grammarCount: executionOrder.length
    });
    const warmPoolTasks = buildWarmPoolTasks({
      executionOrder,
      groupMetaByGrammarKey,
      schedulerConfig,
      execConcurrency
    });
    const adaptiveSamples = [];
    await runWithConcurrency(
      warmPoolTasks,
      execConcurrency,
      async (task, ctx) => {
        throwIfAborted(effectiveAbortSignal);
        const now = Date.now();
        if (lastTaskCompletedAt > 0) {
          const idleGapMs = Math.max(0, now - lastTaskCompletedAt);
          if (idleGapMs >= idleGapStats.thresholdMs) {
            idleGapStats.samples += 1;
            idleGapStats.totalMs += idleGapMs;
            idleGapStats.maxMs = Math.max(idleGapStats.maxMs, idleGapMs);
          }
        }
        const grammarKeysForTask = Array.isArray(task?.grammarKeys) ? task.grammarKeys : [];
        if (!grammarKeysForTask.length) return;
        const taskTimeoutMs = resolveSchedulerTaskTimeoutMs({
          schedulerConfig,
          task,
          groupByGrammarKey
        });
        if (log) {
          log(
            `[tree-sitter:schedule] batch ${ctx.index + 1}/${warmPoolTasks.length}: ${task.taskId} `
            + `(waves=${grammarKeysForTask.length}, lane=${task.laneIndex}/${task.laneCount}, timeout=${taskTimeoutMs}ms)`
          );
        }
        const linePrefix = `[tree-sitter:schedule:${task.taskId}]`;
        const stdoutBuffer = streamLogs
          ? createLineBuffer((line) => log(`${linePrefix} ${line}`))
          : null;
        const stderrBuffer = streamLogs
          ? createLineBuffer((line) => log(`${linePrefix} ${line}`))
          : null;
        const profileOut = path.join(
          outDir,
          `.tree-sitter-scheduler-profile-${process.pid}-${ctx.index + 1}.json`
        );
        try {
          // Avoid stdio='inherit' when we have a logger. Direct child writes bypass
          // the display/progress handlers and render underneath interactive bars.
          // Piping and relaying lines keeps all output on the parent render path.
          await spawnSubprocess(
            process.execPath,
            [
              SCHEDULER_EXEC_PATH,
              '--outDir', outDir,
              '--grammarKeys', grammarKeysForTask.join(','),
              '--profileOut', profileOut
            ],
            {
              cwd: runtime?.root || undefined,
              env: runtimeEnv,
              stdio: ['ignore', 'pipe', 'pipe'],
              shell: false,
              signal: effectiveAbortSignal,
              timeoutMs: taskTimeoutMs,
              killTree: true,
              rejectOnNonZeroExit: true,
              onStdout: streamLogs ? (chunk) => stdoutBuffer.push(chunk) : null,
              onStderr: streamLogs ? (chunk) => stderrBuffer.push(chunk) : null
            }
          );
          const profileRows = await loadSubprocessProfile(profileOut);
          for (const row of profileRows) {
            adaptiveSamples.push(row);
          }
        } catch (err) {
          if (effectiveAbortSignal?.aborted) throw err;
          const subprocessCrashEvents = parseSubprocessCrashEvents(err);
          const exitCode = Number(err?.result?.exitCode);
          const signal = typeof err?.result?.signal === 'string' ? err.result.signal : null;
          const hasInjectedCrashExit = exitCode === 86;
          const hasNativeCrashExit = isSubprocessCrashExit({ exitCode, signal });
          const isTimeoutExit = err?.code === 'SUBPROCESS_TIMEOUT';
          const containsCrashEvent = subprocessCrashEvents.length > 0
            || hasInjectedCrashExit
            || hasNativeCrashExit
            || isTimeoutExit;
          if (!containsCrashEvent) throw err;
          const inferredFailedGrammarKeys = inferFailedGrammarKeysFromSubprocessOutput({
            grammarKeysForTask,
            stdout: err?.result?.stdout,
            stderr: err?.result?.stderr
          });
          const failureKeys = inferredFailedGrammarKeys.length
            ? inferredFailedGrammarKeys
            : grammarKeysForTask;
          if (isTimeoutExit && typeof log === 'function') {
            log(
              `[tree-sitter:schedule] subprocess timeout in ${task.taskId} after ${taskTimeoutMs}ms; ` +
              `degrading ${failureKeys.join(', ')}`
            );
          }
          const crashStage = typeof subprocessCrashEvents[0]?.stage === 'string'
            ? subprocessCrashEvents[0].stage
            : (isTimeoutExit ? 'scheduler-subprocess-timeout' : 'scheduler-subprocess');
          for (const grammarKey of failureKeys) {
            await crashTracker.recordFailure({
              grammarKey,
              stage: crashStage,
              error: err,
              taskId: task.taskId,
              markFailed: true,
              taskGrammarKeys: grammarKeysForTask,
              inferredFailedGrammarKeys
            });
          }
          return;
        } finally {
          stdoutBuffer?.flush();
          stderrBuffer?.flush();
          lastTaskCompletedAt = Date.now();
        }
        throwIfAborted(effectiveAbortSignal);
      },
      {
        collectResults: false,
        signal: effectiveAbortSignal,
        requireSignal: true,
        signalLabel: 'build.tree-sitter.runner.runWithConcurrency'
      }
    );
    if (adaptiveSamples.length) {
      const loaded = await loadTreeSitterSchedulerAdaptiveProfile({
        runtime,
        treeSitterConfig: runtime?.languageOptions?.treeSitter || null,
        log
      });
      const merged = mergeTreeSitterSchedulerAdaptiveProfile(loaded.entriesByGrammarKey, adaptiveSamples);
      await saveTreeSitterSchedulerAdaptiveProfile({
        profilePath: loaded.profilePath,
        entriesByGrammarKey: merged,
        log
      });
    }
    throwIfAborted(effectiveAbortSignal);
  }
  await runBuildCleanupWithTimeout({
    label: `tree-sitter-scheduler.${mode}.crash-persistence`,
    cleanup: () => crashTracker.waitForPersistence(),
    log
  });
  const crashSummary = crashTracker.summarize();
  const failedGrammarKeySet = new Set(crashSummary.failedGrammarKeys);
  const successfulGrammarKeys = grammarKeys.filter((grammarKey) => !failedGrammarKeySet.has(grammarKey));
  const degradedVirtualPathSet = new Set(crashSummary.degradedVirtualPaths);
  if (crashSummary.parserCrashSignatures > 0 && log) {
    log(
      `[tree-sitter:schedule] degraded parser mode enabled: ` +
      `signatures=${crashSummary.parserCrashSignatures} ` +
      `failedGrammarKeys=${crashSummary.failedGrammarKeys.length} ` +
      `degradedVirtualPaths=${crashSummary.degradedVirtualPaths.length}`
    );
  }

  throwIfAborted(effectiveAbortSignal);
  const index = await loadIndexEntries({
    grammarKeys: successfulGrammarKeys,
    paths: planResult.paths,
    abortSignal: effectiveAbortSignal
  });
  const lookupConfig = schedulerConfig?.lookup && typeof schedulerConfig.lookup === 'object'
    ? schedulerConfig.lookup
    : {};
  const stage1CleanupTimeoutMs = resolveBuildCleanupTimeoutMs(
    runtime?.indexingConfig?.stage1?.watchdog?.cleanupTimeoutMs,
    runtime?.stage1Queues?.watchdog?.cleanupTimeoutMs
  );
  const configuredMaxOpenReaders = Number(
    lookupConfig.maxOpenReaders
      ?? schedulerConfig?.maxOpenReaders
  );
  const lookupCloseTimeoutMs = lookupConfig.closeTimeoutMs
    ?? schedulerConfig?.closeTimeoutMs
    ?? stage1CleanupTimeoutMs;
  const lookupForceCloseAfterMs = lookupConfig.closeForceAfterMs
    ?? schedulerConfig?.closeForceAfterMs
    ?? null;
  const lookup = createTreeSitterSchedulerLookup({
    outDir,
    index,
    log,
    maxOpenReaders: Number.isFinite(configuredMaxOpenReaders) && configuredMaxOpenReaders > 0
      ? Math.floor(configuredMaxOpenReaders)
      : null,
    closeTimeoutMs: lookupCloseTimeoutMs,
    forceCloseAfterMs: lookupForceCloseAfterMs
  });
  const plannedSegmentsByContainer = buildPlannedSegmentsByContainer(planResult.groups);
  const scheduledLanguageIds = buildScheduledLanguageSet(planResult.groups);
  const baseLookupStats = typeof lookup.stats === 'function' ? lookup.stats.bind(lookup) : null;
  const scheduleStats = planResult.plan
    ? {
      grammarKeys: grammarKeys.length,
      successfulGrammarKeys: successfulGrammarKeys.length,
      failedGrammarKeys: crashSummary.failedGrammarKeys.length,
      jobs: planResult.plan.jobs || 0,
      parserQueueIdleGaps: {
        samples: idleGapStats.samples,
        totalMs: idleGapStats.totalMs,
        maxMs: idleGapStats.maxMs,
        avgMs: idleGapStats.samples > 0 ? Math.round(idleGapStats.totalMs / idleGapStats.samples) : 0
      },
      parserCrashSignatures: crashSummary.parserCrashSignatures,
      degradedVirtualPaths: crashSummary.degradedVirtualPaths.length
    }
    : null;

  return {
    ...lookup,
    plan: planResult.plan,
    scheduledLanguageIds,
    failedGrammarKeys: crashSummary.failedGrammarKeys,
    degradedVirtualPaths: crashSummary.degradedVirtualPaths,
    parserCrashEvents: crashSummary.parserCrashEvents,
    parserCrashSignatures: crashSummary.parserCrashSignatures,
    crashForensicsBundlePath: crashTracker.getBundlePath(),
    durableCrashForensicsBundlePath: crashTracker.getDurableBundlePath(),
    getCrashSummary: () => ({
      parserCrashSignatures: crashSummary.parserCrashSignatures,
      parserCrashEvents: crashSummary.parserCrashEvents.map((event) => ({ ...event })),
      failedGrammarKeys: crashSummary.failedGrammarKeys.slice(),
      degradedVirtualPaths: crashSummary.degradedVirtualPaths.slice()
    }),
    isDegradedVirtualPath: (virtualPath) => degradedVirtualPathSet.has(virtualPath),
    plannedSegmentsByContainer,
    loadPlannedSegments: (containerPath) => {
      if (!containerPath || !plannedSegmentsByContainer.has(containerPath)) return null;
      const segments = plannedSegmentsByContainer.get(containerPath);
      return Array.isArray(segments) ? segments.map((segment) => ({ ...segment })) : null;
    },
    schedulerStats: scheduleStats,
    stats: () => ({
      ...(baseLookupStats ? baseLookupStats() : {}),
      parserCrashSignatures: crashSummary.parserCrashSignatures,
      failedGrammarKeys: crashSummary.failedGrammarKeys.length,
      degradedVirtualPaths: crashSummary.degradedVirtualPaths.length
    })
  };
};

export const treeSitterSchedulerRunnerInternals = Object.freeze({
  resolveExecutionOrder,
  buildWarmPoolTasks,
  isSubprocessCrashExit,
  inferFailedGrammarKeysFromSubprocessOutput,
  resolveSchedulerTaskTimeoutMs
});
