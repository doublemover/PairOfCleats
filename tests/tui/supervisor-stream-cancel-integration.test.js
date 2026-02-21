#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';

ensureTestingEnv(process.env);

const root = process.cwd();
const supervisorPath = path.join(root, 'tools', 'tui', 'supervisor.js');

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
    const payload = JSON.parse(trimmed);
    events.push(payload);
  }
});

const waitFor = async (predicate, timeoutMs = 10000) => {
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

  const jobId = 'job-cancel-1';
  send({
    op: 'job:run',
    jobId,
    title: 'Cancel Integration',
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000);']
  });

  await waitFor((event) => event.event === 'job:spawn' && event.jobId === jobId);
  send({ op: 'job:cancel', jobId, reason: 'test_cancel' });

  const end = await waitFor((event) => event.event === 'job:end' && event.jobId === jobId);
  assert.equal(end.status, 'cancelled');
  assert.equal(end.exitCode, 130);

  for (const event of events) {
    assert.equal(event.proto, 'poc.progress@2', 'supervisor stdout must emit only protocol events');
  }

  send({ op: 'shutdown', reason: 'test_complete' });
  await new Promise((resolve) => child.once('exit', resolve));

  console.log('supervisor stream/cancel integration test passed');
} catch (error) {
  try { child.kill('SIGKILL'); } catch {}
  console.error(error?.message || error);
  process.exit(1);
}
