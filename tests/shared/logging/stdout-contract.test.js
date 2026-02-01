#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSubprocessSync } from '../../../src/shared/subprocess.js';

const root = process.cwd();
const binPath = path.join(root, 'bin', 'pairofcleats.js');

const result = spawnSubprocessSync(process.execPath, [binPath, 'version'], {
  env: { ...process.env, PAIROFCLEATS_TESTING: '1' },
  captureStdout: true,
  captureStderr: true,
  outputMode: 'string',
  rejectOnNonZeroExit: false
});

assert.equal(result.exitCode, 0);
assert.equal((result.stdout || '').trim(), '', 'expected no stdout for non-json output');
assert.ok((result.stderr || '').trim().length > 0, 'expected stderr to contain version');

console.log('stdout contract test passed');
