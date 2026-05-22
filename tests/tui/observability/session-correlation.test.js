#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createSupervisorFixture,
  pathExists,
  readJsonFile,
  readJsonlEvents,
  resolveEventLogPath,
  resolveMetaPath
} from './supervisor-fixture.js';

const runId = `run-correlation-${process.pid}`;
let fixture;
try {
  fixture = await createSupervisorFixture({
    tempPrefix: 'poc-tui-observe-',
    runId
  });

  await fixture.waitForEvent((event) => event.event === 'hello');
  const jobId = 'job-observe-1';
  fixture.send({
    op: 'job:run',
    jobId,
    title: 'observability',
    command: process.execPath,
    args: ['-e', 'console.log("hello");']
  });
  await fixture.waitForEvent((event) => event.event === 'job:end' && event.jobId === jobId);
  await fixture.shutdown();

  const eventLogPath = resolveEventLogPath(fixture);
  const metaPath = resolveMetaPath(fixture);
  assert.equal(pathExists(eventLogPath), true, 'expected replay event log');
  assert.equal(pathExists(metaPath), true, 'expected replay metadata');

  const loggedEvents = readJsonlEvents(eventLogPath);
  assert(loggedEvents.length > 0, 'expected replay log lines');
  for (const event of loggedEvents) {
    assert.equal(event.runId, runId, 'expected stable run correlation in replay log');
  }

  const meta = await readJsonFile(metaPath);
  assert.equal(meta.runId, runId, 'metadata must carry runId');

  console.log('tui observability session correlation test passed');
} finally {
  await fixture?.cleanup();
}
