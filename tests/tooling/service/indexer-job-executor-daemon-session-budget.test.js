#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createJobExecutor } from '../../../tools/service/indexer-service/job-executor.js';

const daemonRuns = [];

const executor = createJobExecutor({
  isEmbeddingsQueue: false,
  serviceExecutionMode: 'daemon',
  daemonWorkerConfig: {
    deterministic: true,
    sessionNamespace: 'svc-indexer',
    governance: {
      maxConsecutiveFailures: 3,
      maxJobsPerSession: 2,
      subprocessCooldownJobs: 1
    }
  },
  resolvedQueueName: 'index',
  embeddingExtraEnv: {},
  resolveRepoRuntimeEnv: () => ({}),
  toolRoot: process.cwd(),
  completeNonRetriableFailure: async () => {},
  runBuildIndexDaemonImpl: async (repoPath, mode, stage, extraArgs, logPath, daemonOptions) => {
    daemonRuns.push({ repoPath, mode, stage, extraArgs, logPath, daemonOptions });
    const sessionNamespace = daemonOptions?.sessionNamespace || 'missing';
    return {
      exitCode: 0,
      signal: null,
      executionMode: 'daemon',
      cancelled: false,
      shutdownMode: null,
      daemon: {
        sessionKey: `daemon:${sessionNamespace}`
      }
    };
  }
});

const fakeLifecycle = {
  async registerPromise(promise) {
    return await promise;
  }
};

const job = {
  id: 'job-daemon-budget',
  repo: '/tmp/daemon-budget-repo',
  mode: 'code',
  stage: 'stage1',
  args: ['--repo', '/tmp/daemon-budget-repo', '--mode', 'code']
};

const first = await executor.executeClaimedJob({
  job,
  jobLifecycle: fakeLifecycle,
  logPath: '/tmp/daemon-budget-0.log'
});
assert.equal(first.runResult.executionMode, 'daemon');
assert.equal(first.runResult.governance?.recycleRequested, false);
assert.equal(first.runResult.governance?.sessionEpoch, 0);
assert.equal(first.runResult.governance?.sessionJobCount, 1);
assert.equal(first.runResult.governance?.nextSessionJobCount, 1);
assert.equal(first.runResult.governance?.maxJobsPerSession, 2);

const second = await executor.executeClaimedJob({
  job,
  jobLifecycle: fakeLifecycle,
  logPath: '/tmp/daemon-budget-1.log'
});
assert.equal(second.runResult.executionMode, 'daemon');
assert.equal(second.runResult.governance?.recycleRequested, true);
assert.equal(second.runResult.governance?.reason, 'daemon-session-job-budget');
assert.equal(second.runResult.governance?.sessionEpoch, 0);
assert.equal(second.runResult.governance?.nextSessionEpoch, 1);
assert.equal(second.runResult.governance?.sessionJobCount, 2);
assert.equal(second.runResult.governance?.nextSessionJobCount, 0);
assert.equal(second.runResult.daemon?.recycleReason, 'daemon-session-job-budget');
assert.equal(second.runResult.daemon?.sessionJobCount, 2);

const third = await executor.executeClaimedJob({
  job,
  jobLifecycle: fakeLifecycle,
  logPath: '/tmp/daemon-budget-2.log'
});
assert.equal(third.runResult.executionMode, 'daemon');
assert.equal(third.runResult.governance?.sessionEpoch, 1);
assert.equal(third.runResult.governance?.sessionJobCount, 1);
assert.equal(third.runResult.governance?.recycleCount, 1);
assert.equal(daemonRuns[2]?.daemonOptions?.sessionNamespace, 'svc-indexer:epoch-1');

console.log('indexer service daemon session budget test passed');
