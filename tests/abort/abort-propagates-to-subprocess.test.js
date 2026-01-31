#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSubprocess } from '../../src/shared/subprocess.js';
import { resolveSilentStdio } from '../helpers/test-env.js';

const controller = new AbortController();
const args = ['-e', 'setInterval(() => {}, 1000)'];

setTimeout(() => controller.abort(), 50);

try {
  await spawnSubprocess(process.execPath, args, {
    stdio: resolveSilentStdio('ignore'),
    signal: controller.signal
  });
  assert.fail('expected abort');
} catch (err) {
  assert.equal(err?.code, 'ABORT_ERR');
}

console.log('abort propagation to subprocess test passed');
