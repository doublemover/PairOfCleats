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
  if (child.exitCode !== null) return child.exitCode ?? null;
  return await new Promise((resolve) => {
    let done = false;
    let timer = null;
    let forceTimer = null;
    const finish = (code) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      child.removeListener('exit', onExit);
      resolve(code ?? null);
    };
    const onExit = (code) => finish(code);
    child.once('exit', onExit);
    if (child.exitCode !== null) {
      finish(child.exitCode ?? null);
      return;
    }
    timer = setTimeout(() => {
      try {
        child.kill(forceSignal);
      } catch {}
      forceTimer = setTimeout(() => {
        finish(child.exitCode ?? null);
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
  if (child.exitCode !== null) return child.exitCode ?? null;
  try {
    child.kill(termSignal);
  } catch {}
  return await waitForChildExit(child, { timeoutMs: graceMs, forceSignal });
};
