/**
 * Exit this process using child-process semantics.
 *
 * When the child exits with a numeric status, mirror that status.
 * When the child is terminated by a signal, re-signal this process so
 * callers observe `signal` instead of a synthetic non-zero exit code.
 *
 * @param {{status?:number|null,signal?:string|null}|null|undefined} result
 * @param {{exit:(code?:number)=>void,kill:(pid:number,signal:string)=>void,pid:number}} proc
 * @returns {void}
 */
export const exitLikeChild = (result, proc = process) => {
  const status = Number.isInteger(result?.status) ? Number(result.status) : null;
  if (status !== null) {
    proc.exit(status);
    return;
  }

  const signal = typeof result?.signal === 'string' && result.signal.trim().length > 0
    ? result.signal.trim()
    : null;
  if (signal) {
    try {
      proc.kill(proc.pid, signal);
      return;
    } catch {}
  }

  proc.exit(1);
};

