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
const logDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-tui-runid-safe-'));
const runId = '../escape-run';

const child = spawn(process.execPath, [supervisorPath], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    PAIROFCLEATS_TUI_EVENT_LOG_DIR: logDir,
    PAIROFCLEATS_TUI_RUN_ID: runId
  }
});

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
child.stderr.on('data', () => {});

const waitFor = async (predicate, timeoutMs = 12000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = events.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timeout waiting for supervisor event');
};

try {
  await waitFor((event) => event.event === 'hello');
  child.stdin.write(`${JSON.stringify({ proto: 'poc.tui@1', op: 'shutdown', reason: 'test_complete' })}\n`);
  await new Promise((resolve) => child.once('exit', resolve));

  const escapedPath = path.resolve(logDir, '..', 'escape-run.jsonl');
  assert.equal(fs.existsSync(escapedPath), false, 'runId traversal should not write outside log dir');

  const entries = await fsPromises.readdir(logDir);
  const jsonl = entries.find((entry) => entry.endsWith('.jsonl'));
  const meta = entries.find((entry) => entry.endsWith('.meta.json'));
  assert.ok(jsonl, 'expected event log file in configured log dir');
  assert.ok(meta, 'expected session metadata file in configured log dir');

  const metaBody = JSON.parse(await fsPromises.readFile(path.join(logDir, meta), 'utf8'));
  assert.equal(metaBody.runId, runId, 'metadata should preserve logical runId');
  const eventLogPath = String(metaBody.eventLogPath || '');
  const resolvedEventLogPath = path.resolve(root, eventLogPath.replace(/\//g, path.sep));
  assert.equal(
    resolvedEventLogPath,
    path.join(logDir, jsonl),
    'metadata should reference the event log file created under the configured log dir'
  );

  console.log('tui run id path safety test passed');
} finally {
  try { child.kill('SIGKILL'); } catch {}
  await fsPromises.rm(logDir, { recursive: true, force: true });
}
