#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ensureTestingEnv } from '../helpers/test-env.js';
import { createDisplay } from '../../src/shared/cli/display.js';

ensureTestingEnv(process.env);

class ClosedWriteStream extends EventEmitter {
  constructor() {
    super();
    this.isTTY = false;
    this.destroyed = false;
    this.writableEnded = false;
  }

  write() {
    const err = new Error('simulated closed stream');
    err.code = 'EPIPE';
    throw err;
  }
}

const stream = new ClosedWriteStream();
const display = createDisplay({
  stream,
  progressMode: 'log',
  quiet: false,
  json: false
});

assert.doesNotThrow(() => {
  display.log('first write should be guarded');
});
assert.doesNotThrow(() => {
  display.warn('second write should be ignored once closed');
});

display.close();

console.log('display closed stream guard test passed');
