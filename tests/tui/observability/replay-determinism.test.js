#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createSupervisorFixture,
  pathExists,
  readTextLines,
  resolveEventLogPath
} from './supervisor-fixture.js';

const runId = `run-replay-${process.pid}`;
let fixture;
try {
  fixture = await createSupervisorFixture({
    tempPrefix: 'poc-tui-replay-',
    runId
  });

  await fixture.waitForEvent((event) => event.event === 'hello');
  const jobId = 'job-replay-1';
  fixture.send({
    op: 'job:run',
    jobId,
    title: 'replay',
    command: process.execPath,
    args: ['-e', 'console.log("alpha"); console.error("beta");']
  });
  await fixture.waitForEvent((event) => event.event === 'job:end' && event.jobId === jobId);
  await fixture.shutdown();

  const replayPath = resolveEventLogPath(fixture);
  assert.equal(pathExists(replayPath), true, 'expected replay log file');
  assert.deepEqual(
    readTextLines(replayPath),
    fixture.stdoutLines,
    'replay log must match emitted protocol stream exactly'
  );

  console.log('tui observability replay determinism test passed');
} finally {
  await fixture?.cleanup();
}
