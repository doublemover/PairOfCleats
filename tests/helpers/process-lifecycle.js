import { killChildProcessTree } from '../../src/shared/kill-tree.js';

const isPidAlive = (pid) => {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(Math.floor(numericPid), 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
};

const isChildRunning = (child) => Boolean(
  child
  && child.exitCode == null
  && child.signalCode == null
  && (
    !Number.isFinite(Number(child.pid))
    || isPidAlive(child.pid)
  )
);

/**
 * Wait for a child process to exit and force-kill it if timeout elapses.
 *
 * @param {import('node:child_process').ChildProcess|null|undefined} child
 * @param {{timeoutMs?:number,forceSignal?:import('node:os').Signals,forceWaitMs?:number}} [options]
 * @returns {Promise<number|null>}
 */
export const waitForChildExit = async (
  child,
  { timeoutMs = 5000, forceSignal = 'SIGKILL', forceWaitMs = 2000 } = {}
) => {
  if (!child) return null;
  if (!isChildRunning(child)) return child.exitCode ?? null;
  return await new Promise((resolve) => {
    let done = false;
    let timer = null;
    let forceTimer = null;
    let pollTimer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      if (pollTimer) clearInterval(pollTimer);
      child.removeListener('exit', onExit);
    };
    const finish = (code) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(code ?? null);
    };
    const onExit = (code) => finish(code);
    const finishIfStopped = () => {
      if (done) return;
      if (!isChildRunning(child)) {
        finish(child.exitCode ?? null);
      }
    };
    const forceKillTree = async (signal) => {
      if (!isChildRunning(child)) return;
      const numericPid = Number(child.pid);
      const hasPid = Number.isFinite(numericPid) && numericPid > 0;
      if (!hasPid && typeof child.kill === 'function') {
        try {
          child.kill(signal);
        } catch {}
        finishIfStopped();
        return;
      }
      try {
        await killChildProcessTree(child, {
          killTree: true,
          killSignal: signal,
          graceMs: 0,
          awaitGrace: true,
          detached: process.platform !== 'win32'
        });
      } catch {}
      finishIfStopped();
    };
    child.once('exit', onExit);
    if (!isChildRunning(child)) {
      finishIfStopped();
      return;
    }
    pollTimer = setInterval(() => {
      finishIfStopped();
    }, 100);
    timer = setTimeout(() => {
      void forceKillTree(forceSignal);
      forceTimer = setTimeout(() => {
        const hasPid = Number.isFinite(Number(child.pid)) && Number(child.pid) > 0;
        if (!hasPid) {
          finish(child.exitCode ?? null);
          return;
        }
        if (!isChildRunning(child)) {
          finishIfStopped();
          return;
        }
        // Escalate to hard kill if the configured signal failed to stop the tree.
        void forceKillTree('SIGKILL');
      }, Math.max(50, Math.floor(Number(forceWaitMs) || 2000)));
    }, Math.max(100, Math.floor(Number(timeoutMs) || 5000)));
  });
};

/**
 * Terminate a child process with SIGTERM first, then force-kill on timeout.
 *
 * @param {import('node:child_process').ChildProcess|null|undefined} child
 * @param {{graceMs?:number,termSignal?:import('node:os').Signals,forceSignal?:import('node:os').Signals}} [options]
 * @returns {Promise<number|null>}
 */
export const terminateChild = async (
  child,
  {
    graceMs = 5000,
    termSignal = 'SIGTERM',
    forceSignal = 'SIGKILL'
  } = {}
) => {
  if (!child) return null;
  if (!isChildRunning(child)) return child.exitCode ?? null;
  try {
    await killChildProcessTree(child, {
      killTree: true,
      killSignal: termSignal,
      graceMs: Math.max(0, Math.floor(Number(graceMs) || 0)),
      awaitGrace: true,
      detached: process.platform !== 'win32'
    });
  } catch {}
  return await waitForChildExit(child, { timeoutMs: graceMs, forceSignal });
};
