#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createJobExecutor } from '../../../tools/service/indexer-service/job-executor.js';

const daemonRuns = [];
const subprocessRuns = [];

const daemonResults = [
  { exitCode: 1, signal: null, executionMode: 'daemon', cancelled: false, shutdownMode: null, daemon: { sessionKey: 'daemon-session-0' } },
  { exitCode: 1, signal: null, executionMode: 'daemon', cancelled: false, shutdownMode: null, daemon: { sessionKey: 'daemon-session-0' } },
  { exitCode: 0, signal: null, executionMode: 'daemon', cancelled: false, shutdownMode: null, daemon: { sessionKey: 'daemon-session-1' } }
];
const subprocessResults = [
  { exitCode: 0, signal: null, cancelled: false, errorCode: null, errorMessage: null }
];

const executor = createJobExecutor({
  isEmbeddingsQueue: false,
  serviceExecutionMode: 'daemon',
  daemonWorkerConfig: {
    deterministic: true,
    sessionNamespace: 'svc-indexer',
    governance: {
      maxConsecutiveFailures: 2,
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
    const next = daemonResults.shift();
    if (!next) throw new Error('unexpected daemon invocation');
    return {
      ...next,
      daemon: {
        ...next.daemon,
        deterministic: daemonOptions?.deterministic !== false
      }
    };
  },
  runBuildIndexSubprocessImpl: async (repoPath, mode, stage, extraArgs, logPath) => {
    subprocessRuns.push({ repoPath, mode, stage, extraArgs, logPath });
    const next = subprocessResults.shift();
    if (!next) throw new Error('unexpected subprocess invocation');
    return next;
  }
});

const fakeLifecycle = {
  async registerPromise(promise) {
    return await promise;
  }
};

const job = {
  id: 'job-daemon',
  repo: '/tmp/daemon-repo',
  mode: 'code',
  stage: 'stage1',
  args: ['--repo', '/tmp/daemon-repo', '--mode', 'code']
};

const first = await executor.executeClaimedJob({
  job,
  jobLifecycle: fakeLifecycle,
  logPath: '/tmp/daemon-0.log'
});
assert.equal(first.runResult.executionMode, 'daemon');
assert.equal(first.runResult.executionClass, 'daemon-governed');
assert.equal(first.runResult.governance?.decision, 'daemon');
assert.equal(first.runResult.governance?.recycleRequested, false);
assert.equal(first.runResult.governance?.sessionEpoch, 0);

const second = await executor.executeClaimedJob({
  job,
  jobLifecycle: fakeLifecycle,
  logPath: '/tmp/daemon-1.log'
});
assert.equal(second.runResult.executionMode, 'daemon');
assert.equal(second.runResult.governance?.decision, 'daemon');
assert.equal(second.runResult.governance?.recycleRequested, true);
assert.equal(second.runResult.governance?.nextSessionEpoch, 1);
assert.equal(second.runResult.daemon?.recycleRequested, true);

const third = await executor.executeClaimedJob({
  job,
  jobLifecycle: fakeLifecycle,
  logPath: '/tmp/subprocess-fallback.log'
});
assert.equal(third.runResult.executionMode, 'subprocess');
assert.equal(third.runResult.executionClass, 'daemon-governed');
assert.equal(third.runResult.governance?.decision, 'subprocess-fallback');
assert.equal(third.runResult.governance?.cooldownBeforeJob, 1);
assert.equal(third.runResult.governance?.subprocessCooldownRemaining, 0);
assert.equal(third.runResult.daemon?.fallback, true);
assert.equal(subprocessRuns.length, 1);

const fourth = await executor.executeClaimedJob({
  job,
  jobLifecycle: fakeLifecycle,
  logPath: '/tmp/daemon-2.log'
});
assert.equal(fourth.runResult.executionMode, 'daemon');
assert.equal(fourth.runResult.executionClass, 'daemon-governed');
assert.equal(fourth.runResult.governance?.sessionEpoch, 1);
assert.equal(fourth.runResult.governance?.recycleCount, 1);
assert.equal(daemonRuns[2]?.daemonOptions?.sessionNamespace, 'svc-indexer:epoch-1');

console.log('indexer service job-executor daemon governance test passed');
