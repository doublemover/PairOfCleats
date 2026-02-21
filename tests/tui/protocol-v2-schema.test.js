#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import { formatProgressEvent, parseProgressEventLine, PROGRESS_PROTOCOL } from '../../src/shared/cli/progress-events.js';

ensureTestingEnv(process.env);

const event = formatProgressEvent('task:progress', {
  runId: 'run-1',
  jobId: 'job-1',
  seq: 1,
  taskId: 'index',
  current: 1,
  total: 2
});

assert.equal(event.proto, PROGRESS_PROTOCOL);
assert.equal(event.event, 'task:progress');

const strictParsed = parseProgressEventLine(JSON.stringify(event), { strict: true });
assert.strictEqual(strictParsed?.proto, PROGRESS_PROTOCOL);

const legacyLine = JSON.stringify({ event: 'task:progress', ts: new Date().toISOString(), taskId: 'legacy' });
assert.equal(parseProgressEventLine(legacyLine, { strict: true }), null);
assert.equal(parseProgressEventLine(legacyLine, { strict: false })?.event, 'task:progress');

console.log('protocol v2 schema test passed');
