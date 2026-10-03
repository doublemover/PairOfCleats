#!/usr/bin/env node
import path from 'node:path';

import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const checker = path.join(root, 'tools', 'tooling', 'python-check.js');
const env = applyTestEnv({ syncProcess: false });

const okRun = runNode([checker, '--json'], 'python-check normal environment', root, env, {
  stdio: 'pipe'
});
if (okRun.status !== 0) {
  console.error('python-toolchain-policy test failed: expected python-check to succeed in normal environment');
  if (okRun.stdout) console.error(okRun.stdout.trim());
  if (okRun.stderr) console.error(okRun.stderr.trim());
  process.exit(okRun.status ?? 1);
}

const missingRun = runNode(
  [checker, '--json'],
  'python-check missing toolchain',
  root,
  applyTestEnv({
    extraEnv: {
      PATH: '',
      Path: '',
      PYTHON: ''
    },
    syncProcess: false
  }),
  {
    stdio: 'pipe',
    allowFailure: true
  }
);
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
