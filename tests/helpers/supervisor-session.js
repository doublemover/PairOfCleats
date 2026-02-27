import path from 'node:path';
import { spawn } from 'node:child_process';

const DEFAULT_POLL_MS = 20;

const normalizeLineBreaks = (text) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

/**
 * Spawn TUI supervisor child and expose polling helpers for JSON events.
 *
 * @param {{root?:string,timeoutMs?:number}} [options]
 * @returns {{
 *  child: import('node:child_process').ChildProcessWithoutNullStreams,
 *  events: any[],
 *  waitForEvent: (predicate:(event:any)=>boolean,waitTimeoutMs?:number)=>Promise<any>,
 *  send: (payload:object)=>void,
 *  waitForExit: ()=>Promise<number|null>,
 *  shutdown: (reason?:string)=>Promise<number|null>,
 *  forceKill: ()=>void
 * }}
 */
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
  let exitCode = null;
  let exitSignal = null;
  const exitPromise = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      resolve(code ?? null);
    });
  });

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
      if (child.exitCode !== null) {
        throw new Error(
          `supervisor exited before expected event (code=${child.exitCode}, signal=${exitSignal || 'null'})`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, DEFAULT_POLL_MS));
    }
    throw new Error('timeout waiting for supervisor event');
  };

  const send = (payload) => {
    child.stdin.write(`${JSON.stringify({ proto: 'poc.tui@1', ...payload })}\n`);
  };

  const waitForExit = () => {
    if (child.exitCode !== null) {
      return Promise.resolve(child.exitCode ?? exitCode ?? null);
    }
    return exitPromise;
  };

  const shutdown = async (reason = 'test_complete') => {
    try {
      send({ op: 'shutdown', reason });
    } catch {}
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
