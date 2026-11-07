#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const script = path.join(root, 'tools', 'bench', 'index', 'postings-real.js');
const MAX_RUNTIME_MS = 30_000;
const env = applyTestEnv({
  syncProcess: false,
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off'
  }
});
const result = runNode(
  [script, '--count', '1', '--seed', 'postings-real-contract', '--mode', 'baseline', '--threads-baseline', '1'],
  'postings real bench contract',
  root,
  env,
  { stdio: 'pipe', encoding: 'utf8', timeoutMs: MAX_RUNTIME_MS }
);

const output = `${result.stdout || ''}${result.stderr || ''}`;
assert.ok(output.includes('[bench] baseline'), 'missing baseline output');

console.log('postings real bench contract test passed');

