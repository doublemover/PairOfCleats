#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createTimeoutError, runWithTimeout } from '../../../src/shared/promise-timeout.js';
import {
  getTrackedSubprocessCount,
  spawnSubprocess,
  terminateTrackedSubprocesses,
  withTrackedSubprocessSignalScope
} from '../../../src/shared/subprocess.js';
import {
  buildStage1FileSubprocessOwnershipId,
  resolveProcessCleanupTimeoutMs,
  runCleanupWithTimeout
} from '../../../src/index/build/indexer/steps/process-files.js';

ensureTestingEnv(process.env);

const isAlive = (pid) => {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitFor = async (predicate, timeoutMs = 5000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
};

const defaultTimeoutMs = resolveProcessCleanupTimeoutMs({ stage1Queues: { watchdog: {} } });
assert.equal(defaultTimeoutMs, 30000, 'expected default process cleanup timeout');

const configuredTimeoutMs = resolveProcessCleanupTimeoutMs({
  stage1Queues: {
    watchdog: {
      cleanupTimeoutMs: 4321
    }
  }
});
assert.equal(configuredTimeoutMs, 4321, 'expected configured process cleanup timeout to be honored');

const indexingConfigTimeoutMs = resolveProcessCleanupTimeoutMs({
  indexingConfig: {
    stage1: {
      watchdog: {
        cleanupTimeoutMs: 2468
      }
    }
  }
});
assert.equal(indexingConfigTimeoutMs, 2468, 'expected indexing stage1 cleanup timeout to be honored');

const stageQueueOverrideTimeoutMs = resolveProcessCleanupTimeoutMs({
  indexingConfig: {
    stage1: {
      watchdog: {
        cleanupTimeoutMs: 1357
      }
    }
  },
  stage1Queues: {
    watchdog: {
      cleanupTimeoutMs: 9753
    }
  }
});
assert.equal(stageQueueOverrideTimeoutMs, 9753, 'expected stage1 queue cleanup timeout to take precedence');

const disabledTimeoutMs = resolveProcessCleanupTimeoutMs({
  stage1Queues: {
    watchdog: {
      cleanupTimeoutMs: 0
    }
  }
});
assert.equal(disabledTimeoutMs, 0, 'expected cleanup timeout to allow explicit disable');

const timeoutLogs = [];
const timedOut = await runCleanupWithTimeout({
  label: 'unit-timeout',
  timeoutMs: 25,
  cleanup: () => new Promise((resolve) => {
    setTimeout(resolve, 500);
  }),
  log: (line) => timeoutLogs.push(String(line))
});
assert.equal(timedOut.timedOut, true, 'expected never-resolving cleanup to time out');
assert.ok(
  timeoutLogs.some((line) => line.includes('unit-timeout timed out')),
  'expected timeout cleanup log line'
);

let timeoutHookTriggered = false;
const timedOutWithHook = await runCleanupWithTimeout({
  label: 'unit-timeout-hook',
  timeoutMs: 25,
  cleanup: () => new Promise((resolve) => {
    setTimeout(resolve, 500);
  }),
  onTimeout: () => {
    timeoutHookTriggered = true;
  }
});
assert.equal(timedOutWithHook.timedOut, true, 'expected timeout hook path to report timeout');
assert.equal(timeoutHookTriggered, true, 'expected timeout hook to run for timed-out cleanup');

let fastCleanupCalled = false;
const completed = await runCleanupWithTimeout({
  label: 'unit-fast',
  timeoutMs: 500,
  cleanup: async () => {
    fastCleanupCalled = true;
  }
});
assert.equal(fastCleanupCalled, true, 'expected cleanup function to run');
assert.equal(completed.timedOut, false, 'expected fast cleanup to complete before timeout');

const runtime = {
  buildId: 'ub002-stage1-test',
  subprocessOwnership: {
    stage1FilePrefix: 'stage1:ub002-stage1-test'
  }
};
const timedOutOwnershipId = buildStage1FileSubprocessOwnershipId({
  runtime,
  mode: 'code',
  fileIndex: 1,
  rel: 'timed-out.js',
  shardId: 'shard-1'
});
const survivorOwnershipId = buildStage1FileSubprocessOwnershipId({
  runtime,
  mode: 'code',
  fileIndex: 2,
  rel: 'survivor.js',
  shardId: 'shard-1'
});

const timedOutController = new AbortController();
const survivorController = new AbortController();
let timedOutPid = null;
let survivorPid = null;
let timedOutWorker = null;
let survivorWorker = null;

try {
  timedOutWorker = withTrackedSubprocessSignalScope(timedOutController.signal, timedOutOwnershipId, () => spawnSubprocess(
    process.execPath,
    ['-e', 'setInterval(() => {}, 60000);'],
    {
      stdio: 'ignore',
      rejectOnNonZeroExit: false,
      detached: process.platform !== 'win32',
      signal: timedOutController.signal,
      onSpawn: (child) => {
        timedOutPid = child?.pid ?? null;
      }
    }
  ));
  survivorWorker = withTrackedSubprocessSignalScope(survivorController.signal, survivorOwnershipId, () => spawnSubprocess(
    process.execPath,
    ['-e', 'setInterval(() => {}, 60000);'],
    {
      stdio: 'ignore',
      rejectOnNonZeroExit: false,
      detached: process.platform !== 'win32',
      signal: survivorController.signal,
      onSpawn: (child) => {
        survivorPid = child?.pid ?? null;
      }
    }
  ));

  const bothTracked = await waitFor(
    () => getTrackedSubprocessCount(timedOutOwnershipId) > 0
      && getTrackedSubprocessCount(survivorOwnershipId) > 0,
    5000
  );
  assert.equal(bothTracked, true, 'expected both file ownership scopes to have tracked subprocesses');

  await assert.rejects(
    runWithTimeout(
      () => new Promise((resolve) => setTimeout(resolve, 250)),
      {
        timeoutMs: 25,
        errorFactory: () => createTimeoutError({
          message: 'forced file timeout',
          code: 'FILE_PROCESS_TIMEOUT',
          retryable: false,
          meta: { ownershipId: timedOutOwnershipId }
        })
      }
    ),
    (error) => error?.code === 'FILE_PROCESS_TIMEOUT'
  );

  const timedOutCleanup = await terminateTrackedSubprocesses({
    reason: `test_timeout:${timedOutOwnershipId}`,
    force: true,
    ownershipId: timedOutOwnershipId
  });
  assert.ok(timedOutCleanup.attempted >= 1, 'expected timed-out ownership scoped cleanup attempt');
  assert.ok(
    timedOutCleanup.terminatedPids.includes(timedOutPid),
    'expected timed-out ownership cleanup to terminate the timed-out worker pid'
  );
  assert.ok(
    timedOutCleanup.terminatedOwnershipIds.includes(timedOutOwnershipId),
    'expected timed-out ownership cleanup to report the timed-out ownership id'
  );
  assert.ok(
    timedOutCleanup.killAudit.every((entry) => entry.ownershipId === timedOutOwnershipId),
    'expected timed-out ownership kill-audit to remain scoped to one ownership id'
  );
  const timedOutTerminated = await waitFor(() => !isAlive(timedOutPid), 5000);
  assert.equal(timedOutTerminated, true, 'expected timed-out ownership worker to be terminated');
  assert.equal(isAlive(survivorPid), true, 'expected unrelated ownership worker to survive timed-out cleanup');
  assert.equal(
    getTrackedSubprocessCount(survivorOwnershipId) > 0,
    true,
    'expected survivor ownership worker to remain tracked after unrelated timeout cleanup'
  );

  const survivorCleanup = await terminateTrackedSubprocesses({
    reason: `test_survivor_cleanup:${survivorOwnershipId}`,
    force: true,
    ownershipId: survivorOwnershipId
  });
  assert.ok(survivorCleanup.attempted >= 1, 'expected survivor ownership cleanup attempt');
  assert.ok(
    survivorCleanup.terminatedPids.includes(survivorPid),
    'expected survivor cleanup to terminate survivor pid during final cleanup'
  );
  const survivorTerminated = await waitFor(() => !isAlive(survivorPid), 5000);
  assert.equal(survivorTerminated, true, 'expected survivor ownership worker to terminate during final cleanup');
} finally {
  await terminateTrackedSubprocesses({
    reason: 'process-files-cleanup-timeout-test-final',
    force: true
  });
  await Promise.allSettled([timedOutWorker, survivorWorker].filter(Boolean));
}

console.log('process files cleanup timeout test passed');
