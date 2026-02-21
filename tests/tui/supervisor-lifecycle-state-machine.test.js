#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';

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
    events.push(JSON.parse(trimmed));
  }
});

const waitFor = async (predicate, timeoutMs = 8000) => {
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

  const jobId = 'job-lifecycle-1';
  send({
    op: 'job:run',
    jobId,
    title: 'Lifecycle',
    argv: ['search', '--help']
  });

  const start = await waitFor((event) => event.event === 'job:start' && event.jobId === jobId);
  const spawnEvent = await waitFor((event) => event.event === 'job:spawn' && event.jobId === jobId);
  const end = await waitFor((event) => event.event === 'job:end' && event.jobId === jobId);

  assert.equal(start.jobId, jobId);
  assert.equal(spawnEvent.jobId, jobId);
  assert.equal(end.jobId, jobId);
  assert.ok(['done', 'failed', 'cancelled'].includes(end.status));

  const startIndex = events.indexOf(start);
  const spawnIndex = events.indexOf(spawnEvent);
  const endIndex = events.indexOf(end);
  assert(startIndex >= 0 && spawnIndex > startIndex && endIndex > spawnIndex, 'expected lifecycle ordering start -> spawn -> end');

  send({ op: 'shutdown', reason: 'test_complete' });
  await new Promise((resolve) => child.once('exit', resolve));

  console.log('supervisor lifecycle state machine test passed');
} catch (error) {
  try { child.kill('SIGKILL'); } catch {}
  console.error(error?.message || error);
  process.exit(1);
}
