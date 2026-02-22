#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import { createSupervisorSession } from '../helpers/supervisor-session.js';
import assert from 'node:assert/strict';

ensureTestingEnv(process.env);

const { events, waitForEvent, send, shutdown, forceKill } = createSupervisorSession();

try {
  await waitForEvent((event) => event.event === 'hello');

  const jobId = 'job-lifecycle-1';
  send({
    op: 'job:run',
    jobId,
    title: 'Lifecycle',
    argv: ['search', '--help']
  });

  const start = await waitForEvent((event) => event.event === 'job:start' && event.jobId === jobId);
  const spawnEvent = await waitForEvent((event) => event.event === 'job:spawn' && event.jobId === jobId);
  const end = await waitForEvent((event) => event.event === 'job:end' && event.jobId === jobId);
  await waitForEvent((event) => event.event === 'job:artifacts' && event.jobId === jobId);

  assert.equal(start.jobId, jobId);
  assert.equal(spawnEvent.jobId, jobId);
  assert.equal(end.jobId, jobId);
  assert.ok(['done', 'failed', 'cancelled'].includes(end.status));

  const startIndex = events.indexOf(start);
  const spawnIndex = events.indexOf(spawnEvent);
  const endIndex = events.indexOf(end);
  assert(startIndex >= 0 && spawnIndex > startIndex && endIndex > spawnIndex, 'expected lifecycle ordering start -> spawn -> end');

  send({
    op: 'job:run',
    jobId,
    title: 'Lifecycle Reuse',
    argv: ['search', '--help']
  });
  const secondStart = await waitForEvent((event) => (
    event.event === 'job:start'
    && event.jobId === jobId
    && event.title === 'Lifecycle Reuse'
  ));
  const secondStartIndex = events.indexOf(secondStart);
  const secondEnd = await waitForEvent((event) => (
    event.event === 'job:end'
    && event.jobId === jobId
    && events.indexOf(event) > secondStartIndex
  ));
  assert.ok(secondStart, 'expected second run with same jobId to be accepted');
  assert.ok(['done', 'failed', 'cancelled'].includes(secondEnd.status));
  const duplicateIdErrors = events.filter((event) => (
    event.event === 'log'
    && event.level === 'error'
    && String(event.message || '').includes('job already exists')
  ));
  assert.equal(duplicateIdErrors.length, 0, 'completed job IDs should be reusable');

  await shutdown();

  console.log('supervisor lifecycle state machine test passed');
} catch (error) {
  forceKill();
  console.error(error?.message || error);
  process.exit(1);
}
