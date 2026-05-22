#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  runStage1NestedSchedulerProbe,
  sleep
} from './stage1-nested-scheduler-fixture.js';

let procTasksStarted = 0;
const { result, timeoutResult } = await runStage1NestedSchedulerProbe(
  [
    { key: 'procQueue', queueName: 'stage1.proc', tokens: { mem: 1 } }
  ],
  ({ cpuQueue, queues: { procQueue } }) => [
    cpuQueue.add(async () => {
      await procQueue.add(async () => {
        procTasksStarted += 1;
        await sleep(5);
        return 'p1';
      });
      return 'c1';
    }),
    cpuQueue.add(async () => {
      await procQueue.add(async () => {
        procTasksStarted += 1;
        await sleep(5);
        return 'p2';
      });
      return 'c2';
    })
  ]
);

assert.notEqual(result, timeoutResult, 'nested stage1.proc tasks should not deadlock under parse cap');
assert.equal(procTasksStarted, 2, 'expected both nested stage1.proc tasks to run');

console.log('scheduler stage1.proc nested deadlock test passed');
