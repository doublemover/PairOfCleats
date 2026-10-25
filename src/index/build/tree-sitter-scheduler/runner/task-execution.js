import path from 'node:path';
import { throwIfAborted } from '../../../../shared/abort.js';
import { runWithConcurrency } from '../../../../shared/concurrency/run-with-queue.js';
import { spawnSubprocess } from '../../../../shared/subprocess/runner.js';
import {
  inferFailedGrammarKeysFromSubprocessOutput,
  isSubprocessCrashExit,
  parseSubprocessCrashEvents
} from './crash-utils.js';
import { classifyTreeSitterSchedulerFailure } from './failure-classification.js';
import { createLineBuffer, loadSubprocessProfile } from './execution-utils.js';
import { observeStorageResource, describeStorageFailure } from '../../../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../../shared/storage/operation-error.js';

export const executeTreeSitterSchedulerTasks = async ({
  plannedTasks,
  execConcurrency,
  effectiveAbortSignal,
  runtime,
  outDir,
  runtimeEnv,
  schedulerExecPath,
  crashTracker,
  planResult,
  log = null,
  onWritePlannerFailureSnapshot = async () => {}
} = {}) => {
  const idleGapStats = {
    samples: 0,
    totalMs: 0,
    maxMs: 0,
    thresholdMs: 25
  };
  let lastTaskCompletedAt = 0;
  let activeChildren = 0;
  let peakActiveChildren = 0;
  const adaptiveSamples = [];
  if (!Array.isArray(plannedTasks) || !plannedTasks.length) {
    return { adaptiveSamples, idleGapStats, peakActiveChildren };
  }
  const streamLogs = typeof log === 'function'
    && (runtime?.argv?.verbose === true || runtime?.languageOptions?.treeSitter?.debugScheduler === true);
  await runWithConcurrency(
    plannedTasks,
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
      const taskTimeoutMs = Number(task?.timeoutMs);
      if (log) {
        log(
          `[tree-sitter:schedule] batch ${ctx.index + 1}/${plannedTasks.length}: ${task.taskId} ` +
          `(waves=${grammarKeysForTask.length}, lane=${task.laneIndex}/${task.laneCount}, `
          + `plannedCost=${task.estimatedParseCost ?? 'unknown'}, balance=${task.costBalanced ? 'cost' : 'count'}, timeout=${taskTimeoutMs}ms)`
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
      let taskFailed = false, taskFailure;
      try {
        const launch = async () => {
          activeChildren += 1;
          peakActiveChildren = Math.max(peakActiveChildren, activeChildren);
          try { return await spawnSubprocess(
            process.execPath,
            [
              schedulerExecPath,
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
              ownershipId: runtime?.subprocessOwnership?.stage1FilePrefix
                ? `${runtime.subprocessOwnership.stage1FilePrefix}:tree-sitter:${task.taskId}` : undefined,
              rejectOnNonZeroExit: true,
              onStdout: streamLogs ? (chunk) => stdoutBuffer.push(chunk) : null,
              onStderr: streamLogs ? (chunk) => stderrBuffer.push(chunk) : null
            }
          ); } finally { activeChildren -= 1; }
        };
        if (runtime?.scheduler?.schedule) {
          await runtime.scheduler.schedule('stage1.cpu', { cpu: 1, mem: 1, io: 1,
            signal: effectiveAbortSignal }, launch);
        } else await launch();
        const profileRows = await loadSubprocessProfile(profileOut);
        for (const row of profileRows) {
          adaptiveSamples.push(row);
        }
      } catch (err) {
        try {
          const original = observeStorageResource(err, { phase: 'tree-sitter-scheduler-subprocess' });
          original.requireSettled();
          let diagnostic, termination;
          try {
            const report = describeStorageFailure(err, { phase: 'tree-sitter-scheduler-subprocess' });
            const result = err?.result, receipt = result?.termination;
            termination = { closeObserved: receipt?.closeObserved, treeCleanupSettled: receipt?.treeCleanupSettled,
              treeCleanupFailed: receipt?.treeCleanupFailed };
            const captured = { exitCode: result?.exitCode, signal: result?.signal, stdout: result?.stdout, stderr: result?.stderr };
            if (['stdout', 'stderr', 'signal'].some(key => captured[key] != null && typeof captured[key] !== 'string')
              || captured.exitCode != null && !['number', 'string'].includes(typeof captured.exitCode)) {
              throw new TypeError('Subprocess failure diagnostics require primitive captured fields.');
            }
            diagnostic = { ...report, result: Object.freeze(captured) };
            original.requireSettled();
          } catch (inspection) {
            throw addStorageFailureContext(err, { cacheOwnershipPending: true,
              treeSitterFailurePhase: 'subprocess-inspection' }, inspection, { secondaryPresent: true });
          }
          if (diagnostic.code === 'SUBPROCESS_TIMEOUT' && (termination.closeObserved !== true
            || termination.treeCleanupSettled !== true || termination.treeCleanupFailed !== false)) {
            throw addStorageFailureContext(err, { cacheOwnershipPending: true,
              treeSitterFailurePhase: 'subprocess-cleanup-unconfirmed', terminationObservation: Object.freeze(termination) });
          }
          if (effectiveAbortSignal?.aborted) throw err;
          const subprocessCrashEvents = parseSubprocessCrashEvents(diagnostic);
          const exitCode = ['number', 'string'].includes(typeof diagnostic.result.exitCode) ? Number(diagnostic.result.exitCode) : NaN;
          const signal = typeof diagnostic.result.signal === 'string' ? diagnostic.result.signal : null;
          const hasInjectedCrashExit = exitCode === 86;
          const hasNativeCrashExit = isSubprocessCrashExit({ exitCode, signal });
          const isTimeoutExit = diagnostic.code === 'SUBPROCESS_TIMEOUT';
          const containsCrashEvent = subprocessCrashEvents.length > 0
            || hasInjectedCrashExit
            || hasNativeCrashExit
            || isTimeoutExit;
          if (!containsCrashEvent) throw err;
          const inferredFailedGrammarKeys = inferFailedGrammarKeysFromSubprocessOutput({
            grammarKeysForTask,
            stdout: diagnostic.result.stdout,
            stderr: diagnostic.result.stderr
          });
          const failureKeys = inferredFailedGrammarKeys.length
            ? inferredFailedGrammarKeys
            : grammarKeysForTask;
          const classification = classifyTreeSitterSchedulerFailure({
            error: diagnostic,
            crashEvent: subprocessCrashEvents[0] || null
          });
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
              inferredFailedGrammarKeys,
              failureClass: classification.failureClass,
              fallbackConsequence: classification.fallbackConsequence
            });
          }
          await onWritePlannerFailureSnapshot({
            plan: planResult.plan,
            groups: planResult.groups,
            tasks: plannedTasks,
            failureSummary: crashTracker.summarize()
          });
          original.requireSettled();
          return;
        } catch (failure) {
          taskFailed = true; taskFailure = failure;
          throw failure;
        }
      } finally {
        const cleanupErrors = [];
        for (const buffer of [stdoutBuffer, stderrBuffer]) {
          try { buffer?.flush(); } catch (failure) { cleanupErrors.push(failure); }
        }
        lastTaskCompletedAt = Date.now();
        if (cleanupErrors.length) {
          const cleanup = cleanupErrors.length === 1 ? cleanupErrors[0] : new AggregateError(cleanupErrors, 'Scheduler log flush failed.');
          if (taskFailed) throw addStorageFailureContext(taskFailure, { treeSitterFailurePhase: 'subprocess-log-flush' }, cleanup, { secondaryPresent: true });
          throw cleanup;
        }
      }
      throwIfAborted(effectiveAbortSignal);
    },
    {
      collectResults: false,
      retries: 0,
      signal: effectiveAbortSignal,
      requireSignal: true,
      signalLabel: 'build.tree-sitter.runner.runWithConcurrency'
    }
  );
  return { adaptiveSamples, idleGapStats, peakActiveChildren };
};
