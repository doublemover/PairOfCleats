#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  createTrackedProcessFileTaskRegistry,
  drainTrackedProcessFileTasks,
  runStage1TailCleanupTasks
} from '../../../src/index/build/indexer/steps/process-files.js';

ensureTestingEnv(process.env);

const createDeferred = () => {
  let resolve = null;
  let reject = null;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const timeoutLogs = [];
const timedOutRegistry = createTrackedProcessFileTaskRegistry({
  name: 'process-files-inflight-drain-timeout'
});
const timedOutTask = createDeferred();
timedOutRegistry.track(timedOutTask.promise, {
  file: 'src/stuck.rb',
  fileIndex: 42,
  orderIndex: 7,
  shardId: 'shard-a',
  startedAtMs: Date.now() - 75
});
const timedOutResult = await drainTrackedProcessFileTasks({
  registry: timedOutRegistry,
  timeoutMs: 25,
  log: (line, meta = {}) => timeoutLogs.push({
    line: String(line),
    meta
  })
});
assert.equal(timedOutResult.timedOut, true, 'expected pending process-file drain to time out');
assert.ok(
  timeoutLogs.some((entry) => entry.line.includes('src/stuck.rb')),
  'expected timeout log to include pending file path'
);
assert.ok(
  timeoutLogs.some((entry) => entry.line.includes('seq=7')),
  'expected timeout log to include pending order index'
);
assert.ok(
  timeoutLogs.some((entry) => entry.line.includes('shard=shard-a')),
  'expected timeout log to include pending shard id'
);
timedOutTask.resolve();
await timedOutRegistry.drain();

const sequencingRegistry = createTrackedProcessFileTaskRegistry({
  name: 'process-files-inflight-drain-sequencing'
});
const sequencingTask = createDeferred();
sequencingRegistry.track(sequencingTask.promise, {
  file: 'src/slow.swift',
  fileIndex: 3,
  orderIndex: 11,
  startedAtMs: Date.now()
});
const cleanupOrder = [];
const cleanupPromise = runStage1TailCleanupTasks({
  sequential: true,
  tasks: [
    {
      label: 'stage1.process-file-drain',
      run: async () => {
        cleanupOrder.push('drain:start');
        const result = await drainTrackedProcessFileTasks({
          registry: sequencingRegistry,
          timeoutMs: 1000
        });
        cleanupOrder.push('drain:end');
        return result;
      }
    },
    {
      label: 'tree-sitter-scheduler.close',
      run: async () => {
        cleanupOrder.push('scheduler:close');
        return {
          skipped: false,
          timedOut: false,
          elapsedMs: 0
        };
      }
    }
  ]
});
await sleep(40);
assert.deepEqual(
  cleanupOrder,
  ['drain:start'],
  'expected sequential cleanup to wait for process-file drain before closing scheduler'
);
sequencingTask.resolve();
await cleanupPromise;
assert.deepEqual(
  cleanupOrder,
  ['drain:start', 'drain:end', 'scheduler:close'],
  'expected scheduler close to happen only after tracked process-file work settled'
);

console.log('process files inflight drain test passed');
