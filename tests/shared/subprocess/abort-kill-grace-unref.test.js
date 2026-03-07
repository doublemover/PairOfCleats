#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const script = `
import { spawnSubprocess } from './src/shared/subprocess.js';
const controller = new AbortController();
setTimeout(() => controller.abort(), 25);
const startedAt = Date.now();
try {
  await spawnSubprocess(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000);'],
    {
      signal: controller.signal,
      killGraceMs: 2500,
      timeoutAbortReapWaitMs: 200,
      stdio: ['ignore', 'ignore', 'ignore'],
      captureStdout: false,
      captureStderr: false
    }
  );
} catch {}
process.stdout.write(JSON.stringify({ durationMs: Date.now() - startedAt }));
`;

const startedAt = Date.now();
const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
  cwd: process.cwd(),
  encoding: 'utf8'
});
const wallClockMs = Date.now() - startedAt;

assert.equal(run.status, 0, `expected helper script to exit cleanly: ${run.stderr || ''}`);

let payload = {};
try {
  payload = JSON.parse(String(run.stdout || '{}'));
} catch {
  assert.fail(`expected JSON payload from helper script, got: ${String(run.stdout || '').trim()}`);
}

const innerDurationMs = Number(payload.durationMs);
assert.ok(Number.isFinite(innerDurationMs), `expected numeric inner duration, got: ${String(payload.durationMs)}`);
assert.ok(innerDurationMs >= 200, `expected abort path to await bounded reap before reject; got ${innerDurationMs}ms`);
assert.ok(innerDurationMs < 2000, `expected abort path to return before full grace wait; got ${innerDurationMs}ms`);
assert.ok(wallClockMs < 3000, `expected process to exit without waiting full grace timer; got ${wallClockMs}ms`);

console.log('subprocess abort kill grace unref test passed');
