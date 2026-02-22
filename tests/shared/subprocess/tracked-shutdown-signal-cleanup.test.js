#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const waitFor = async (predicate, timeoutMs = 5000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
};

const isAlive = (pid) => {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const inlineScript = [
  "import { spawn } from 'node:child_process';",
  "import { registerChildProcessForCleanup } from './src/shared/subprocess.js';",
  "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {",
  "  stdio: 'ignore',",
  "  detached: process.platform !== 'win32'",
  '});',
  "registerChildProcessForCleanup(child, {",
  "  killTree: true,",
  "  detached: process.platform !== 'win32'",
  '});',
  "process.stdout.write(`TRACKED_PID=${child.pid}\\n`);",
  "process.emit('SIGTERM', 'SIGTERM');",
  'setInterval(() => {}, 1000);'
].join('\n');

const runner = spawn(process.execPath, ['-e', inlineScript], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';
runner.stdout.on('data', (chunk) => {
  stdout += String(chunk);
});
runner.stderr.on('data', (chunk) => {
  stderr += String(chunk);
});

const closeResult = await new Promise((resolve, reject) => {
  runner.on('error', reject);
  runner.on('close', (exitCode, signal) => resolve({ exitCode, signal }));
});

const pidMatch = stdout.match(/TRACKED_PID=(\d+)/);
assert.ok(pidMatch, `expected TRACKED_PID in stdout, got: ${stdout || '<empty>'}`);
const trackedPid = Number(pidMatch[1]);
assert.ok(Number.isFinite(trackedPid) && trackedPid > 0, 'expected tracked child pid from helper process');

assert.equal(
  closeResult.exitCode,
  143,
  `expected helper process to exit with SIGTERM-compatible code 143; stderr=${stderr || '<empty>'}`
);
assert.equal(closeResult.signal, null, 'expected exit to be code-based for signal hook path');

const childTerminated = await waitFor(() => !isAlive(trackedPid), 5000);
assert.equal(childTerminated, true, 'expected tracked child process to be terminated after SIGTERM cleanup');

console.log('tracked subprocess signal cleanup test passed');
