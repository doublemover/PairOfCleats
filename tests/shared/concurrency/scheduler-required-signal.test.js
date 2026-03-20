#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency.js';

const scheduler = createBuildScheduler({
  requireSignals: true,
  requiredSignalQueues: ['stage1.cpu']
});

await assert.rejects(
  scheduler.schedule('stage1.cpu', { cpu: 1 }, async () => 'missing-signal'),
  (error) => (
    error?.code === 'SCHEDULER_SIGNAL_REQUIRED'
    && error?.meta?.queueName === 'stage1.cpu'
  ),
  'expected required-signal queues to reject tasks without an AbortSignal'
);

const controller = new AbortController();
const allowed = await scheduler.schedule(
  'stage1.cpu',
  { cpu: 1, signal: controller.signal },
  async () => 'with-signal'
);
assert.equal(allowed, 'with-signal', 'expected required-signal queue to run when a signal is present');

const unrestricted = await scheduler.schedule('stage1.io', { io: 1 }, async () => 'no-signal-needed');
assert.equal(unrestricted, 'no-signal-needed', 'expected unrestricted queues to run without a signal');

scheduler.shutdown();

console.log('scheduler required signal test passed');
