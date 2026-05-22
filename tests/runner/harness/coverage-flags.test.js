#!/usr/bin/env node
import path from 'node:path';
import { repoRoot } from '../../helpers/root.js';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const ROOT = repoRoot();
const runnerPath = path.join(ROOT, 'tests', 'run.js');
const env = applyTestEnv({ syncProcess: false });

const result = runNode([
  runnerPath,
  '--list',
  '--lane',
  'unit',
  '--coverage',
  '--coverage-merge',
  '.c8',
  '--coverage-changed'
], 'runner coverage flags list', ROOT, env, { stdio: 'pipe' });

const lines = String(result.stdout || '')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
if (!lines.length) {
  console.error('coverage flags test failed: expected listed tests');
  process.exit(1);
}

console.log('coverage flags test passed');
