#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import { createSupervisorSession } from '../helpers/supervisor-session.js';
import assert from 'node:assert/strict';

ensureTestingEnv(process.env);

const { waitForEvent, send, shutdown, forceKill } = createSupervisorSession({ timeoutMs: 10000 });

try {
  await waitForEvent((event) => event.event === 'hello');

  const jsonJobId = 'job-capture-json';
  send({
    op: 'job:run',
    jobId: jsonJobId,
    title: 'Capture Json',
    command: process.execPath,
    args: ['-e', "process.stdout.write(JSON.stringify({ok:true,count:2}) + '\\n');"],
    resultPolicy: {
      captureStdout: 'json'
    }
  });

  const jsonEnd = await waitForEvent((event) => event.event === 'job:end' && event.jobId === jsonJobId);
  assert.equal(jsonEnd.status, 'done');
  assert.equal(jsonEnd.result?.ok, true);
  assert.equal(jsonEnd.result?.count, 2);

  const textJobId = 'job-capture-text';
  send({
    op: 'job:run',
    jobId: textJobId,
    title: 'Capture Text',
    command: process.execPath,
    args: ['-e', "process.stdout.write('plain-text-output\\n');"],
    captureStdout: true
  });

  const textEnd = await waitForEvent((event) => event.event === 'job:end' && event.jobId === textJobId);
  assert.equal(textEnd.status, 'done');
  assert.equal(textEnd.result, 'plain-text-output');

  const exitCode = await shutdown();
  assert.equal(exitCode, 0);

  console.log('supervisor result policy capture stdout test passed');
} catch (error) {
  forceKill();
  console.error(error?.message || error);
  process.exit(1);
}
