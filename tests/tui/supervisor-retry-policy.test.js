#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import { createSupervisorSession } from '../helpers/supervisor-session.js';
import assert from 'node:assert/strict';

ensureTestingEnv(process.env);

const { events, waitForEvent, send, shutdown, forceKill } = createSupervisorSession();

try {
  await waitForEvent((event) => event.event === 'hello');

  const jobId = 'job-retry-1';
  send({
    op: 'job:run',
    jobId,
    title: 'Retry',
    argv: ['definitely-not-a-real-command'],
    retry: {
      maxAttempts: 2,
      delayMs: 1
    }
  });

  const end = await waitForEvent((event) => event.event === 'job:end' && event.jobId === jobId);
  assert.equal(end.status, 'failed');

  const retryLogs = events.filter((event) => (
    event.event === 'log'
    && event.jobId === jobId
    && String(event.message || '').includes('retrying')
  ));
  assert(retryLogs.length >= 1, 'expected retry log emission for failed first attempt');

  await shutdown();

  console.log('supervisor retry policy test passed');
} catch (error) {
  forceKill();
  console.error(error?.message || error);
  process.exit(1);
}
