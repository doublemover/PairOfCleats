#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'reports', 'combined-summary.js');

const run = spawnSync(
  process.execPath,
  [scriptPath, '--json', '--models', 'model-a,model-b', '--baseline', 'missing-model'],
  { encoding: 'utf8' }
);

assert.equal(run.status, 1, 'expected invalid baseline to fail');
const payload = JSON.parse(String(run.stdout || '{}') || '{}');
assert.equal(payload?.ok, false, 'expected JSON error payload ok=false');
assert.match(String(payload?.error || ''), /baseline/i);

console.log('summary report json error contract test passed');
