#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createWarnOnce, normalizeWarnOnceKey } from '../../../src/shared/logging/warn-once.js';

const messages = [];
const warnOnce = createWarnOnce({
  logger: (message) => {
    messages.push(message);
  }
});

assert.equal(warnOnce('dedupe-key', 'first warning'), true);
assert.equal(warnOnce('dedupe-key', 'second warning'), false);
assert.deepEqual(messages, ['first warning']);

warnOnce.reset();
messages.length = 0;

assert.equal(warnOnce('message-only warning'), true);
assert.equal(warnOnce('message-only warning'), false);
assert.deepEqual(messages, ['message-only warning']);

warnOnce.reset();
messages.length = 0;
const keyA = { b: 2, a: 1 };
const keyB = { a: 1, b: 2 };
assert.equal(normalizeWarnOnceKey(keyA), normalizeWarnOnceKey(keyB));
assert.equal(warnOnce(keyA, 'stable-key warning'), true);
assert.equal(warnOnce(keyB, 'duplicate stable-key warning'), false);
assert.deepEqual(messages, ['stable-key warning']);

console.log('warn-once helper ok.');
