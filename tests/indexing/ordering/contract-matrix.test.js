#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

import { applyTestEnv, ensureTestingEnv } from '../../helpers/test-env.js';
import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';
import { STAGE1_SEQ_STATE } from '../../../src/index/build/indexer/steps/process-files/ordering.js';

{
  const runScenario = async ({ bucketSize }) => {
    const processed = [];
    const appender = buildOrderedAppender(
      async (result) => {
        processed.push(result.id);
      },
      {},
      {
        expectedCount: 6,
        startIndex: 0,
        bucketSize
      }
    );
    await Promise.all([
      appender.enqueue(0, { id: 0 }),
      appender.enqueue(1, { id: 1 }),
      appender.enqueue(2, { id: 2 }),
      appender.enqueue(3, { id: 3 }),
      appender.enqueue(4, { id: 4 }),
      appender.enqueue(5, { id: 5 })
    ]);
    return processed;
  };

  const bucketed = await runScenario({ bucketSize: 2 });
  const unbucketed = await runScenario({ bucketSize: 0 });
  assert.deepEqual(bucketed, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(unbucketed, [0, 1, 2, 3, 4, 5]);
}

{
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const processed = [];
  const appender = buildOrderedAppender(
    async (result) => {
      processed.push(result.id);
    },
    {},
    {
      expectedCount: 2,
      startIndex: 0
    }
  );

  await appender.enqueue(0, { id: 0 });
  await appender.enqueue(1, { id: 1 });
  const lateReplay = appender.enqueue(0, { id: 'late-0' });
  const lateReplayState = await Promise.race([
    lateReplay.then(() => 'resolved', () => 'rejected'),
    sleep(20).then(() => 'pending')
  ]);
  assert.equal(lateReplayState, 'resolved');
  assert.deepEqual(processed, [0, 1]);
  appender.assertCompletion();
}

{
  ensureTestingEnv(process.env);
  const childScript = [
    "import { buildOrderedAppender } from './src/index/build/indexer/steps/process-files/ordered.js';",
    'const appender = buildOrderedAppender(async () => {}, {}, {',
    '  expectedCount: 6,',
    '  startIndex: 0,',
    '  maxPendingBeforeBackpressure: 2',
    '});',
    'void appender.enqueue(1, { id: 1 }).catch(() => {});',
    'void appender.enqueue(2, { id: 2 }).catch(() => {});',
    'void appender.enqueue(3, { id: 3 }).catch(() => {});',
    'await appender.waitForCapacity({ orderIndex: 20, bypassWindow: 0 });'
  ].join('\n');

  const child = spawn(
    process.execPath,
    ['--input-type=module', '-e', childScript],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(child.exitCode, null, `expected child to remain alive while blocked; stderr=${stderr || '<empty>'}`);
  child.kill();
  const closeResult = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (exitCode, signal) => resolve({ exitCode, signal }));
  });
  assert.notEqual(closeResult.exitCode, 13, `expected keepalive to avoid exit 13; stderr=${stderr || '<empty>'}`);
}

{
  applyTestEnv();
  const committed = [];
  const appender = buildOrderedAppender(
    async (result) => {
      committed.push(result.id);
    },
    {},
    {
      expectedIndices: [0, 1]
    }
  );

  appender.noteInFlight(0, 100);
  appender.noteInFlight(1, 101);
  const seq1Done = appender.enqueue(1, { id: 1 }, null);
  const resetCount = appender.resetForRetry([0, 1]);
  assert.equal(resetCount, 1);
  const snapshotAfterReset = appender.snapshot();
  assert.equal(snapshotAfterReset.nextIndex, 0);
  assert.equal(snapshotAfterReset.inFlightCount, 0);
  assert.equal(snapshotAfterReset.headState, STAGE1_SEQ_STATE.UNSEEN);
  const seq0Done = appender.enqueue(0, { id: 0 }, null);
  await Promise.all([seq0Done, seq1Done]);
  await appender.drain();
  appender.assertCompletion();
  assert.deepEqual(committed, [0, 1]);
}

console.log('indexing ordering contract matrix test passed');
