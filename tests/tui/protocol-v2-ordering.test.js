#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createProgressLineDecoder } from '../../src/shared/cli/progress-stream.js';
import { formatProgressEvent } from '../../src/shared/cli/progress-events.js';

const lines = [
  formatProgressEvent('task:start', { runId: 'run-1', jobId: 'job-1', seq: 1, taskId: 'a', name: 'A' }),
  formatProgressEvent('task:progress', { runId: 'run-1', jobId: 'job-1', seq: 2, taskId: 'a', current: 1, total: 2 }),
  formatProgressEvent('task:end', { runId: 'run-1', jobId: 'job-1', seq: 3, taskId: 'a', status: 'done' })
].map((entry) => JSON.stringify(entry));

const seen = [];
const decoder = createProgressLineDecoder({
  strict: true,
  onLine: ({ event }) => {
    if (event) seen.push(event.seq);
  }
});

decoder.push(`${lines[0]}\n${lines[1].slice(0, 20)}`);
decoder.push(`${lines[1].slice(20)}\n${lines[2]}\n`);
decoder.flush();

assert.deepEqual(seen, [1, 2, 3]);
console.log('protocol v2 ordering test passed');
