#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const checker = path.join(root, 'tools', 'tooling', 'python-check.js');

const okRun = spawnSync(process.execPath, [checker, '--json'], {
  cwd: root,
  encoding: 'utf8'
});
if (okRun.status !== 0) {
  console.error('python-toolchain-policy test failed: expected python-check to succeed in normal environment');
  if (okRun.stdout) console.error(okRun.stdout.trim());
  if (okRun.stderr) console.error(okRun.stderr.trim());
  process.exit(okRun.status ?? 1);
}

const missingRun = spawnSync(process.execPath, [checker, '--json'], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    PATH: '',
    Path: '',
    PYTHON: ''
  }
});
if (missingRun.status === 0) {
  console.error('python-toolchain-policy test failed: expected missing-toolchain run to fail');
  process.exit(1);
}

const payload = JSON.parse(missingRun.stdout || '{}');
if (payload.code !== 'ERR_PYTHON_TOOLCHAIN_MISSING') {
  console.error('python-toolchain-policy test failed: expected ERR_PYTHON_TOOLCHAIN_MISSING code');
  process.exit(1);
}

console.log('python toolchain policy test passed');
