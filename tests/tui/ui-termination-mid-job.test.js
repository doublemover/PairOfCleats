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

  const jobId = 'job-ui-terminate';
  supervisor.send({
    op: 'job:run',
    jobId,
    title: 'UI Mid Job',
    command: process.execPath,
    args: [ignoreSigtermFixture],
    timeoutMs: 20000
  });

  await supervisor.waitForEvent((event) => event.event === 'job:spawn' && event.jobId === jobId);

  const shutdownStart = Date.now();
  supervisor.send({ op: 'shutdown', reason: 'ui_exit' });
  await supervisor.waitForExit();
  const shutdownDurationMs = Date.now() - shutdownStart;

  assert(shutdownDurationMs < 12000, 'expected bounded shutdown duration');
  const end = supervisor.events.find((event) => event.event === 'job:end' && event.jobId === jobId);
  assert(end, 'expected job:end event for in-flight job during shutdown');
  assert.equal(end.status, 'cancelled');

  console.log('tui ui termination mid-job test passed');
} catch (error) {
  supervisor.kill();
  console.error(error?.message || error);
  process.exit(1);
}
