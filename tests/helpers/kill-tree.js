import { spawn } from 'node:child_process';
import { resolveSilentStdio } from './test-env.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runCommand = (command, args) => new Promise((resolve) => {
  const child = spawn(command, args, { stdio: resolveSilentStdio('ignore') });
  child.on('close', (code) => resolve(code === 0));
  child.on('error', () => resolve(false));
});

const killPosixTree = async (pid, graceMs) => {
  let forced = false;
  const signalGroup = (signal) => {
    try {
      process.kill(-pid, signal);
      return true;
    } catch (error) {
      if (error?.code === 'ESRCH') return false;
      if (error?.code === 'EPERM') return true;
      throw error;
    }
  };

  const initial = signalGroup('SIGTERM');
  if (initial) {
    await wait(graceMs);
  }
  const stillRunning = signalGroup(0);
  if (stillRunning) {
    forced = true;
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  return { terminated: Boolean(initial), forced };
};

const killWindowsTree = async (pid, graceMs) => {
  const baseArgs = ['/PID', String(pid), '/T'];
  const graceful = await runCommand('taskkill', baseArgs);
  if (graceful) {
    await wait(graceMs);
  }
  const forced = await runCommand('taskkill', [...baseArgs, '/F']);
  return { terminated: graceful || forced, forced: Boolean(forced) };
};

export const killProcessTree = async (pid, { graceMs = 2000 } = {}) => {
  if (!pid) return { terminated: false, forced: false };
  if (process.platform === 'win32') {
    return killWindowsTree(pid, graceMs);
  }
  return killPosixTree(pid, graceMs);
};
