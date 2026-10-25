/**
 * Exit current process using child-command semantics.
 *
 * @param {{status?:number|null,signal?:string|null}|null|undefined} result
 * @param {{exit:(code?:number)=>void,kill:(pid:number,signal:string)=>void,pid:number}} [proc=process]
 * @returns {void}
 */
export const exitLikeChildResult = (result, proc = process) => {
  const status = Number.isInteger(result?.status) ? Number(result.status) : null;
  if (status !== null) {
    proc.exit(status);
    return;
  }

  const signal = typeof result?.signal === 'string' && result.signal.trim().length > 0
    ? result.signal.trim()
    : null;
  if (signal) {
    // A self-signal handled by Node is dispatched asynchronously. An installed
    // cleanup hook may be the only remaining activity after the child closes;
    // keep one event-loop turn alive so natural exit cannot beat dispatch.
    const dispatch = proc === process ? setImmediate(() => {}) : null;
    try {
      proc.kill(proc.pid, signal);
      return;
    } catch { if (dispatch) clearImmediate(dispatch); }
  }

  proc.exit(1);
};
