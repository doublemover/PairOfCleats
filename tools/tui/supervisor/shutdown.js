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
    settlement = Promise.resolve().then(async () => {
      await observe('metrics', stopMetrics);
      await observe('shutdown-log', () => emitLog(null, 'info', 'supervisor shutdown requested', { reason }));
      const ownedJobs = [...state.jobs.values()];
      const cancellations = ownedJobs.map(job => observe(`cancel:${job.id}`, () => cancelJob(job.id, reason)));
      // Invoke every owner even when another rejects. Capture closures at call
      // time after pending admission has observed the synchronous shutdown fence.
      let owners = [];
      await observe('owner-registry', () => {
        owners = Object.entries(closeOwners()).map(([owner, close]) => observe(owner, close));
      });
      const jobs = ownedJobs.map(job => observe(`job:${job.id}`, async () => {
        if (!job.settlement || typeof job.settlement.then !== 'function') {
          throw Object.assign(new Error('Admitted job has no settlement owner.'), { code: 'ERR_TUI_JOB_SETTLEMENT' });
        }
        await job.settlement;
      }));
      await Promise.all([...cancellations, ...owners, ...jobs]);
      let transport = { complete: false, failed: true, errorCode: 'ERR_TUI_OUTPUT_DRAIN' };
      await observe('event-transport', async () => {
        const receipt = await output.drain();
        if (!receipt || typeof receipt.complete !== 'boolean') {
          throw Object.assign(new Error('Supervisor transport returned no drain receipt.'), { code: 'ERR_TUI_OUTPUT_DRAIN' });
        }
        transport = receipt;
      });
      if (transport.complete !== true && selectedExitCode === 0) selectedExitCode = 1;
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
