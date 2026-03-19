import { fileURLToPath } from 'node:url';
import { atomicWriteJson } from '../../../shared/io/atomic-write.js';
import { coerceAbortSignal, throwIfAborted } from '../../../shared/abort.js';
import { resolveRuntimeEnv } from '../../../shared/runtime-envelope.js';
import {
  resolveBuildCleanupTimeoutMs,
  runBuildCleanupWithTimeout
} from '../cleanup-timeout.js';
import { buildTreeSitterSchedulerPlan } from './plan.js';
import { createTreeSitterSchedulerLookup } from './lookup.js';
import { createSchedulerCrashTracker } from './runner/crash-tracker.js';
import { loadIndexEntries } from './runner/index-loader.js';
import {
  buildTreeSitterPlannerFailureSnapshot
} from './contracts.js';
import {
  buildPlannedSegmentsByContainer,
  buildScheduledLanguageSet
} from './runner/execution-utils.js';
import { persistTreeSitterSchedulerAdaptiveSamples } from './runner/adaptive-profile.js';
import { prepareTreeSitterSchedulerTasks } from './runner/task-preparation.js';
import { executeTreeSitterSchedulerTasks } from './runner/task-execution.js';
import {
  buildWarmPoolTasks,
  resolveExecutionOrder,
  resolveSchedulerTaskTimeoutMs
} from './runner/task-scheduler.js';
import {
  inferFailedGrammarKeysFromSubprocessOutput,
  isSubprocessCrashExit
} from './runner/crash-utils.js';

const SCHEDULER_EXEC_PATH = fileURLToPath(new URL('./subprocess-exec.js', import.meta.url));

const writePlannerFailureSnapshot = async ({
  paths,
  plan,
  groups,
  tasks,
  failureSummary
}) => {
  if (!paths?.plannerFailureSnapshotPath) return null;
  const snapshot = buildTreeSitterPlannerFailureSnapshot({
    plan,
    groups,
    tasks,
    failureSummary
  });
  await atomicWriteJson(paths.plannerFailureSnapshotPath, snapshot, { spaces: 2 });
  return paths.plannerFailureSnapshotPath;
};

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

  const runtimeEnv = runtime?.envelope
    ? resolveRuntimeEnv(runtime.envelope, process.env)
    : process.env;
  const crashTracker = createSchedulerCrashTracker({
    runtime,
    outDir,
    paths: planResult.paths,
    groupByGrammarKey: new Map((planResult.groups || []).map((group) => [group.grammarKey, group])),
    crashLogger,
    log
  });
  let prepared = null;
  try {
    prepared = prepareTreeSitterSchedulerTasks({
      planResult,
      schedulerConfig
    });
  } catch (err) {
    await writePlannerFailureSnapshot({
      paths: planResult.paths,
      plan: planResult.plan,
      groups: planResult.groups,
      tasks: prepared?.plannedTasks || [],
      failureSummary: {
        parserCrashSignatures: 0,
        failedGrammarKeys: [],
        degradedVirtualPaths: [],
        failureClasses: { scheduler_contract_violation: 1 }
      }
    });
    throw err;
  }

  const { grammarKeys, plannedTasks, execConcurrency } = prepared;
  const execution = await executeTreeSitterSchedulerTasks({
    plannedTasks,
    execConcurrency,
    effectiveAbortSignal,
    runtime,
    outDir,
    runtimeEnv,
    schedulerExecPath: SCHEDULER_EXEC_PATH,
    crashTracker,
    planResult,
    log,
    onWritePlannerFailureSnapshot: ({ plan, groups, tasks, failureSummary }) => writePlannerFailureSnapshot({
      paths: planResult.paths,
      plan,
      groups,
      tasks,
      failureSummary
    })
  });
  await persistTreeSitterSchedulerAdaptiveSamples({
    runtime,
    treeSitterConfig: runtime?.languageOptions?.treeSitter || null,
    adaptiveSamples: execution.adaptiveSamples,
    log
  });
  throwIfAborted(effectiveAbortSignal);

  const crashPersistenceResult = await runBuildCleanupWithTimeout({
    label: `tree-sitter-scheduler.${mode}.crash-persistence`,
    cleanup: () => crashTracker.waitForPersistence(),
    log
  });
  if (crashPersistenceResult?.timedOut && log) {
    log(
      `[tree-sitter:schedule] crash persistence timed out after ${crashPersistenceResult?.elapsedMs || 'unknown'}ms; continuing with degraded crash telemetry.`
    );
  }
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
  let plannerFailureSnapshotPath = null;
  if (crashSummary.failedGrammarKeys.length > 0) {
    plannerFailureSnapshotPath = await writePlannerFailureSnapshot({
      paths: planResult.paths,
      plan: planResult.plan,
      groups: planResult.groups,
      tasks: plannedTasks,
      failureSummary: crashSummary
    });
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
        samples: execution.idleGapStats.samples,
        totalMs: execution.idleGapStats.totalMs,
        maxMs: execution.idleGapStats.maxMs,
        avgMs: execution.idleGapStats.samples > 0
          ? Math.round(execution.idleGapStats.totalMs / execution.idleGapStats.samples)
          : 0
      },
      parserCrashSignatures: crashSummary.parserCrashSignatures,
      degradedVirtualPaths: crashSummary.degradedVirtualPaths.length,
      failureClasses: crashSummary.failureClasses
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
    plannerFailureSnapshotPath,
    getCrashSummary: () => ({
      parserCrashSignatures: crashSummary.parserCrashSignatures,
      parserCrashEvents: crashSummary.parserCrashEvents.map((event) => ({ ...event })),
      failedGrammarKeys: crashSummary.failedGrammarKeys.slice(),
      degradedVirtualPaths: crashSummary.degradedVirtualPaths.slice(),
      failureClasses: { ...(crashSummary.failureClasses || {}) }
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
      degradedVirtualPaths: crashSummary.degradedVirtualPaths.length,
      failureClasses: { ...(crashSummary.failureClasses || {}) }
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
