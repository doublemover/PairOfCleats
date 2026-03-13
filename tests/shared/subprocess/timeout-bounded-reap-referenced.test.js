#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const script = `
import { spawnSubprocess } from './src/shared/subprocess.js';
const startedAt = Date.now();
try {
  await spawnSubprocess(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000);'],
    {
      timeoutMs: 25,
      killGraceMs: 2500,
      timeoutAbortReapWaitMs: 200,
      stdio: ['ignore', 'ignore', 'ignore'],
      captureStdout: false,
      captureStderr: false
    }
  );
  process.stdout.write(JSON.stringify({ ok: false, reason: 'expected timeout' }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: error?.name === 'SubprocessTimeoutError' || error?.code === 'SUBPROCESS_TIMEOUT',
    durationMs: Date.now() - startedAt
  }));
}
`;

const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
  cwd: process.cwd(),
  encoding: 'utf8'
});

assert.equal(
  run.status,
  0,
  `expected timeout helper script to settle without top-level-await exit regression: ${run.stderr || ''}`
);

let payload = null;
try {
  payload = JSON.parse(String(run.stdout || '{}'));
} catch {
  assert.fail(`expected json payload, got: ${String(run.stdout || '').trim()}`);
}

assert.equal(payload?.ok, true, `expected timeout path to reject deterministically: ${run.stdout || ''}`);
assert.ok(
  Number.isFinite(Number(payload?.durationMs)) && Number(payload.durationMs) >= 200,
  `expected bounded reap wait to remain effective, got: ${String(payload?.durationMs)}`
);

console.log('subprocess timeout bounded reap referenced test passed');
