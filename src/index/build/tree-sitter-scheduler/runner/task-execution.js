import path from 'node:path';
import { throwIfAborted } from '../../../../shared/abort.js';
import { runWithConcurrency } from '../../../../shared/concurrency.js';
import { spawnSubprocess } from '../../../../shared/subprocess.js';
import {
  inferFailedGrammarKeysFromSubprocessOutput,
  isSubprocessCrashExit,
  parseSubprocessCrashEvents
} from './crash-utils.js';
import { classifyTreeSitterSchedulerFailure } from './failure-classification.js';
import { createLineBuffer, loadSubprocessProfile } from './execution-utils.js';

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
  const adaptiveSamples = [];
  if (!Array.isArray(plannedTasks) || !plannedTasks.length) {
    return { adaptiveSamples, idleGapStats };
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
          `(waves=${grammarKeysForTask.length}, lane=${task.laneIndex}/${task.laneCount}, timeout=${taskTimeoutMs}ms)`
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
        await spawnSubprocess(
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
        const classification = classifyTreeSitterSchedulerFailure({
          error: err,
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
  return { adaptiveSamples, idleGapStats };
};
