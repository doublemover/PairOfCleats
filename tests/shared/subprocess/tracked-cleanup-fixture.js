import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

export const waitFor = async (predicate, timeoutMs = 5000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
};

export const isAlive = (pid) => {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const createTrackedChildCleanupScript = ({ beforeSpawn = [], afterRegister = [] } = {}) => [
  "import { spawn } from 'node:child_process';",
  "import { registerChildProcessForCleanup } from './src/shared/subprocess/tracking.js';",
  ...beforeSpawn,
  "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {",
  "  stdio: 'ignore',",
  "  detached: process.platform !== 'win32'",
  '});',
  'registerChildProcessForCleanup(child, {',
  '  killTree: true,',
  "  detached: process.platform !== 'win32'",
  '});',
  ...afterRegister
].join('\n');

export const runInlineNodeScript = async (inlineScript) => {
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

  return { closeResult, stdout, stderr };
};

export const readTrackedPidFromStdout = (stdout) => {
  const pidMatch = stdout.match(/TRACKED_PID=(\d+)/);
  assert.ok(pidMatch, `expected TRACKED_PID in stdout, got: ${stdout || '<empty>'}`);
  const trackedPid = Number(pidMatch[1]);
  assert.ok(Number.isFinite(trackedPid) && trackedPid > 0, 'expected tracked child pid from helper process');
  return trackedPid;
};
