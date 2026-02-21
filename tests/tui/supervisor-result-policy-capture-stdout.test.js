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

  const jsonJobId = 'job-capture-json';
  send({
    op: 'job:run',
    jobId: jsonJobId,
    title: 'Capture Json',
    command: process.execPath,
    args: ['-e', "process.stdout.write(JSON.stringify({ok:true,count:2}) + '\\n');"],
    resultPolicy: {
      captureStdout: 'json'
    }
  });

  const jsonEnd = await waitFor((event) => event.event === 'job:end' && event.jobId === jsonJobId);
  assert.equal(jsonEnd.status, 'done');
  assert.equal(jsonEnd.result?.ok, true);
  assert.equal(jsonEnd.result?.count, 2);

  const textJobId = 'job-capture-text';
  send({
    op: 'job:run',
    jobId: textJobId,
    title: 'Capture Text',
    command: process.execPath,
    args: ['-e', "process.stdout.write('plain-text-output\\n');"],
    captureStdout: true
  });

  const textEnd = await waitFor((event) => event.event === 'job:end' && event.jobId === textJobId);
  assert.equal(textEnd.status, 'done');
  assert.equal(textEnd.result, 'plain-text-output');

  send({ op: 'shutdown', reason: 'test_complete' });
  const exitCode = await new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  assert.equal(exitCode, 0);

  console.log('supervisor result policy capture stdout test passed');
} catch (error) {
  try { child.kill('SIGKILL'); } catch {}
  console.error(error?.message || error);
  process.exit(1);
}
