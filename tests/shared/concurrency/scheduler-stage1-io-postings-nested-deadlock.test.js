#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  runStage1NestedSchedulerProbe,
  sleep
} from './stage1-nested-scheduler-fixture.js';

let ioTasksStarted = 0;
let postingsTasksStarted = 0;
const { result, timeoutResult } = await runStage1NestedSchedulerProbe(
  [
    { key: 'ioQueue', queueName: 'stage1.io', tokens: { io: 1 } },
    { key: 'postingsQueue', queueName: 'stage1.postings', tokens: { mem: 1 } }
  ],
  ({ cpuQueue, queues: { ioQueue, postingsQueue } }) => [
    cpuQueue.add(async () => {
      await ioQueue.add(async () => {
        ioTasksStarted += 1;
        await sleep(5);
      });
      await postingsQueue.add(async () => {
        postingsTasksStarted += 1;
        await sleep(5);
      });
      return 'c1';
    }),
    cpuQueue.add(async () => {
      await ioQueue.add(async () => {
        ioTasksStarted += 1;
        await sleep(5);
      });
      await postingsQueue.add(async () => {
        postingsTasksStarted += 1;
        await sleep(5);
      });
      return 'c2';
    })
  ]
);

assert.notEqual(
  result,
  timeoutResult,
  'nested stage1.io/stage1.postings tasks should not deadlock under parse cap'
);
assert.equal(ioTasksStarted, 2, 'expected both nested stage1.io tasks to run');
assert.equal(postingsTasksStarted, 2, 'expected both nested stage1.postings tasks to run');

console.log('scheduler stage1.io/stage1.postings nested deadlock test passed');
