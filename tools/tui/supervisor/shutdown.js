import { assertTuiControlReason } from '../../../src/contracts/validators/tui-request.js';

/** Drain only this supervisor's admitted jobs and session owners. There is no
 * timer that turns an unfinished owner into successful closure. The native
 * lifetime owner retains its existing bounded containment fallback.
 */
export const createSupervisorShutdown = ({ state, cancelJob, closeOwners, stopMetrics = () => {},
  emitLog = () => {}, output, recorder = null, exit = code => process.exit(code), now = Date.now } = {}) => {
  let settlement = null;
  let selectedExitCode = 0;
  const failures = [];
  const observe = async (owner, action) => {
    try { await action(); }
    catch (error) { failures.push({ owner, error }); if (selectedExitCode === 0) selectedExitCode = 1; }
  };
  return (reason = 'shutdown', exitCode = 0) => {
    assertTuiControlReason(reason);
    // An output fault after ordinary EOF must still report failure. Preserve an
    // earlier nonzero signal/terminal status instead of replacing its meaning.
    if (selectedExitCode === 0 && exitCode !== 0) selectedExitCode = exitCode;
    if (settlement) return settlement;
    state.shuttingDown = true;
    state.shutdownStartedAt = now();
    stopMetrics();
    settlement = Promise.resolve().then(async () => {
      await observe('shutdown-log', () => emitLog(null, 'info', 'supervisor shutdown requested', { reason }));
      const ownedJobs = [...state.jobs.values()];
      for (const job of ownedJobs) await observe(`cancel:${job.id}`, () => cancelJob(job.id, reason));
      // Invoke every owner even when another rejects. Capture closures at call
      // time after pending admission has observed the synchronous shutdown fence.
      const owners = Object.entries(closeOwners()).map(([owner, close]) => observe(owner, close));
      const jobs = ownedJobs.map(job => observe(`job:${job.id}`, async () => {
        if (!job.settlement || typeof job.settlement.then !== 'function') {
          throw Object.assign(new Error('Admitted job has no settlement owner.'), { code: 'ERR_TUI_JOB_SETTLEMENT' });
        }
        await job.settlement;
      }));
      await Promise.all([...owners, ...jobs]);
      const transport = await output.drain();
      if (!transport.complete && selectedExitCode === 0) selectedExitCode = 1;
      await observe('event-log', () => recorder?.finalize(reason));
      const result = { reason, exitCode: selectedExitCode, transport,
        settled: failures.length === 0, failures: failures.map(({ owner, error }) => ({ owner,
          code: String(error?.code || 'ERR_TUI_SHUTDOWN') })) };
      exit(selectedExitCode);
      return result;
    });
    return settlement;
  };
};
