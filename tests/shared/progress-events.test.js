#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createProgressReporter, createStreamLineProgressForwarder } from '../../src/shared/progress-events.js';

const events = [];
const reporter = createProgressReporter({
  progress(event) {
    events.push(event);
  }
});

assert.ok(reporter, 'expected reporter to be created');
reporter.start('Downloading dictionaries.', { observability: { operation: 'download' } });
reporter.emit('Still working.', { phase: 'progress' });
reporter.done('Dictionary download complete.', { observability: { operation: 'download' } });

const forwardLine = createStreamLineProgressForwarder({
  progress(event) {
    events.push(event);
  }
});
assert.ok(forwardLine, 'expected line forwarder to be created');
forwardLine({ stream: 'stderr', line: 'fetching shard 1/4' });

assert.deepEqual(events, [
  { phase: 'start', message: 'Downloading dictionaries.', observability: { operation: 'download' } },
  { message: 'Still working.', phase: 'progress' },
  { phase: 'done', message: 'Dictionary download complete.', observability: { operation: 'download' } },
  { message: 'fetching shard 1/4', stream: 'stderr' }
]);

assert.equal(createProgressReporter({}), null);
assert.equal(createStreamLineProgressForwarder({}), null);

console.log('progress events test passed');
