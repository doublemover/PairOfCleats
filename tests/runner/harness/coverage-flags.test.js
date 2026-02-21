#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../../helpers/root.js';

const ROOT = repoRoot();
const runnerPath = path.join(ROOT, 'tests', 'run.js');

const result = spawnSync(process.execPath, [
  runnerPath,
  '--list',
  '--lane',
  'unit',
  '--coverage',
  '--coverage-merge',
  '.c8',
  '--coverage-changed'
], {
  encoding: 'utf8'
});

if (result.status !== 0) {
  console.error('coverage flags test failed: expected parse/list success');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

const lines = String(result.stdout || '')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
if (!lines.length) {
  console.error('coverage flags test failed: expected listed tests');
  process.exit(1);
}

console.log('coverage flags test passed');
