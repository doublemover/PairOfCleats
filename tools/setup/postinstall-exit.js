/**
 * Exit current process using child-process semantics.
 *
 * @param {{status?:number|null,signal?:string|null}|null|undefined} result
 * @param {{exit:(code?:number)=>void,kill:(pid:number,signal:string)=>void,pid:number}} [proc=process]
 * @returns {void}
 */
export function exitLikeChildResult(result, proc = process) {
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
}
