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

  const jobId = 'job-artifacts-1';
  send({
    op: 'job:run',
    jobId,
    title: 'Artifacts',
    argv: ['search', '--help']
  });

  await waitFor((event) => event.event === 'job:end' && event.jobId === jobId);
  const artifactsEvent = await waitFor((event) => event.event === 'job:artifacts' && event.jobId === jobId);

  assert.equal(artifactsEvent.artifactsIndexed, true);
  assert(Array.isArray(artifactsEvent.artifacts), 'expected artifacts array');

  send({ op: 'shutdown', reason: 'test_complete' });
  await new Promise((resolve) => child.once('exit', resolve));

  console.log('supervisor artifacts indexing test passed');
} catch (error) {
  try { child.kill('SIGKILL'); } catch {}
  console.error(error?.message || error);
  process.exit(1);
}
