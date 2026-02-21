#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';

ensureTestingEnv(process.env);

const root = process.cwd();
const supervisorPath = path.join(root, 'tools', 'tui', 'supervisor.js');
const ignoreSigtermFixture = path.join(root, 'tests', 'fixtures', 'tui', 'ignore-sigterm.js');

const child = spawn(process.execPath, [supervisorPath], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe']
});
child.stderr.on('data', () => {});

const events = [];
let carry = '';
child.stdout.on('data', (chunk) => {
  const text = `${carry}${String(chunk)}`.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = text.split('\n');
  carry = parts.pop() || '';
  for (const line of parts) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    events.push(JSON.parse(trimmed));
  }
});

const waitFor = async (predicate, timeoutMs = 12000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = events.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timeout waiting for supervisor event');
};

const send = (payload) => {
  child.stdin.write(`${JSON.stringify({ proto: 'poc.tui@1', ...payload })}\n`);
};

try {
  await waitFor((event) => event.event === 'hello');

  const jobId = 'job-ui-terminate';
  send({
    op: 'job:run',
    jobId,
    title: 'UI Mid Job',
    command: process.execPath,
    args: [ignoreSigtermFixture],
    timeoutMs: 20000
  });

  await waitFor((event) => event.event === 'job:spawn' && event.jobId === jobId);

  const shutdownStart = Date.now();
  send({ op: 'shutdown', reason: 'ui_exit' });
  await new Promise((resolve) => child.once('exit', resolve));
  const shutdownDurationMs = Date.now() - shutdownStart;

  assert(shutdownDurationMs < 12000, 'expected bounded shutdown duration');
  const end = events.find((event) => event.event === 'job:end' && event.jobId === jobId);
  assert(end, 'expected job:end event for in-flight job during shutdown');
  assert.equal(end.status, 'cancelled');

  console.log('tui ui termination mid-job test passed');
} catch (error) {
  try { child.kill('SIGKILL'); } catch {}
  console.error(error?.message || error);
  process.exit(1);
}
