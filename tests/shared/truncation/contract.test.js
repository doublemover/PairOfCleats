#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createTruncationRecorder } from '../../../src/shared/truncation.js';

const recorder = createTruncationRecorder();
assert.equal(recorder.list.length, 0);

recorder.record('maxTokens', { value: 100 });
recorder.record('maxTokens', { value: 200 });
assert.equal(recorder.list.length, 1);
assert.deepEqual(recorder.list[0], {
  scope: 'truncation',
  cap: 'maxTokens',
  value: 100
});

const list = [];
const scoped = createTruncationRecorder({ scope: 'graph', target: list });
scoped.record('maxNodes', { count: 5 });
scoped.record('maxEdges', { count: 10 });
assert.equal(list.length, 2);
assert.deepEqual(list[0], { scope: 'graph', cap: 'maxNodes', count: 5 });
assert.deepEqual(list[1], { scope: 'graph', cap: 'maxEdges', count: 10 });

console.log('truncation recorder ok');
