#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import { createDisplay } from '../../src/shared/cli/display.js';

ensureTestingEnv(process.env);

const writes = [];
const stream = {
  isTTY: false,
  write(chunk) {
    writes.push(String(chunk));
    return true;
  }
};

const previous = process.env.PAIROFCLEATS_PROGRESS_CONTEXT;
process.env.PAIROFCLEATS_PROGRESS_CONTEXT = JSON.stringify({ runId: 'run-ctx', jobId: 'job-ctx' });

try {
  const display = createDisplay({
    stream,
    progressMode: 'jsonl',
    json: false,
    quiet: false
  });
  display.log('context test');
  const task = display.task('Context Task', { stage: 'index', taskId: 'ctx-task' });
  task.set(1, 1);
  task.done();
  display.flush();
  display.close();
} finally {
  if (previous == null) delete process.env.PAIROFCLEATS_PROGRESS_CONTEXT;
  else process.env.PAIROFCLEATS_PROGRESS_CONTEXT = previous;
}

const events = writes
  .join('')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line));

assert(events.length >= 2, 'expected at least log/task events');
for (const event of events) {
  assert.equal(event.proto, 'poc.progress@2');
  assert.equal(event.runId, 'run-ctx');
  assert.equal(event.jobId, 'job-ctx');
}

console.log('progress context propagation test passed');
