#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../helpers/test-env.js';
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

const display = createDisplay({
  stream,
  progressMode: 'log',
  quiet: true,
  json: false
});

display.log('suppressed');
display.log('forced', { forceOutput: true });
display.warn('forced warn', { forceOutput: true });
display.error('always shown');
display.close();

const output = writes.join('');
assert(!output.includes('suppressed'), 'quiet info logs should be suppressed');
assert(output.includes('forced\n'), 'forceOutput should emit info logs while quiet');
assert(output.includes('[warn] forced warn\n'), 'forceOutput should emit warn logs while quiet');
assert(output.includes('[error] always shown\n'), 'error logs should always emit while quiet');

console.log('display force output test passed');
