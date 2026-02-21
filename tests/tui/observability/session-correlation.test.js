#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const supervisorPath = path.join(root, 'tools', 'tui', 'supervisor.js');
const logDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-tui-observe-'));
const runId = `run-correlation-${process.pid}`;

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
  const jobId = 'job-observe-1';
  send({
    op: 'job:run',
    jobId,
    title: 'observability',
    command: process.execPath,
    args: ['-e', 'console.log("hello");']
  });
  await waitFor((event) => event.event === 'job:end' && event.jobId === jobId);
  send({ op: 'shutdown', reason: 'test_complete' });
  await new Promise((resolve) => child.once('exit', resolve));

  const eventLogPath = path.join(logDir, `${runId}.jsonl`);
  const metaPath = path.join(logDir, `${runId}.meta.json`);
  assert.equal(fs.existsSync(eventLogPath), true, 'expected replay event log');
  assert.equal(fs.existsSync(metaPath), true, 'expected replay metadata');

  const logLines = fs.readFileSync(eventLogPath, 'utf8').split(/\r?\n/).filter(Boolean);
  assert(logLines.length > 0, 'expected replay log lines');
  const loggedEvents = logLines.map((line) => JSON.parse(line));
  for (const event of loggedEvents) {
    assert.equal(event.runId, runId, 'expected stable run correlation in replay log');
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  assert.equal(meta.runId, runId, 'metadata must carry runId');

  console.log('tui observability session correlation test passed');
} finally {
  try { child.kill('SIGKILL'); } catch {}
  await fsPromises.rm(logDir, { recursive: true, force: true });
}
