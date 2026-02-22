import path from 'node:path';
import { spawn } from 'node:child_process';

const DEFAULT_POLL_MS = 20;

const normalizeLineBreaks = (text) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

export const createSupervisorSession = ({
  root = process.cwd(),
  timeoutMs = 8000
} = {}) => {
  const supervisorPath = path.join(root, 'tools', 'tui', 'supervisor.js');
  const child = spawn(process.execPath, [supervisorPath], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.stderr.on('data', () => {});

  const events = [];
  let carry = '';
  child.stdout.on('data', (chunk) => {
    const text = normalizeLineBreaks(`${carry}${String(chunk)}`);
    const parts = text.split('\n');
    carry = parts.pop() || '';
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      events.push(JSON.parse(trimmed));
    }
  });

  const waitForEvent = async (predicate, waitTimeoutMs = timeoutMs) => {
    const started = Date.now();
    while (Date.now() - started < waitTimeoutMs) {
      const found = events.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, DEFAULT_POLL_MS));
    }
    throw new Error('timeout waiting for supervisor event');
  };

  const send = (payload) => {
    child.stdin.write(`${JSON.stringify({ proto: 'poc.tui@1', ...payload })}\n`);
  };

  const waitForExit = () => new Promise((resolve) => child.once('exit', (code) => resolve(code)));

  const shutdown = async (reason = 'test_complete') => {
    send({ op: 'shutdown', reason });
    return waitForExit();
  };

  const forceKill = () => {
    try {
      child.kill('SIGKILL');
    } catch {}
  };

  return {
    child,
    events,
    waitForEvent,
    send,
    waitForExit,
    shutdown,
    forceKill
  };
};
