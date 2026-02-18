#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSubprocess, spawnSubprocessSync } from '../../../src/shared/subprocess.js';

const script = 'process.stdout.write("ok");';

assert.throws(
  () => spawnSubprocessSync(process.execPath, ['-e', script], { shell: true }),
  (err) => err?.code === 'SUBPROCESS_FAILED' && String(err?.message || '').includes('shell mode is disabled'),
  'expected sync shell execution to be rejected'
);

await assert.rejects(
  () => spawnSubprocess(process.execPath, ['-e', script], { shell: true }),
  (err) => err?.code === 'SUBPROCESS_FAILED' && String(err?.message || '').includes('shell mode is disabled'),
  'expected async shell execution to be rejected'
);

console.log('subprocess shell mode rejection test passed');
