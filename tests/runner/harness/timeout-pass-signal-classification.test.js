#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../../helpers/root.js';

const ROOT = repoRoot();
const runnerPath = path.join(ROOT, 'tests', 'run.js');

const result = spawnSync(process.execPath, [
  runnerPath,
  '--lane',
  'unit',
  '--match',
  'harness/timeout-pass-signal-target',
  '--timeout-ms',
  '500',
  '--json'
], {
  encoding: 'utf8',
  env: {
    ...process.env,
    PAIROFCLEATS_TEST_ALLOW_TIMEOUT_PASS_SIGNAL_TARGET: '1'
  }
});

if (result.status !== 0) {
  console.error(`timeout pass-signal classification test failed: expected runner exit 0, got ${result.status}`);
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(result.stdout || '{}');
} catch {
  console.error('timeout pass-signal classification test failed: invalid JSON output');
  process.exit(1);
}

const test = payload.tests?.find((entry) => entry?.id === 'runner/harness/timeout-pass-signal-target');
if (!test) {
  console.error('timeout pass-signal classification test failed: missing target test result');
  process.exit(1);
}
if (!test.timedOut) {
  console.error('timeout pass-signal classification test failed: expected timedOut=true');
  process.exit(1);
}
if (String(test.timeoutClass || '') !== 'timed_out_after_pass') {
  console.error(`timeout pass-signal classification test failed: expected timed_out_after_pass, got ${test.timeoutClass || 'null'}`);
  process.exit(1);
}

console.log('timeout pass-signal classification test passed');
