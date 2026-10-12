import path from 'node:path';
import { spawn } from 'node:child_process';
import { registerChildProcessForCleanup } from '../../src/shared/subprocess/tracking.js';

const DEFAULT_POLL_MS = 20;

const normalizeLineBreaks = (text) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

/**
 * Spawn TUI supervisor child and expose polling helpers for JSON events.
 *
 * @param {{root?:string,timeoutMs?:number,reassembleEvents?:boolean}} [options]
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
  timeoutMs = 8000,
  reassembleEvents = false
} = {}) => {
  const supervisorPath = path.join(root, 'tools', 'tui', 'supervisor.js');
  const child = spawn(process.execPath, [supervisorPath], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const unregisterTrackedChild = registerChildProcessForCleanup(child, {
    killTree: true,
    detached: false,
    name: 'supervisor-session-test',
    command: process.execPath,
    args: [supervisorPath]
  });
  child.stderr.on('data', () => {});
  let exitCode = null;
  let exitSignal = null;
  const exitPromise = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      unregisterTrackedChild();
      resolve(code ?? null);
    });
  });

  const events = [];
  const chunks = new Map();
  let carry = '';
  child.stdout.on('data', (chunk) => {
    const text = normalizeLineBreaks(`${carry}${String(chunk)}`);
    const parts = text.split('\n');
    carry = parts.pop() || '';
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed);
        events.push(entry);
        if (reassembleEvents && entry.event === 'event:chunk') {
          const parts = chunks.get(entry.chunkId) || new Map();
          parts.set(entry.chunkIndex, entry.chunk);
          chunks.set(entry.chunkId, parts);
          if (parts.size === entry.chunkCount) {
            events.push(JSON.parse(Array.from({ length: entry.chunkCount }, (_, i) => parts.get(i)).join('')));
            chunks.delete(entry.chunkId);
          }
        }
      } catch {
        events.push({
          type: 'malformed-json-line',
          line: trimmed
        });
      }
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

  const shutdown = async (reason = 'test_complete', waitTimeoutMs = timeoutMs) => {
    try {
      send({ op: 'shutdown', reason });
    } catch {}
    const waitPromise = waitForExit();
    if (child.exitCode !== null) return waitPromise;
    const bounded = await Promise.race([
      waitPromise,
      new Promise((resolve) => {
        setTimeout(() => resolve(null), Math.max(1, Number(waitTimeoutMs) || timeoutMs));
      })
    ]);
    if (bounded !== null) return bounded;
    forceKill();
    return waitForExit();
  };

  const forceKill = () => {
    try {
      child.kill('SIGKILL');
    } catch {}
    unregisterTrackedChild();
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
