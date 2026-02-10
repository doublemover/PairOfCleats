#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSubprocessSync } from '../../../src/shared/subprocess.js';

const shellSensitiveArgs = [
  'R&D.txt',
  'foo|bar',
  'semi;colon',
  'redir<in',
  'redir>out',
  'space value',
  'dollar$ign',
  'paren(one)',
  'quote"double',
  "single'quote",
  'back`tick'
];

const script = 'process.stdout.write(JSON.stringify(process.argv.slice(1)));';
const result = spawnSubprocessSync(process.execPath, ['-e', script, ...shellSensitiveArgs], {
  shell: true,
  outputMode: 'string',
  captureStdout: true,
  captureStderr: true
});

assert.equal(result.exitCode, 0, `expected zero exit code, stderr=${result.stderr || ''}`);
const parsed = JSON.parse(typeof result.stdout === 'string' && result.stdout ? result.stdout : '[]');
assert.deepEqual(parsed, shellSensitiveArgs, 'expected shell args to roundtrip verbatim');

console.log('subprocess shell metachar quoting test passed');
