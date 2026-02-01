#!/usr/bin/env node
import assert from 'node:assert/strict';
import { formatProgressEvent, parseProgressEventLine } from '../../../src/shared/cli/progress-events.js';

const progressEvent = formatProgressEvent('task:progress', {
  taskId: 'Files',
  current: 10,
  total: 100,
  stage: 'processing',
  mode: 'code',
  message: 'scanning'
});
const parsedProgress = parseProgressEventLine(JSON.stringify(progressEvent));
assert.equal(parsedProgress.event, 'task:progress');
assert.equal(parsedProgress.taskId, 'Files');
assert.equal(parsedProgress.current, 10);
assert.equal(parsedProgress.total, 100);
assert.equal(parsedProgress.stage, 'processing');
assert.equal(parsedProgress.mode, 'code');
assert.equal(parsedProgress.message, 'scanning');

const logEvent = formatProgressEvent('log', { level: 'warn', message: 'Heads up' });
const parsedLog = parseProgressEventLine(JSON.stringify(logEvent));
assert.equal(parsedLog.event, 'log');
assert.equal(parsedLog.level, 'warn');
assert.equal(parsedLog.message, 'Heads up');

assert.equal(parseProgressEventLine('not json'), null);
assert.equal(parseProgressEventLine(''), null);

console.log('bench-language progress event parse test passed');
