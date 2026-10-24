#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import { createSupervisorSession } from '../helpers/supervisor-session.js';
import assert from 'node:assert/strict';
import { isProcessAlive } from '../../src/shared/locks/file-lock-owner.js';

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

  const spawn = await waitForEvent((event) => event.event === 'job:spawn' && event.jobId === jobId);
  for (const reason of [null, false, 0, [], { private: 'SYNTHETIC_CANCEL_SECRET' }, '', 'bad\nreason', 'x'.repeat(257)]) {
    const after = events.length;
    send({ op: 'job:cancel', jobId, reason });
    const response = await waitForEvent(event => events.indexOf(event) >= after && event.jobId === jobId
      && (event.event === 'job:end' || (event.event === 'log' && event.level === 'error')));
    assert.equal(response.event, 'log', 'invalid cancellation input cannot act on the live job');
    assert.equal(response.code, 'ERR_TUI_CANCEL_REASON');
    assert.equal(isProcessAlive(spawn.pid), true);
    const shutdownAfter = events.length;
    send({ op: 'shutdown', reason });
    const denied = await waitForEvent(event => events.indexOf(event) >= shutdownAfter
      && event.event === 'log' && !event.jobId && event.level === 'error');
    assert.equal(denied.code, 'ERR_TUI_CANCEL_REASON');
    assert.equal(isProcessAlive(spawn.pid), true, 'invalid shutdown cannot partially enter the teardown state');
  }
  assert.equal(JSON.stringify(events).includes('SYNTHETIC_CANCEL_SECRET'), false);
  send({ op: 'job:cancel', jobId, reason: 'test_cancel' });

  const end = await waitForEvent((event) => event.event === 'job:end' && event.jobId === jobId);
  assert.equal(end.status, 'cancelled');
  assert.equal(end.exitCode, 130);
  assert.equal(end.attempts, 1);
  assert.equal(end.maxAttempts, 1);
  assert.equal(end.retries, 0);
  assert.equal(end.cancelReason, 'test_cancel');
  assert.equal(end.terminationReason, 'cancelled');
  assert.equal(end.timedOut, false);

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
