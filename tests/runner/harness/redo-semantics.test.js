#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../../helpers/root.js';
import { skip } from '../../helpers/skip.js';

if (process.platform !== 'win32') {
  skip('redo semantics are windows-specific');
}

const ROOT = repoRoot();
const runnerPath = path.join(ROOT, 'tests', 'run.js');
const markerPath = path.join(os.tmpdir(), `poc-redo-semantics-${process.pid}.marker`);
fs.rmSync(markerPath, { force: true });

const result = spawnSync(
  process.execPath,
  [runnerPath, '--lane', 'unit', '--match', 'harness/redo-target', '--json', '--retries', '0'],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      REDO_TARGET_HELPER: '1',
      REDO_TARGET_MARKER: markerPath
    }
  }
);

fs.rmSync(markerPath, { force: true });

if (result.status !== 0) {
  console.error('redo semantics test failed: runner exited non-zero');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(result.stdout || '{}');
} catch {
  console.error('redo semantics test failed: invalid JSON output');
  process.exit(1);
}

if (!payload.summary || payload.summary.passed !== 1 || payload.summary.failed !== 0) {
  console.error('redo semantics test failed: expected one passing test');
  process.exit(1);
}

const test = payload.tests?.[0];
if (!test || test.status !== 'passed') {
  console.error('redo semantics test failed: expected passed status');
  process.exit(1);
}
if (test.attempts !== 2) {
  console.error(`redo semantics test failed: expected 2 attempts, got ${test.attempts}`);
  process.exit(1);
}

console.log('redo semantics test passed');
