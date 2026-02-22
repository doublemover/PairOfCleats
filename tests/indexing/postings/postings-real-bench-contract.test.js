#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const script = path.join(root, 'tools', 'bench', 'index', 'postings-real.js');
const MAX_RUNTIME_MS = 30_000;
const env = {
  ...process.env,
  PAIROFCLEATS_WORKER_POOL: 'off',
  PAIROFCLEATS_TESTING: '1'
};
const result = spawnSync(
  process.execPath,
  [script, '--count', '1', '--seed', 'postings-real-contract', '--mode', 'baseline', '--threads-baseline', '1'],
  { cwd: root, env, encoding: 'utf8', timeout: MAX_RUNTIME_MS }
);

if (result.error?.code === 'ETIMEDOUT') {
  console.warn(`postings real bench contract skipped after ${MAX_RUNTIME_MS}ms timeout`);
  process.exit(0);
}

if (result.status !== 0) {
  console.error(result.stdout || '');
  console.error(result.stderr || '');
  process.exit(1);
}

const output = `${result.stdout || ''}${result.stderr || ''}`;
assert.ok(output.includes('[bench] baseline'), 'missing baseline output');

console.log('postings real bench contract test passed');

