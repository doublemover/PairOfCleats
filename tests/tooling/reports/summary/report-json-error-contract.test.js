#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { runNode } from '../../../helpers/run-node.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'reports', 'combined-summary.js');
const env = applyTestEnv({ syncProcess: false });

const run = runNode(
  [scriptPath, '--json', '--models', 'model-a,model-b', '--baseline', 'missing-model'],
  'summary report json error contract',
  root,
  env,
  {
    stdio: 'pipe',
    allowFailure: true
  }
);

assert.equal(run.status, 1, 'expected invalid baseline to fail');
const payload = JSON.parse(String(run.stdout || '{}') || '{}');
assert.equal(payload?.ok, false, 'expected JSON error payload ok=false');
assert.match(String(payload?.error || ''), /baseline/i);

console.log('summary report json error contract test passed');
