#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../../helpers/root.js';
import { normalizeResult, resolveAcceptanceExitCode } from '../run-results.js';

const ROOT = repoRoot();
for (const diagnosticArgs of [[], ['--allow-timeouts']]) {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'tests', 'run.js'), '--lane', 'all',
    '--match', 'harness/timeout-pass-signal-target', '--timeout-ms', '500',
    '--jobs', '1', '--retries', '0', '--native-status-redo=false', '--json',
    ...diagnosticArgs
  ], {
    encoding: 'utf8', timeout: 15000,
    env: { ...process.env, PAIROFCLEATS_TEST_ALLOW_TIMEOUT_PASS_SIGNAL_TARGET: '1' }
  });
  assert.equal(result.status, 1, `Timeout must fail acceptance: ${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.summary.total, 1);
  assert.equal(payload.summary.failed, 1);
  assert.equal(payload.summary.passed, 0);
  const test = payload.tests.find((entry) => entry.id === 'runner/harness/timeout-pass-signal-target');
  assert.equal(test.status, 'failed');
  assert.equal(test.timedOut, true);
  assert.equal(test.timeoutClass, 'timed_out_after_pass');
}
assert.equal(resolveAcceptanceExitCode([normalizeResult({ status: 'passed', exitCode: 0 })]), 0);
assert.equal(resolveAcceptanceExitCode([normalizeResult({ status: 'passed', timedOut: true })]), 1);
assert.equal(resolveAcceptanceExitCode([normalizeResult({ status: 'failed', exitCode: 1 })]), 1);
console.log('timeout pass-signal classification test passed');
