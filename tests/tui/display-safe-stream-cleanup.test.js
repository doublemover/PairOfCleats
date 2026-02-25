#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ensureTestingEnv } from '../helpers/test-env.js';
import { createDisplay } from '../../src/shared/cli/display.js';

ensureTestingEnv(process.env);

class MemoryStream extends EventEmitter {
  constructor() {
    super();
    this.isTTY = false;
    this.destroyed = false;
    this.writableEnded = false;
  }

  write() {
    return true;
  }
}

const stream = new MemoryStream();
const display = createDisplay({
  stream,
  progressMode: 'log',
  quiet: false,
  json: false
});

assert.equal(stream.listenerCount('error'), 1, 'expected safe stream error listener');
assert.equal(stream.listenerCount('close'), 1, 'expected safe stream close listener');
assert.equal(stream.listenerCount('finish'), 1, 'expected safe stream finish listener');

display.close();
display.close();

assert.equal(stream.listenerCount('error'), 0, 'safe stream error listener should be removed on close');
assert.equal(stream.listenerCount('close'), 0, 'safe stream close listener should be removed on close');
assert.equal(stream.listenerCount('finish'), 0, 'safe stream finish listener should be removed on close');

console.log('display safe stream cleanup test passed');
