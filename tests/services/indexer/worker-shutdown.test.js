#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createQueueWorker } from '../../../tools/service/indexer-service/queue-worker.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createHarness = () => {
  let activeCount = 0;
  let remainingJobs = [];
  let state = {
    mode: 'running',
    accepting: true,
    stopClaiming: false,
    forceAbort: false,
    deadlineAt: null
  };
  const completedReasons = [];
  const workerStates = [];
  const finalized = [];
  const printPayloads = [];
  const requestState = (mode, timeoutMs = null) => {
    const requestedAt = new Date().toISOString();
    const deadlineAt = timeoutMs != null
      ? new Date(Date.parse(requestedAt) + timeoutMs).toISOString()
      : null;
    state = {
      mode,
      accepting: mode === 'running',
      stopClaiming: mode === 'cancel' || mode === 'force-stop',
      forceAbort: mode === 'cancel' || mode === 'force-stop',
      deadlineAt
    };
  };
  return {
    setJobs(jobs) {
      remainingJobs = jobs.map((job) => ({ ...job }));
    },
    get finalized() {
      return finalized;
    },
    get completedReasons() {
      return completedReasons;
    },
    get workerStates() {
      return workerStates;
    },
    get printPayloads() {
      return printPayloads;
    },
    requestState,
    createWorker() {
      return createQueueWorker({
        queueDir: '/tmp/service-queue',
        resolvedQueueName: 'index',
        staleQueueMaxRetries: 2,
        monitorBuildProgress: false,
        startBuildProgressMonitor: () => async () => {},
        touchJobHeartbeat: async () => null,
        requeueStaleJobs: async () => null,
        claimNextJob: async () => {
          if (state.stopClaiming) return null;
          const next = remainingJobs.shift() || null;
          if (next) activeCount += 1;
          return next;
        },
        ensureQueueDir: async () => {},
        executeClaimedJob: async ({ job, abortSignal }) => {
          if (job.kind === 'slow') {
            return await new Promise((resolve) => {
              const timer = setTimeout(() => {
                resolve({
                  handled: false,
                  runResult: {
                    exitCode: 0,
                    signal: null,
                    executionMode: 'subprocess',
                    daemon: null,
                    cancelled: false,
                    shutdownMode: null
                  }
                });
              }, 250);
              abortSignal.addEventListener('abort', () => {
                clearTimeout(timer);
                resolve({
                  handled: false,
                  runResult: {
                    exitCode: 130,
                    signal: null,
                    executionMode: 'subprocess',
                    daemon: null,
                    cancelled: true,
                    shutdownMode: state.mode
                  }
                });
              }, { once: true });
            });
          }
          await sleep(20);
          return {
            handled: false,
            runResult: {
              exitCode: 0,
              signal: null,
              executionMode: 'subprocess',
              daemon: null,
              cancelled: false,
              shutdownMode: null
            }
          };
        },
        finalizeJobRun: async ({ job, runResult }) => {
          activeCount = Math.max(0, activeCount - 1);
          finalized.push({ id: job.id, cancelled: runResult?.cancelled === true, shutdownMode: runResult?.shutdownMode || null });
        },
        buildDefaultRunResult: () => ({
          exitCode: 1,
          signal: null,
          executionMode: 'subprocess',
          daemon: null,
          cancelled: false,
          shutdownMode: null
        }),
        printPayload: (payload) => {
          printPayloads.push(payload);
        },
        summarizeBackpressure: async () => null,
        queueSummary: async () => ({
          total: remainingJobs.length + activeCount,
          queued: remainingJobs.length,
          running: activeCount,
          done: 0,
          failed: 0,
          retries: 0
        }),
        loadShutdownState: async () => state,
        requestShutdownState: async ({ mode, timeoutMs = null }) => {
          requestState(mode, timeoutMs);
          return state;
        },
        updateShutdownWorkerState: async (patch) => {
          workerStates.push(patch);
          return patch;
        },
        completeShutdownState: async ({ reason }) => {
          completedReasons.push(reason || null);
          return { reason };
        },
        resolveLeasePolicy: () => ({
          leaseMs: 1000,
          renewIntervalMs: 100,
          progressIntervalMs: 100,
          workloadClass: 'balanced',
          maxRenewalGapMs: 500,
          maxConsecutiveRenewalFailures: 2
        }),
        jobHeartbeatIntervalMs: 100,
        shutdownPollIntervalMs: 50
      });
    }
  };
};

const drainHarness = createHarness();
drainHarness.setJobs([
  { id: 'drain-a', repo: '/tmp/a', mode: 'code', stage: 'stage1', kind: 'fast' },
  { id: 'drain-b', repo: '/tmp/b', mode: 'code', stage: 'stage1', kind: 'fast' }
]);
drainHarness.requestState('drain', 1000);
await drainHarness.createWorker().runWorkLoop({
  requestedConcurrency: 1,
  intervalMs: 10,
  watch: true,
  serviceExecutionMode: 'subprocess'
});
assert.deepEqual(drainHarness.finalized.map((entry) => entry.id), ['drain-a', 'drain-b']);
assert.deepEqual(drainHarness.completedReasons, ['drain-complete']);

const cancelHarness = createHarness();
cancelHarness.setJobs([
  { id: 'cancel-a', repo: '/tmp/a', mode: 'code', stage: 'stage1', kind: 'slow' },
  { id: 'cancel-b', repo: '/tmp/b', mode: 'code', stage: 'stage1', kind: 'fast' }
]);
const cancelWorker = cancelHarness.createWorker();
const cancelPromise = cancelWorker.runWorkLoop({
  requestedConcurrency: 1,
  intervalMs: 10,
  watch: true,
  serviceExecutionMode: 'subprocess'
});
await sleep(40);
cancelHarness.requestState('cancel', 500);
await cancelPromise;
assert.deepEqual(cancelHarness.finalized.map((entry) => entry.id), ['cancel-a']);
assert.equal(cancelHarness.finalized[0]?.cancelled, true);
assert.equal(cancelHarness.completedReasons.at(-1), 'cancel-complete');

const timeoutHarness = createHarness();
timeoutHarness.setJobs([
  { id: 'timeout-a', repo: '/tmp/a', mode: 'code', stage: 'stage1', kind: 'slow' }
]);
timeoutHarness.requestState('drain', 20);
await timeoutHarness.createWorker().runWorkLoop({
  requestedConcurrency: 1,
  intervalMs: 10,
  watch: true,
  serviceExecutionMode: 'subprocess'
});
assert.equal(timeoutHarness.finalized[0]?.cancelled, true);
assert.equal(timeoutHarness.completedReasons.at(-1), 'force-stop-complete');

console.log('indexer service worker shutdown test passed');
