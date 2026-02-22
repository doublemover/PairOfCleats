#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import { createSupervisorSession } from '../helpers/supervisor-session.js';
import assert from 'node:assert/strict';

ensureTestingEnv(process.env);

const { waitForEvent, send, shutdown, forceKill } = createSupervisorSession({ timeoutMs: 10000 });

try {
  await waitForEvent((event) => event.event === 'hello');

  const jobId = 'job-stdout-stream-default';
  send({
    op: 'job:run',
    jobId,
    title: 'Stdout Progress Stream Default',
    command: process.execPath,
    args: [
      '-e',
      "process.stdout.write(JSON.stringify({proto:'poc.progress@2',event:'task:progress',ts:new Date().toISOString(),taskId:'stdout-default-stream',completed:1,total:1}) + '\\n');"
    ]
  });

  const progress = await waitForEvent((event) => (
    event.event === 'task:progress'
    && event.jobId === jobId
    && event.taskId === 'stdout-default-stream'
  ));
  assert.equal(progress.stream, 'stdout');

  const end = await waitForEvent((event) => event.event === 'job:end' && event.jobId === jobId);
  assert.equal(end.status, 'done');

  const exitCode = await shutdown();
  assert.equal(exitCode, 0);

  console.log('supervisor stdout progress default stream test passed');
} catch (error) {
  forceKill();
  console.error(error?.message || error);
  process.exit(1);
}
