#!/usr/bin/env node
import { runToolingInstallWithEmptyPath } from './tooling-install-test-helper.js';
import assert from 'node:assert/strict';

const { result, payload, installerCalled } = runToolingInstallWithEmptyPath('pyright', { failInstaller: true });
assert.equal(installerCalled, true, 'the recognized fixture manager must reach its deliberately failing installer');

if (result.status === 0) {
  console.error('tooling-install failure exit code test failed: expected non-zero status on failed install');
  process.exit(1);
}

const pyright = Array.isArray(payload?.results)
  ? payload.results.find((entry) => entry?.id === 'pyright')
  : null;
if (!pyright || pyright.status !== 'failed') {
  console.error('tooling-install failure exit code test failed: expected pyright result with status=failed');
  process.exit(1);
}
if (!Number.isInteger(pyright.exitCode) || pyright.exitCode <= 0) {
  console.error('tooling-install failure exit code test failed: expected numeric non-zero exitCode for failed install');
  process.exit(1);
}

console.log('tooling-install failure exit code test passed');
