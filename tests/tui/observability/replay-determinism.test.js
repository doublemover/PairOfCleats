#!/usr/bin/env node
import { ensureTestingEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

ensureTestingEnv(process.env);

const root = process.cwd();
const supervisorPath = path.join(root, 'tools', 'tui', 'supervisor.js');
const logDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-tui-replay-'));
const runId = `run-replay-${process.pid}`;

const child = spawn(process.execPath, [supervisorPath], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    PAIROFCLEATS_TUI_EVENT_LOG_DIR: logDir,
    PAIROFCLEATS_TUI_RUN_ID: runId
  }
});
child.stderr.on('data', () => {});

const stdoutLines = [];
let carry = '';
child.stdout.on('data', (chunk) => {
  const text = `${carry}${String(chunk)}`.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = text.split('\n');
  carry = parts.pop() || '';
  for (const line of parts) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    stdoutLines.push(trimmed);
  }
});

const waitForLine = async (predicate, timeoutMs = 12000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = stdoutLines.find((line) => predicate(JSON.parse(line)));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timeout waiting for supervisor line');
};

const send = (payload) => {
  child.stdin.write(`${JSON.stringify({ proto: 'poc.tui@1', ...payload })}\n`);
};

try {
  await waitForLine((event) => event.event === 'hello');
  const jobId = 'job-replay-1';
  send({
    op: 'job:run',
    jobId,
    title: 'replay',
    command: process.execPath,
    args: ['-e', 'console.log("alpha"); console.error("beta");']
  });
  await waitForLine((event) => event.event === 'job:end' && event.jobId === jobId);
  send({ op: 'shutdown', reason: 'test_complete' });
  await new Promise((resolve) => child.once('exit', resolve));

  const replayPath = path.join(logDir, `${runId}.jsonl`);
  assert.equal(fs.existsSync(replayPath), true, 'expected replay log file');
  const replayLines = fs.readFileSync(replayPath, 'utf8').split(/\r?\n/).filter(Boolean);
  assert.deepEqual(replayLines, stdoutLines, 'replay log must match emitted protocol stream exactly');

  console.log('tui observability replay determinism test passed');
} finally {
  try { child.kill('SIGKILL'); } catch {}
  await fsPromises.rm(logDir, { recursive: true, force: true });
}
