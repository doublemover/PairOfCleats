#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { createSupervisorProtocolFixture } from './supervisor-fixture.js';

const root = process.cwd();
const ignoreSigtermFixture = path.join(root, 'tests', 'fixtures', 'tui', 'ignore-sigterm.js');
const supervisorEventTimeoutMs = 12000;

const supervisor = createSupervisorProtocolFixture({ timeoutMs: supervisorEventTimeoutMs });

try {
  await supervisor.waitForEvent((event) => event.event === 'hello');

  const jobId = 'job-cancel-propagation';
  supervisor.send({
    op: 'job:run',
    jobId,
    title: 'Cancel Propagation',
    command: process.execPath,
    args: [ignoreSigtermFixture],
    timeoutMs: 10000
  });

  await supervisor.waitForEvent((event) => event.event === 'job:spawn' && event.jobId === jobId);
  supervisor.send({ op: 'job:cancel', jobId, reason: 'test_cancel' });

  const end = await supervisor.waitForEvent((event) => event.event === 'job:end' && event.jobId === jobId);
  assert.equal(end.status, 'cancelled');
  assert.equal(end.exitCode, 130);

  supervisor.send({ op: 'shutdown', reason: 'test_complete' });
  await supervisor.waitForExit();

  console.log('tui cancel propagation test passed');
} catch (error) {
  supervisor.kill();
  console.error(error?.message || error);
  process.exit(1);
}
