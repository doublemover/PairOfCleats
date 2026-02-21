#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();

const run = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'package-vscode.js'), '--out-dir', path.join(root, '.testCache', 'package-vscode-missing-toolchain')],
  {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: '',
      Path: ''
    }
  }
);

if (run.status === 0) {
  console.error('toolchain-missing-policy test failed: expected package-vscode to fail without npm in PATH');
  process.exit(1);
}

const combined = `${run.stderr || ''}\n${run.stdout || ''}`.toLowerCase();
if (!combined.includes('toolchain')) {
  console.error('toolchain-missing-policy test failed: expected explicit toolchain failure message');
  process.exit(1);
}

console.log('vscode toolchain missing-policy test passed');
