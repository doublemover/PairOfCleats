#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import { createSupervisorSession } from '../helpers/supervisor-session.js';
import assert from 'node:assert/strict';

ensureTestingEnv(process.env);

const { child, waitForEvent, send, shutdown, forceKill } = createSupervisorSession();

try {
  await waitForEvent((event) => event.event === 'hello');

  const jobId = 'job-invalid-run-request';
  send({
    op: 'job:run',
    jobId,
    title: 'Invalid Request'
  });

  const end = await waitForEvent((event) => event.event === 'job:end' && event.jobId === jobId);
  assert.equal(end.status, 'failed');
  assert.equal(end.error?.code, 'INVALID_REQUEST');
  assert.equal(child.exitCode, null, 'supervisor must remain alive after invalid job request');

  const exitCode = await shutdown();
  assert.equal(exitCode, 0);

  console.log('supervisor invalid run request test passed');
} catch (error) {
  forceKill();
  console.error(error?.message || error);
  process.exit(1);
}
