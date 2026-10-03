#!/usr/bin/env node
import path from 'node:path';

import { runNode } from '../../helpers/run-node.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const env = applyTestEnv({
  extraEnv: {
    PATH: '',
    Path: ''
  },
  syncProcess: false
});

const run = runNode(
  [path.join(root, 'tools', 'package-vscode.js'), '--out-dir', resolveTestCachePath(root, 'package-vscode-missing-toolchain')],
  'package-vscode missing toolchain',
  root,
  env,
  {
    stdio: 'pipe',
    allowFailure: true
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
