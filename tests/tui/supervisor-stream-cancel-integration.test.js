#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import { createSupervisorSession } from '../helpers/supervisor-session.js';
import assert from 'node:assert/strict';

ensureTestingEnv(process.env);

const { events, waitForEvent, send, shutdown, forceKill } = createSupervisorSession({ timeoutMs: 10000 });

try {
  await waitForEvent((event) => event.event === 'hello');

  const jobId = 'job-cancel-1';
  send({
    op: 'job:run',
    jobId,
    title: 'Cancel Integration',
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000);']
  });

  await waitForEvent((event) => event.event === 'job:spawn' && event.jobId === jobId);
  send({ op: 'job:cancel', jobId, reason: 'test_cancel' });

  const end = await waitForEvent((event) => event.event === 'job:end' && event.jobId === jobId);
  assert.equal(end.status, 'cancelled');
  assert.equal(end.exitCode, 130);

  for (const event of events) {
    assert.equal(event.proto, 'poc.progress@2', 'supervisor stdout must emit only protocol events');
  }

  await shutdown();

  console.log('supervisor stream/cancel integration test passed');
} catch (error) {
  forceKill();
  console.error(error?.message || error);
  process.exit(1);
}
