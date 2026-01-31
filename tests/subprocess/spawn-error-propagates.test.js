#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSubprocess } from '../../src/shared/subprocess.js';
import { resolveSilentStdio } from '../helpers/test-env.js';

try {
  await spawnSubprocess('poc-missing-command-xyz', [], {
    stdio: resolveSilentStdio('ignore')
  });
  assert.fail('expected spawn error');
} catch (err) {
  assert.equal(err?.code, 'SUBPROCESS_FAILED');
  assert.ok(err?.result, 'expected result on error');
}

console.log('subprocess spawn error test passed');
