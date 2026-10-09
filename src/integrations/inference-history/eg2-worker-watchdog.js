/** The CPU child spawns no processes. IPC loss/signals force its own process exit after 1s.
 * This JS watchdog requires the child event loop to run; it cannot preempt synchronous JS.
 */
export function installEg2WorkerShutdownWatchdog({
  processObject = process, onStop, graceMs = 1000
}) {
  if (!Number.isSafeInteger(graceMs) || graceMs < 0 || graceMs > 1000) {
    throw new Error('Invalid EG2 child shutdown grace.');
  }
  let timer = null, stopping = false;
  const beginStop = () => {
    if (stopping) return;
    stopping = true;
    timer = setTimeout(() => processObject.exit(23), graceMs);
    onStop();
  };
  processObject.on('disconnect', beginStop);
  processObject.on('SIGINT', beginStop);
  processObject.on('SIGTERM', beginStop);
  return { beginStop, clear: () => clearTimeout(timer), isStopping: () => stopping };
}
