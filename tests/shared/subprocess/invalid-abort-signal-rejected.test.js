#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSubprocess } from '../../../src/shared/subprocess.js';

await assert.rejects(
  () => spawnSubprocess(process.execPath, ['-e', 'console.log("ok")'], {
    signal: { aborted: false }
  }),
  (error) => (
    error?.code === 'SUBPROCESS_FAILED'
    && /Invalid AbortSignal/.test(String(error?.message || ''))
    && error?.result?.pid == null
  ),
  'expected invalid signal input to be rejected before spawn'
);

console.log('subprocess invalid abort-signal rejected test passed');
