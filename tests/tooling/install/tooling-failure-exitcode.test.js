#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');
const scriptPath = path.join(root, 'tools', 'tooling', 'install.js');

const env = {
  ...process.env,
  PATH: '',
  Path: ''
};

const result = spawnSync(
  process.execPath,
  [scriptPath, '--root', fixtureRoot, '--tools', 'pyright', '--json'],
  { encoding: 'utf8', env }
);

if (result.status === 0) {
  console.error('tooling-install failure exit code test failed: expected non-zero status on failed install');
  process.exit(1);
}

let payload = null;
try {
  payload = JSON.parse(String(result.stdout || '{}'));
} catch {
  console.error('tooling-install failure exit code test failed: stdout was not valid JSON');
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
