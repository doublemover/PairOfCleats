#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runnerPath = path.join(ROOT, 'tests', 'run.js');

const result = spawnSync(process.execPath, [runnerPath, '--match', 'harness/skip-target', '--json'], {
  encoding: 'utf8'
});

if (result.status !== 0) {
  console.error('skip semantics test failed: runner exited non-zero');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(result.stdout || '{}');
} catch {
  console.error('skip semantics test failed: invalid JSON output');
  process.exit(1);
}

if (!payload.summary || payload.summary.skipped !== 1) {
  console.error('skip semantics test failed: expected one skipped test');
  process.exit(1);
}

const test = payload.tests?.[0];
if (!test || test.status !== 'skipped') {
  console.error('skip semantics test failed: expected skipped status');
  process.exit(1);
}
if (!test.skipReason || !test.skipReason.includes('skip target')) {
  console.error('skip semantics test failed: missing skip reason');
  process.exit(1);
}

console.log('skip semantics test passed');
